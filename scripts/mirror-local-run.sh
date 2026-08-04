#!/usr/bin/env bash
###############################################################################
# mirror-local-run.sh
#
# Local runner for the nightly mirror, for use by Windows Task Scheduler (or any
# cron on a machine that is logged in to Railway via `railway`). It pulls the
# production + demo public DB URLs from Railway (so no secrets are stored on
# disk) and runs scripts/mirror-prod-to-demo.sh, logging the result.
#
# Logs:  scripts/logs/mirror-<timestamp>.log   (full output, per run)
#        scripts/logs/mirror-latest.txt         (one-line PASS/FAIL + log path)
###############################################################################
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PGCLIENTENCODING=UTF8

LOG_DIR="scripts/logs"; mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/mirror-$STAMP.log"

# Fetch the two public DB URLs from Railway (this machine is authenticated).
# print-db-url.cjs just echoes DATABASE_PUBLIC_URL for the given env's Postgres.
PROD_DATABASE_URL="$(railway run -e production -s Postgres -- node scripts/print-db-url.cjs 2>/dev/null)"
DEMO_DATABASE_URL="$(railway run -e demo -s Postgres -- node scripts/print-db-url.cjs 2>/dev/null)"
export PROD_DATABASE_URL DEMO_DATABASE_URL

if [ -z "$PROD_DATABASE_URL" ] || [ -z "$DEMO_DATABASE_URL" ]; then
  echo "$(date -u +%FT%TZ) FAIL: could not obtain DB URLs from Railway (is 'railway' logged in?)" | tee "$LOG_DIR/mirror-latest.txt" >&2
  exit 1
fi

if bash scripts/mirror-prod-to-demo.sh >"$LOG" 2>&1; then
  echo "$(date -u +%FT%TZ) PASS -> $LOG" | tee "$LOG_DIR/mirror-latest.txt"
else
  rc=$?
  echo "$(date -u +%FT%TZ) FAIL (exit $rc) -> $LOG" | tee "$LOG_DIR/mirror-latest.txt" >&2
  # surface the tail of the failure in the latest-status file for quick triage
  tail -n 20 "$LOG" >> "$LOG_DIR/mirror-latest.txt" 2>/dev/null || true
  exit "$rc"
fi
