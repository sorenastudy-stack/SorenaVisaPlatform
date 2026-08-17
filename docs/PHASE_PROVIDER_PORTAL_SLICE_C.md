# Provider Portal — Slice C: Importer Wrapper & Provider UI

**Status:** DONE — 17 August 2026
**Depends on:** Slice A (review gate) and Slice B (login + ownership boundary).
**Followed by:** Slice D — programme CRUD.

---

## 1. What this phase does

An institution can now upload its own spreadsheets, and what arrives is reviewed
before any student sees it.

The importer was not rebuilt. `src/providers/import/` already parses these sheets,
already reports flagged rows with their real Excel row numbers, already supports a
dry run, and already lands rows PENDING. Slice C wraps it in the two things a
staff importer never needed: **the target institution comes from the session**,
and **the file came from outside the company**.

The wrapper also closed two holes that only became reachable now:

- **A changed price kept its approval.** `reviewStatus` defaults to PENDING, and a
  default applies on CREATE only. The tuition importer updates matching rows in
  place, so an APPROVED row could be silently re-priced and stay live. Fixed, and
  proven by removing the fix and watching a live price move from 29,500 to 24,500
  while still reading APPROVED.
- **The programme importer had no file constraints at all** — only "a buffer
  exists". Staff-only that was defensible; reachable by an institution it was not.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/provider-portal/provider-import.service.ts` | The wrapper: external-upload constraints, dispatch to the existing importers, audit. |
| `backend/src/provider-portal/provider-import.controller.ts` | Six routes under `/provider/imports`. No path parameters, no query, no body. |
| `backend/src/provider-portal/provider-import-boundary.spec.ts` | 18 source-property tests, including the staff-controller absence test. |
| `frontend/src/app/provider/layout.tsx` | PROVIDER-only gate, mirroring the agent portal. |
| `frontend/src/app/provider/page.tsx` | The one page. |
| `frontend/src/components/provider/ProviderShell.tsx` | Header, `GET /provider/me`, and the blocked-account wall. |
| `frontend/src/components/provider/ProviderHome.tsx` | Institution name, counts, empty states. |
| `frontend/src/components/provider/ProviderImportSection.tsx` | Upload → check → send for review. |

**Changed**
| File | Change |
|---|---|
| `backend/src/providers/import/pricing-import.service.ts` | A changed tuition figure returns the row to PENDING. |
| `backend/src/provider-portal/provider-portal.module.ts` | Imports `ProvidersModule`; registers the upload controller. |
| `backend/src/providers/providers.module.ts` | Exports the two importer services. |
| `frontend/src/lib/role-redirect.ts` | `PROVIDER → /provider`, and `AGENT → /agent` (see §7). |
| `frontend/src/components/staff/universities/PricingImportSection.tsx` | Copy corrected — a staff upload has not been "live" since slice A. |

## 3. Database changes

**None.** No migration in this slice. The only schema-adjacent change is
behavioural: an updated tuition row now has `reviewStatus` written back to
PENDING when its figures change.

## 4. Environment variables

None added.

## 5. Third-party services

None added. Files are parsed in memory by the existing SheetJS importer and are
never stored, forwarded or served back.

## 6. How to test it works

Sign in as a provisioned institution (slice B) and open `/provider`. Choose a
sheet type, pick an `.xlsx`, press **Check the file**, then **Send for review**.

**What was actually run, 17 Aug 2026** — two real institutions, real uploads of
the real templates in `docs/import-templates/`, through the wrapper:

```
29/29 checks passed
  a provider can dry-run a tuition sheet          4 rows, 3 countries, 0 flagged
    and NOTHING was written                       0 → 0
  a provider can apply the same sheet
    EVERY row landed PENDING                      4/4
    a student can see none of them yet            0 visible of 4
  re-uploading an UNCHANGED sheet keeps approval  APPROVED
  a CHANGED price loses its approval              stored 29500 (APPROVED) → 24500, PENDING
  A uploads a sheet whose Brand column names B    HTTP 201
    rows attach to the UPLOADER, not the sheet    A=2, B=0
    no institution was invented from the Brand cell
    every programme landed PENDING and inactive
  B has nothing from A's uploads                  0 fees, 0 programmes
  staff import routes refused to a PROVIDER       403 ×4 (own id, B's id, programmes, scholarships)
  .xlsm rejected / .txt rejected / 6 MB rejected  400 ×3
    including the programme route, which has no cap of its own
  every upload that ran is audited                5 events for 5 uploads, dry runs included
  the uploaded rows appear in the staff review queue
  test institutions, logins and uploaded rows removed   0 left
```

Rate limit, measured: 9 uploads → **6 accepted, first 429 at request 7**, and a
second institution's first upload still succeeded — the buckets are per identity,
not shared.

**In a real browser**, signing in through the actual magic-link page and clicking
the actual button: **12/12**, including landing on `/provider` rather than the
login page, the institution's own name, the empty-state copy, the review-gate
wording, `.xlsx`-only on the file input, no institution picker, and no console
errors. Screenshot taken.

Suites: backend **110 / 1340**, frontend **5 / 53**.

**The new guards were proven able to fail** — each mistake reintroduced, suite
re-run, then restored:

| Reintroduced mistake | Result |
|---|---|
| `PROVIDER` added to the staff import role tier | RED |
| the `.xlsm`/`.xls` whitelist widened for external uploads | RED |
| the rate limit dropped from one upload route | RED |
| the `Brand` column allowed to override the uploader | RED |
| the re-review of a changed price removed | RED — *and* the live check showed a price moving while still APPROVED |

## 7. Known limitations

- **No bulk approval.** Approval is still per row. Fine at today's volumes,
  not fine at real ones — it belongs with a batch identity, which this slice
  does not create.
- **No upload history.** The institution cannot see what it sent last week; the
  audit trail exists but only staff can read it.
- **One sheet type at a time**, and a re-upload is the only way to correct a
  flagged row. Single-row editing is slice D.
- **Scholarship rows are always inserted, never matched.** Re-uploading a
  scholarship sheet duplicates it. That predates this slice and is unchanged
  here; tuition does match and update.
- **`AGENT` was missing from `role-redirect.ts`** — found while adding `PROVIDER`.
  With no entry, `routeForRole` returns the caller's fallback, so an agent
  signing in by magic link landed on `/portal/case` (a client portal their role
  cannot open) and from the password page on `/login` again. Both entries added.
  Nothing else about the agent portal was touched.

## 8. How a future developer would extend this

Add routes to `ProviderImportController` and read `req.providerAccess.providerId`.
**Never add a `providerId` parameter** — the boundary tests fail if you do.

New sheet types: add a case to `ProviderImportService.dispatch()` and a `/check`
+ `/apply` pair. The parsing belongs in `src/providers/import/`, shared with
staff, so that one parser stays one parser.

If bulk approval arrives, give an upload a batch id in the wrapper's audit
payload first — approving "everything from Tuesday's file" needs the file to be
a thing the database knows about.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication | `JwtAuthGuard` on every route |
| Role | `RolesGuard` + `@Roles('PROVIDER')`; the staff import routes remain `PROVIDER_ADMIN` (OWNER/SUPER_ADMIN) and a PROVIDER token gets 403 there |
| Tenancy | The institution comes from `ProviderAccessGuard`; no route accepts an id in path, query or body |
| Sheet contents | The `Brand` column is ignored whenever a providerId is supplied — an institution cannot name a competitor and write rows onto them |
| File type | `.xlsx` only for external uploads (staff keep `.xls`/`.xlsm`); the underlying importer's own check still runs |
| File size | 5 MB, enforced in the wrapper — which is the only cap on the programme route |
| Rate limit | 6 uploads/minute per institution, token-subject keyed via `IdentityThrottlerGuard` |
| Review gate | Tuition, scholarships and programmes all land PENDING; a changed price returns to PENDING |
| Audit | `PROVIDER_SELF_IMPORT` per upload — institution, file name and size, row counts, flagged count, and whether it was a dry run |

## 10. Rollback instructions

No migration, so rollback is code-only: revert the commit. Provisioned logins
survive and simply have nothing to upload through.

The one change worth keeping if you revert selectively is the re-review of a
changed tuition price in `pricing-import.service.ts` — it is independent of the
provider portal and fixes a hole on the staff path too.
