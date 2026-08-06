# Phase 35: Catalogue Expansion and Audit

Session of 2026-08-06. Handover document — written so the next session, or Yashua reading it
alone, can pick up without needing the conversation.

**Production at close:** 96 providers · 1,129 programmes · 5 ACTIVE institutions ·
28 student-visible programmes · 92 map pins · 750 VERIFIED / 379 NEEDS_RECHECK.

---

## 1. What this phase does

Six things, in the order they happened:

1. **Deployed the Explore page to production.** The student-facing programme map
   (`/student/explore`) and per-programme detail page went live. Built in the same session; see
   `PHASE_EXPLORE_PROGRAMMES.md` for its own full write-up.
2. **Added two institutions to the catalogue.** An updated PTE workbook added
   **Future Skills Academy** (4 programmes) and **Bridge International College** (2 programmes).
   Production went 95 → 96 providers, 1,123 → 1,129 programmes.
3. **Added a seventh provider alias.** `Future Skills Academy Limited` → the existing
   `Future Skills` record, which the platform had tracked since before the catalogue import and
   which was sitting empty. Without it the import would have created a duplicate institution.
4. **Fixed a provider-status audit gap.** Changing an institution's `status` wrote no trace
   anywhere — not `audit_logs`, not `crm_events`. Since `provider.status === 'ACTIVE'` is the third
   condition in the matching gate, it was a direct control over what students see with no record of
   who used it. Now audited.
5. **Fixed a verification-status labelling bug affecting a third of the catalogue.** The import
   mapped *any* non-empty "Verification Status" cell to `VERIFIED`. 379 of 1,128 rows say
   "Single-source (…)" in the source and were stored as fully verified. Fixed forward, and the
   existing rows were backfilled.
6. **Added a production-write guard to the geocoding script**, which previously had none.

---

## 2. Files created or changed

**Backend — import and catalogue**
| File | Change |
|---|---|
| `src/providers/import/catalogue-workbook.logic.ts` | 7th alias; `DEFERRED_ROWS` + `isDeferredRow()`; `parseVerificationStatus()` |
| `src/providers/import/catalogue-workbook.logic.spec.ts` | 42 tests (13 new this phase) |
| `src/providers/import/catalogue-import.service.ts` | uses `parseVerificationStatus()` instead of the always-VERIFIED mapping |
| `scripts/backfill-verification-status.ts` | **new** — recomputes the column from the workbooks |
| `scripts/geocode-providers.ts` | **`--confirm-production` guard** |
| `docs/NZ_International_PTE_Programmes_2026_2027.xlsx` | updated workbook |
| `docs/NZ_International_PTE_Programmes_2026_2027_ORIGINAL.xlsx` | **new** — pre-overwrite original, recovered from `7ffd2e5` |

**Backend — audit**
| File | Change |
|---|---|
| `src/providers/providers.service.ts` | `updateProvider()` records status transitions; takes `actorId`; adds a Logger |
| `src/providers/providers.controller.ts` | threads `req.user.userId` into `updateProvider` |
| `src/providers/provider-status-audit.spec.ts` | **new** — 7 DB-backed tests |

**Frontend (Explore, deployed this session)**
| File | Change |
|---|---|
| `src/app/student/explore/page.tsx`, `…/[programmeId]/page.tsx` | **new** routes |
| `src/components/student/explore/*.tsx` | **new** — ExploreClient, ExploreMap, ProgrammeDetailClient |
| `package.json` / `package-lock.json` | + `leaflet`, `react-leaflet`, `@types/leaflet`; nested `@swc/helpers` lock entry restored |

**Docs / config**
| File | Change |
|---|---|
| `docs/PHASE_EXPLORE_PROGRAMMES.md` | addendum: this import, the Seafield deferral, the verification backfill |
| `docs/PHASE_PROGRAMMES_CURATION_SCREEN.md` | provider-status audit gap marked closed |
| `docs/PHASE_35_CATALOGUE_EXPANSION_AND_AUDIT.md` | this file |
| `.gitignore` | ignores `~$*.xlsx` (Excel lock files) |

---

## 3. Database tables/columns added

**Migration `20260806000000_pr_explore_provider_coordinates`** — additive only, four nullable
columns on `education_providers`:

| Column | Purpose |
|---|---|
| `latitude`, `longitude` | map pin; nullable so an institution that cannot be geocoded gets **no pin rather than a wrong one** |
| `geocodedAt` | lets a re-run retry only the misses |
| `geocodeSource` | provenance — `nominatim:campus` vs `:city` vs `:miss` |

**No `audit_logs` schema change.** The audit fix writes to the existing table using its existing
shape (`userId`, `action`, `eventType`, `entityType`, `entityId`, `oldValue`, `newValue`,
`actorNameSnapshot`, `actorRoleSnapshot`).

**Data changes to existing columns** (not schema): `verificationStatus` recomputed on 375 rows;
`latitude`/`longitude`/`geocodedAt`/`geocodeSource` populated on 92 providers.

---

## 4. Environment variables added

**None this session.** `YOUTUBE_API_KEY` was already set in every environment and is now actually
read at request time. `GEOCODER_CONTACT` is optional and only affects the User-Agent the geocoder
sends (defaults to a support address).

---

## 5. Third-party services connected

**No new services.** In use:

* **OpenStreetMap / Nominatim** — map tiles and geocoding. No API key, no account, no billing.
  Nominatim's policy (max 1 request/second, identifying User-Agent) is enforced in the script;
  breaching it would get the platform's IP blocked and take the map down for everyone.
* **YouTube Data API** — via the pre-existing corpus service, first called this session.

---

## 6. How to test it works

**The two new institutions**
1. Sign in as OWNER → `/staff/universities`.
2. Search `future` → open **Future Skills** → **Programmes (4)**. Expect: Bachelor of Applied
   Management and Graduate Diploma in Applied Management (both NZ$23,900), NZ Diploma in
   Construction (NZ$24,890), Master of AI Integrated IT Solutions (no single fee — tiered pricing,
   raw text preserved).
3. Search `bridge` → open **Bridge International College NZ Limited** → **Programmes (2)**, both
   NZCEL Academic (L4 and L5), both showing the promotional-vs-standard fee as raw text.
4. Confirm all 6 are **PENDING and inactive** — none are student-visible.

**Verification flags**
```sql
SELECT "verificationStatus", count(*) FROM education_programmes
WHERE "sourceRef" IS NOT NULL GROUP BY 1;
-- expect VERIFIED 750, NEEDS_RECHECK 379
```

**Map pins** — `/student/explore` as a STUDENT. 92 of 96 institutions have coordinates; pins appear
only for institutions with approved, active programmes.

**Audit on status change** — flip any institution's status on the curation screen, then:
```sql
SELECT "actorNameSnapshot", "oldValue", "newValue", "createdAt"
FROM audit_logs WHERE "eventType" = 'PROVIDER_STATUS_CHANGED' ORDER BY "createdAt" DESC LIMIT 5;
```
Already confirmed working in production: the 2026-08-06 06:24 UTC row shows Yashua Arjmand [OWNER]
moving Crown Institute of Studies Limited PENDING → ACTIVE.

**Test suite** — `cd backend && npx jest --runInBand`. 828 tests, 826 passing. The 2 failures are
`payments.controller`, a long-standing cross-suite data-pollution issue: run
`npx ts-node --transpile-only scripts/purge-test-fixtures-local.ts --commit` then that spec alone,
and it passes 4/4.

---

## 7. Known limitations

1. **Two Seafield programmes have corrected data sitting unused.** The updated workbook rewrote
   them (renamed, corrected 2026/2027 intakes, a fee year, and a `Single-source → Verified`
   upgrade). They were **deliberately deferred**: the importer is create-if-absent and keys partly
   on programme *name*, so importing them would have produced four rows for two real courses with
   the corrections stranded on the copies. Tracked in code as `DEFERRED_ROWS` and reported by every
   parse run — it cannot silently disappear. **Closing it needs importer update-in-place support**
   (match on provider + level + strand rather than name), which is a real behaviour change to a
   service that has never updated anything and deserves its own tested pass.
2. **Four institutions have no map coordinates.** Three own **0 programmes** (UCOL, MIT, Unitec) so
   they can never appear on the map regardless. The fourth, **Eastwest College of Intercultural
   Studies**, owns 2 programmes but its source location literally reads *"specific city not stated
   on pages reviewed"* — it appears in results normally, just without a pin, and the list names it
   as unmapped. Retryable with `--retry-misses` if better location data arrives.
3. **The Future Skills activation of 2026-08-05 remains unexplained.** An institution moved
   PENDING → ACTIVE during the catalogue import window and neither `audit_logs` nor `crm_events`
   recorded it. The import was proven not to be the cause (it only ever writes PENDING; all 72
   created providers were PENDING; none of the matched providers were modified; Future Skills is
   not one of the workbook institutions). **This cannot be reconstructed** — no record was written
   at the time. The audit fix in this phase prevents a recurrence; it is not retrospective.
4. **`updatedAt` was bumped on 375 programmes** by the verification backfill. Prisma updates
   `@updatedAt` on any write and it cannot be suppressed, so "when was this programme last
   genuinely revised" is slightly muddied for those rows. No other column changed — proven by
   row-by-row comparison against the pre-import backup.
5. **379 programmes are now flagged NEEDS_RECHECK.** That is the honest state, not a defect — but
   it means roughly a third of the catalogue carries a single unconfirmed source and should be
   re-verified before those programmes are approved for students.
6. **`payments.controller` still fails under a parallel test run** (cross-suite data pollution,
   passes alone on a clean database). Pre-existing, unrelated to this phase.

---

## 8. How a future developer would extend this

**Adding a provider alias** — `PROVIDER_NAME_ALIASES` in
`src/providers/import/catalogue-workbook.logic.ts`. Key = the workbook's name, value = the
platform's existing provider name, both verbatim; `aliasedProviderName()` normalises both sides.
It is an **allow-list, not fuzzy matching** — deliberately, so a coincidental name overlap can
never silently merge two real institutions. Before adding one, check the **NZQA Provider ID**: two
different IDs means two legal entities and they must stay separate, even when one is "part of" the
other's group. That test is what kept Bridge separate from ICL and Future Skills separate from
NZSE.

**The deferred-rows mechanism** — `DEFERRED_ROWS` in the same file, with `isDeferredRow()` applied
in `parseCatalogueWorkbook()` *before* the institution is registered (so a deferral cannot create
an empty provider). Skipped rows are returned in `WorkbookParseResult.deferred` and printed by
every run. To un-defer: give the importer update-in-place support, then delete the entries.

**Where verification status is set** — `parseVerificationStatus()` in the logic file, called by
`catalogue-import.service.ts`. It maps on the source's *leading keyword* because the workbook
writes a sentence, not a label. Unrecognised text maps to `NEEDS_RECHECK`: fail toward "look at
this", never toward "trusted". To recompute existing rows after changing the mapping, run
`scripts/backfill-verification-status.ts` (dry-run by default).

**Geocoding** — `scripts/geocode-providers.ts`. Local runs need no flag; anything non-local
requires `--confirm-production`. `--retry-misses` targets only rows with null coordinates. To
improve the 51 city-level pins, clear `geocodedAt` where `geocodeSource` ends in `:city` and re-run.

---

## 9. Security layers applied

* **Layer 2 — access control.** The new Explore routes are `@Roles('STUDENT')` behind
  `JwtAuthGuard`; no user id is ever accepted from the client, so pricing is always scoped to the
  authenticated student. A non-visible programme returns the same 404 as a non-existent one, so
  unapproved programmes cannot be discovered by guessing ids.
* **Layer 6 — audit log.** The headline fix of this phase. Every provider status transition writes
  an `audit_logs` row with actor, role snapshot, and old/new values. Only genuine transitions are
  logged, so the trail records decisions rather than form submissions. The write is best-effort in
  a try/catch — an audit failure logs a warning and never blocks a change the Owner successfully
  made, matching how `auth.service` treats `PASSWORD_CHANGED`.
* **Layer 7 — file uploads.** Unchanged; the Explore thumbnail path reuses the existing
  cover-image endpoint (server-side mime whitelist, 2 MB cap, server-derived key).
* **Beyond the standing 10 — production-write guards.** `geocode-providers.ts` now requires
  `--confirm-production` for any non-local database, and `backfill-verification-status.ts` was
  written with the same guard from the start. These are defence-in-depth: both scripts have
  legitimate production uses, so they gate rather than refuse, and both name the target host before
  writing. `catalogue-import-local.ts` still refuses non-local outright — that rail is unchanged.

---

## 10. Rollback instructions

**Code** — revert in reverse order; each is independent:

```bash
git revert 9307c94   # doc update
git revert 3d44e7c   # import + alias + verification mapping
git revert 0df5e3e   # provider-status audit
git revert e74e756   # geocode production guard
git revert 71242f1   # the Explore build (carries the migration)
```

**The migration is additive and safe to leave.** The four columns are nullable and nothing else
reads them. To remove anyway:

```sql
ALTER TABLE "education_providers"
  DROP COLUMN "latitude", DROP COLUMN "longitude",
  DROP COLUMN "geocodedAt", DROP COLUMN "geocodeSource";
```

**Data changes cannot be undone by reverting code.** Three writes landed on production this
session:

| Change | How to undo |
|---|---|
| 6 programmes + 1 provider imported | delete those rows, or restore from backup |
| 375 rows' `verificationStatus` recomputed | **restore from backup** — the script has no inverse, and the pre-change values were wrong anyway |
| 92 providers geocoded | set the four columns back to null, or restore from backup |

**Restore from the backup taken at the end of this session:**

```bash
pg_restore -h <host> -p <port> -U <user> -d <db> --clean --no-owner --no-acl \
  "D:\backups\sorena-prod\prod-20260806T083558Z.dump"
```

That dump is verified restorable — restored into a scratch database and compared across all 123
tables, every row count matching. Earlier backups from this session are in the same folder if an
earlier point is needed; `prod-20260806T080613Z.dump` predates the Future Skills / Bridge import.

---

## Commits in this session

```
9307c94  docs(explore): the verificationStatus backfill ran — record the result
3d44e7c  feat(import): add Future Skills + Bridge, and stop over-stating verification
0df5e3e  fix(providers): audit every institution status change
e74e756  fix(scripts): gate geocode-providers.ts behind --confirm-production
f9af3a1  fix(frontend): restore the nested @swc/helpers lock entry that broke the deploy
474cc6f  docs: commit the two remaining local documents, one marked superseded
71242f1  feat(explore): student programme map, detail page, and three things that were dead
f8628c1  fix(curation): Submit returns to the institutions list, not the row it came from
89c1459  feat(curation): return to the institution you were on, Submit button, ranked search
04fae16  fix(scripts): purge must clear blockers of CASCADE descendants, not just its own
9677282  feat(curation): the Programmes review screen — Active/Inactive, edit, thumbnail
ebb05ca  feat(providers): alias 6 institutions the platform already tracked, + prod runner
7ffd2e5  feat(providers): import the NZ catalogue — 91 institutions, 1,124 programmes
```

All pushed to `origin/main`. Working tree clean at close.

---

## Still pending before launch (untouched this session)

Carried forward from the project's own remaining-work list — none of it was worked on here:

* **OPS portal** — Documents, Compliance, Handoffs
* **Sales portal** — Pipeline, Consultations, Commissions
* **Legacy `/admin/*` pages** — migration or removal
* **Student portal** — My Case, Payments
* **Client portal polish**

Plus, from this phase: the Seafield deferral (§7.1) and re-verifying the 379 `NEEDS_RECHECK`
programmes before approving them for students.
