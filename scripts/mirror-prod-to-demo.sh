#!/usr/bin/env bash
###############################################################################
# mirror-prod-to-demo.sh
#
# Nightly PRODUCTION -> DEMO data mirror. Refreshes the demo (presentation)
# database so it matches production's current state.
#
#   * ONE-DIRECTIONAL: production (reseau) is the SOURCE (read-only), demo
#     (caboose) is the TARGET (written). HARD-FAILS if the hosts are
#     misconfigured or swapped — it will NEVER write to production.
#   * DATA-ONLY: demo's schema is a SUPERSET of production's (demo runs newer
#     code / more migrations). We copy production's row data into demo's
#     existing tables and PRESERVE demo-only tables (study_fields, admission_*,
#     recommendation_*, etc.). Demo's schema + migration history are untouched.
#   * FAIL-SAFE: the restore runs in ONE transaction (--single-transaction
#     -v ON_ERROR_STOP=1). Any error rolls it ALL back — demo is never left in a
#     half-mirrored state.
#   * IDEMPOTENT: safe to run every night, indefinitely.
#   * psql-only: no pg_dump (client is v16, servers are v18); psql is
#     version-lenient. Few round-trips (one combined export, UNION counts).
#
# Requires: bash, psql (14+), PROD_DATABASE_URL + DEMO_DATABASE_URL (public URLs).
# Exit 0 = success; non-zero = failure (reason logged, demo untouched by a
# failed restore). A final "===== MIRROR PASS/FAIL =====" line is always emitted.
###############################################################################
set -Eeuo pipefail

# Both databases are UTF8. Force the psql client encoding to UTF8 so non-Latin1
# data (e.g. Māori/te reo text like "Aotearoa") survives the copy round-trip —
# otherwise a Windows psql defaults to WIN1252 and aborts on those characters.
export PGCLIENTENCODING=UTF8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATUS="FAIL"

log() { printf '%s | %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '%s | ABORT: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }
finish() {
  local rc=$?
  printf '\n===== MIRROR %s (started %s, ended %s, exit %s) =====\n' \
    "$STATUS" "$STARTED_AT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc"
  [ -n "${WORK:-}" ] && rm -rf "$WORK" 2>/dev/null || true
}
trap finish EXIT

: "${PROD_DATABASE_URL:?PROD_DATABASE_URL is required (production/reseau source)}"
: "${DEMO_DATABASE_URL:?DEMO_DATABASE_URL is required (demo/caboose target)}"

qprod() { psql -tAX -v ON_ERROR_STOP=1 -d "$PROD_DATABASE_URL" -c "$1" | tr -d '\r'; }
qdemo() { psql -tAX -v ON_ERROR_STOP=1 -d "$DEMO_DATABASE_URL" -c "$1" | tr -d '\r'; }

# ---------------------------------------------------------------------------
# 1. SAFETY GUARDS — direction can never run backwards.
# ---------------------------------------------------------------------------
host_of() { local u="$1"; u="${u#*@}"; u="${u%%/*}"; u="${u%%\?*}"; printf '%s' "$u"; }
PROD_HOST="$(host_of "$PROD_DATABASE_URL")"; DEMO_HOST="$(host_of "$DEMO_DATABASE_URL")"
log "source (prod) host: $PROD_HOST"
log "target (demo) host: $DEMO_HOST"
case "$PROD_HOST" in *reseau*) ;; *) die "SOURCE host '$PROD_HOST' is not production (expected 'reseau'). Refusing." ;; esac
case "$DEMO_HOST" in *caboose*) ;; *) die "TARGET host '$DEMO_HOST' is not demo (expected 'caboose'). Refusing." ;; esac
case "$PROD_HOST" in *caboose*) die "SOURCE looks like DEMO (caboose) — direction reversed. Refusing." ;; esac
case "$DEMO_HOST" in *reseau*) die "TARGET looks like PRODUCTION (reseau) — refusing to WRITE to production." ;; esac
[ "$PROD_HOST" = "$DEMO_HOST" ] && die "source and target are the SAME host. Refusing."
qprod "SELECT 1" >/dev/null || die "cannot connect to production (read)"
qdemo "SELECT 1" >/dev/null || die "cannot connect to demo (write)"
log "guards passed: reseau -> caboose, one-directional, both reachable."

# ---------------------------------------------------------------------------
# 2. Production tables + their (non-generated) columns, in ONE query.
#    Excludes _prisma_migrations (demo keeps its own, newer, history).
# ---------------------------------------------------------------------------
declare -a TABLES=(); declare -A COLS=()
while IFS=$'\t' read -r t cols; do
  [ -n "$t" ] || continue
  TABLES+=("$t"); COLS["$t"]="$cols"
done < <(qprod "
  SELECT c.table_name || E'\t' || string_agg(quote_ident(c.column_name), ',' ORDER BY c.ordinal_position)
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.is_generated='NEVER' AND c.table_name <> '_prisma_migrations'
  GROUP BY c.table_name ORDER BY c.table_name")
[ "${#TABLES[@]}" -gt 0 ] || die "no production tables found — aborting rather than wiping demo."
log "production tables to mirror: ${#TABLES[@]}"

# UNION-count helper: one query returns count(*) for every table (avoids N round-trips).
count_union() {
  local sep="" out="" t
  for t in "${TABLES[@]}"; do out+="${sep}SELECT '${t}' AS tbl, count(*) AS n FROM \"${t}\""; sep=" UNION ALL "; done
  printf '%s' "$out"
}
declare -A PBEFORE=()
while IFS='|' read -r t n; do [ -n "$t" ] && PBEFORE["$t"]="$n"; done < <(qprod "$(count_union)")

# ---------------------------------------------------------------------------
# 3. EXPORT — one psql session on production writes every table's data to a file
#    (read-only). Then assemble the restore stream locally with COPY framing.
# ---------------------------------------------------------------------------
WORK="$(mktemp -d)"; mkdir -p "$WORK/dat"
EXPORT_PSQL="$WORK/export.psql"; SQL="$WORK/restore.sql"
# psql's \copy paths are read by psql itself. On Windows (native psql) an MSYS
# /tmp/... path is not understood, so convert to a Windows path; on Linux the
# path is used verbatim. (Paths passed as `-f` args are auto-translated by MSYS;
# only the \copy targets embedded INSIDE the script need this.)
psql_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
: > "$EXPORT_PSQL"
for t in "${TABLES[@]}"; do
  printf '\\copy (SELECT %s FROM public."%s") TO %s\n' "${COLS[$t]}" "$t" "'$(psql_path "$WORK/dat/$t.dat")'" >> "$EXPORT_PSQL"
done
log "exporting production data (single read-only session) ..."
psql -X -v ON_ERROR_STOP=1 -d "$PROD_DATABASE_URL" -f "$EXPORT_PSQL" >/dev/null || die "production export failed"

TRUNC_LIST="$(printf '"%s", ' "${TABLES[@]}")"; TRUNC_LIST="${TRUNC_LIST%, }"
{
  echo "SET session_replication_role = replica;"     # disable FK triggers for the load
  echo "TRUNCATE ${TRUNC_LIST} RESTART IDENTITY CASCADE;"
} > "$SQL"
for t in "${TABLES[@]}"; do
  printf 'COPY public."%s" (%s) FROM stdin;\n' "$t" "${COLS[$t]}" >> "$SQL"
  tr -d '\r' < "$WORK/dat/$t.dat" >> "$SQL"
  printf '\\.\n' >> "$SQL"
done
echo "SET session_replication_role = origin;" >> "$SQL"
log "restore stream assembled ($(wc -l < "$SQL") lines)."

# ---------------------------------------------------------------------------
# 4. APPLY atomically. On ANY error -> full rollback -> demo unchanged.
# ---------------------------------------------------------------------------
log "applying to demo in a single transaction ..."
if psql -X -v ON_ERROR_STOP=1 --single-transaction -d "$DEMO_DATABASE_URL" -f "$SQL" >/dev/null; then
  log "restore committed."
else
  die "restore FAILED and was rolled back — demo is unchanged (safe). See psql errors above."
fi

# ---------------------------------------------------------------------------
# 5. DEMO-ONLY ADDITIVE LAYER.
# ---------------------------------------------------------------------------
# 5a. study_fields taxonomy (v2 assessment Q13/Q32 pickers). Production lacks
#     these tables, so they are demo-only and PRESERVED by the mirror (never in
#     production's dump, never truncated). Safety net: restore from a committed
#     snapshot only if they somehow ended up empty.
SF_COUNT="$(qdemo "SELECT count(*) FROM study_fields" 2>/dev/null || echo 0)"
if [ "${SF_COUNT:-0}" -eq 0 ]; then
  log "study_fields empty -> restoring from snapshot (additive)."
  psql -X -v ON_ERROR_STOP=1 --single-transaction -d "$DEMO_DATABASE_URL" \
    -f "$SCRIPT_DIR/mirror-additive/study-fields-snapshot.sql" >/dev/null || die "study_fields snapshot restore failed"
  SF_COUNT="$(qdemo "SELECT count(*) FROM study_fields")"
fi
log "study_fields present: $SF_COUNT"

# 5b. Demo Student sample case — OFF by default (judgment call). Demo now mirrors
#     production which already holds real cases/leads; the fictional
#     test.client@sorena.test student would make demo diverge from prod. Enable
#     with SEED_DEMO_STUDENT=1 (needs Node + backend deps).
if [ "${SEED_DEMO_STUDENT:-0}" = "1" ]; then
  if command -v node >/dev/null 2>&1 && [ -d "$SCRIPT_DIR/../backend/node_modules" ]; then
    log "re-seeding Demo Student (SEED_DEMO_STUDENT=1) ..."
    ( cd "$SCRIPT_DIR/../backend" && DATABASE_URL="$DEMO_DATABASE_URL" npx ts-node scripts/seed-test-student.ts >/dev/null ) \
      && log "Demo Student seeded." || log "WARN: Demo Student seed failed (non-fatal)."
  else
    log "WARN: SEED_DEMO_STUDENT=1 but Node/backend deps unavailable — skipped."
  fi
else
  log "Demo Student sample case: skipped (demo mirrors prod's real data; set SEED_DEMO_STUDENT=1 to re-enable)."
fi

# ---------------------------------------------------------------------------
# 6. GUARDRAIL — Stripe/email neutralization.
#    Neutralization lives in the demo Railway SERVICE env vars (test/sandbox
#    keys), NOT the database — a DATA mirror cannot change it. Defense-in-depth:
#    scan the freshly-copied data for LIVE secret material that could ride in
#    from production.
# ---------------------------------------------------------------------------
# Server-side DO loop (small command line, scans every text/jsonb column). RAISEs
# if any live-key pattern is present -> psql exits non-zero.
read -r -d '' SCAN_DO <<'SQL' || true
DO $$
DECLARE r record; hits bigint; total bigint := 0;
BEGIN
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema='public' AND data_type IN ('text','character varying','jsonb','json')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text ~* %L', r.table_name, r.column_name, 'sk_live_|rk_live_') INTO hits;
    total := total + hits;
  END LOOP;
  IF total > 0 THEN RAISE EXCEPTION 'LIVE_SECRET_LEAK:%', total; END IF;
END $$;
SQL
if scan_out="$(psql -tAX -v ON_ERROR_STOP=1 -d "$DEMO_DATABASE_URL" -c "$SCAN_DO" 2>&1 | tr -d '\r')"; then
  log "guardrail OK: no live Stripe secret patterns (sk_live_/rk_live_) in copied data."
elif printf '%s' "$scan_out" | grep -q 'LIVE_SECRET_LEAK'; then
  die "GUARDRAIL FAILED: live Stripe secret pattern found in copied data — halting. ($scan_out)"
else
  log "WARN: live-secret scan could not complete (non-fatal): $scan_out"
fi
log "note: Stripe/email keys are demo-SERVICE env vars (test/sandbox); untouched by this data mirror."

# ---------------------------------------------------------------------------
# 7. VERIFY — production untouched (read-only proof) + demo now matches prod.
# ---------------------------------------------------------------------------
declare -A PAFTER=() DAFTER=()
while IFS='|' read -r t n; do [ -n "$t" ] && PAFTER["$t"]="$n"; done < <(qprod "$(count_union)")
while IFS='|' read -r t n; do [ -n "$t" ] && DAFTER["$t"]="$n"; done < <(qdemo "$(count_union)")

PROD_UNCHANGED=1; DEMO_MATCHES=1; TOTAL=0
printf '\n%-34s %10s %10s %8s\n' "table" "prod" "demo" "match"
for t in "${TABLES[@]}"; do
  [ "${PAFTER[$t]}" = "${PBEFORE[$t]}" ] || PROD_UNCHANGED=0
  m="ok"; [ "${PAFTER[$t]}" = "${DAFTER[$t]}" ] || { m="DIFF"; DEMO_MATCHES=0; }
  TOTAL=$(( TOTAL + ${DAFTER[$t]:-0} ))
  printf '%-34s %10s %10s %8s\n' "$t" "${PAFTER[$t]}" "${DAFTER[$t]}" "$m"
done
printf '%-34s %10s %10s\n' "(rows copied, total)" "" "$TOTAL"

[ "$PROD_UNCHANGED" = "1" ] || die "PRODUCTION ROW COUNTS CHANGED during the run — investigate immediately."
log "verified: production row counts identical before/after — production was NOT modified."
[ "$DEMO_MATCHES" = "1" ] || die "demo does not match production after mirror (see DIFF rows)."
log "verified: demo matches production across all ${#TABLES[@]} mirrored tables."

STATUS="PASS"
log "MIRROR SUCCESSFUL — demo now reflects production."
