# Phase: Programmes Curation Screen

Built 2026-08-06. Follows the catalogue import phase (commits `7ffd2e5`, `ebb05ca`), which
loaded 91 institutions and 1,123 programmes into production as PENDING but gave the Owner
nothing to click. This phase is that screen.

---

## 1. What this phase does

Adds a per-institution review screen at `/staff/universities/[id]/programmes`, reached from a
**Programmes** button on the institution edit screen. For one institution it lets the Owner:

* see every imported programme in one filterable list (search + subject-area filter),
* switch each programme **Active / Inactive** — the gate on Recommendation Engine eligibility,
* edit every field that came in from the workbook, saved directly with one button per programme,
* upload one thumbnail per programme.

**Active / Inactive is the primary control, and it moves two database fields at once.** The
matching engine gates on `reviewStatus === 'APPROVED' && isActive && provider.status === 'ACTIVE'`
(`matching.service.ts`). A single switch that moved only one of the two programme-level fields
would leave a programme looking live to the Owner while remaining invisible to students, so
`activationTarget()` always sets both. Inactive returns to `PENDING`, never `REJECTED` —
"reviewed and refused" is a different statement from "not switched on yet", and the Owner must be
able to switch it back.

The third condition, `provider.status`, is **not** something this screen can change. That was the
sharpest usability trap found while building: the Owner switches programmes Active, nothing
reaches students, and there is no visible reason. The screen therefore states it in two places —
a banner at the top while the institution is PENDING, and an inline note on any programme that is
Active but still blocked.

---

## 2. Files created or changed

**Backend**
| File | What |
|---|---|
| `src/providers/programme-curation.logic.ts` | new — pure rules: activation mapping, deactivation decision, field diff, blocked-reason |
| `src/providers/programme-curation.logic.spec.ts` | new — 18 tests |
| `src/providers/programme-curation.service.ts` | new — list / edit / activate, all audited |
| `src/providers/programme-curation.spec.ts` | new — 12 DB-backed tests |
| `src/providers/dto/update-programme.dto.ts` | new — edit whitelist + activation DTO |
| `src/providers/providers.controller.ts` | +4 routes, all `PROVIDER_ADMIN` |
| `src/providers/providers.module.ts` | registers `ProgrammeCurationService` |
| `src/common/filters/http-exception.filter.ts` | opt-in `details` passthrough for structured 4xx |
| `src/common/filters/http-exception.filter.spec.ts` | new — 8 tests pinning both halves of the error contract |
| `scripts/purge-test-fixtures-local.ts` | fixture-name pattern generalised |

**Frontend**
| File | What |
|---|---|
| `src/app/staff/universities/[id]/programmes/page.tsx` | new route, OWNER/SUPER_ADMIN |
| `src/components/staff/universities/ProgrammesCurationClient.tsx` | new — the screen |
| `src/components/staff/universities/UniversitiesClient.tsx` | adds the **Programmes** button |
| `src/lib/api.ts` | `ApiError` now carries the parsed response body |

---

## 3. Database tables/columns added

**None.** This phase is entirely UI + API over the columns the import phase already added. It
writes `reviewStatus`, `isActive`, `coverImageUrl` and the editable catalogue fields, and reads
`AdmissionProgrammeChoice` for the deactivation guard.

---

## 4. Environment variables added

**None.** Thumbnail upload reuses the existing R2 configuration.

---

## 5. Third-party services connected

**None new.** Thumbnails reuse the existing `POST /providers/programmes/:id/cover-image`
endpoint — same R2 bucket, same 2 MB cap, same JPG/PNG/WebP whitelist, key derived server-side.
No second upload path was created.

---

## 6. How to test it works

Verified on 2026-08-06 against the local stack with a real Owner login and a real browser:

```bash
cd backend  && npm run start:dev
cd frontend && npm run dev
# log in as owner@sorena.test, then open
# http://localhost:3000/staff/universities/<providerId>/programmes
```

What was actually exercised, end to end:

| Check | Result |
|---|---|
| Page loads real imported data | Ara Institute of Canterbury — 76 programmes, 14 subject areas |
| Subject-area filter | "Business & Management (21)" narrows the list |
| Toggle Active | `aria-checked` false → true; DB `reviewStatus=APPROVED, isActive=true` |
| Edit + Save | toast "Saved — 1 field updated."; only the changed field written |
| Provider-gate warning | toast + inline note shown while the institution is PENDING |
| Deactivate with a student holding it | amber panel names "Verification Student — INZ-VERIFY-1"; programme stays Active |
| Confirm | switches to Inactive; audit records `confirmed: true` |
| Console errors | none |

Test suites: `npx jest src/providers/programme-curation src/common/filters` → **38 passing**.
Full backend suite: **769/771**; the 2 failures are the pre-existing `payments.controller`
cross-suite data pollution (passes 4/4 alone on a purged database), unrelated to this work.

---

## 7. Known limitations

1. **TOP FOLLOW-UP — bulk activation is API-only.** `POST /providers/:id/curation/activation-bulk`
   exists and applies the same per-programme guard, but no button surfaces it yet. An institution
   with 113 programmes still needs 113 clicks to go fully live. This is the single biggest
   usability gap in the phase and the first thing to build next. The endpoint returns per-
   programme `skipped` entries with reasons (a programme held by a student refuses without
   `confirm`), so the UI must surface those individually rather than reporting a flat success.
2. **No optimistic-concurrency check on edit.** Two Owners editing the same programme at once:
   last write wins. Single-Owner today; would need a version column to fix properly.
3. **`intakeMonths` is edited as a comma-separated string.** Anything outside 1–12 is silently
   dropped by the client before submit rather than flagged.
4. **The audit diff is stored in `crm_events.payloadJson`,** which has no index on the changed
   field names — fine for "what happened to this programme", slow for "who ever changed tuition".
5. **Thumbnail is stored but not yet shown to students** on the Explore cards for programmes
   surfaced through this screen; that wiring belongs to the Explore phase.
6. **No pagination.** 113 rows render fine; an institution with thousands would not.

---

## 8. How a future developer would extend this

* **Bulk actions in the UI** — the endpoint is built; add selection checkboxes and call it. Note
  it returns per-programme `skipped` entries with reasons, which the UI should surface rather
  than reporting a flat success.
* **A cross-institution queue** — `providers/review-queue` already exists for that shape; this
  screen deliberately scopes to one institution because that is how the Owner reviews.
* **Change proposals** stay separate. Direct edits here save immediately by design; the proposal
  flow is for *automated* re-uploads and web-checks touching an already-approved programme. Do
  not route manual edits through it.
* **New editable columns** must be added in three places: `UpdateProgrammeDto`,
  `EDITABLE_PROGRAMME_FIELDS` in the logic file, and `TEXT_FIELDS` in the client. The DTO alone
  is not enough — the service enforces the allow-list independently.

---

## 9. Security layers applied

* **Layer 2 — access control.** All four routes are `@Roles('OWNER','SUPER_ADMIN')`, matching the
  institution edit screen. The page itself redirects non-Owners. A test asserts the role metadata
  on every handler, including the reused cover-image upload.
* **Layer 6 — audit log.** Every toggle and every save writes a `crm_event` with actor, entity and
  a field-level `{from, to}` diff. An untouched save writes nothing, so the trail answers "what
  actually changed" rather than "someone pressed Save". This was a deliberate response to the gap
  the import phase surfaced, where provider status changes leave no trace at all — that gap still
  exists for provider status and is **not** fixed by this phase.
* **Layer 7 — file uploads.** Reuses the existing endpoint: server-side mime whitelist, 2 MB cap,
  server-derived key. The client-side check is a courtesy only.
* **Whitelist, enforced twice.** `reviewStatus`, `isActive`, `sourceRef`, `source`,
  `coverImageUrl` and `providerId` are unreachable from the edit path — stripped by
  `ValidationPipe` at the boundary *and* filtered by `EDITABLE_PROGRAMME_FIELDS` in the service,
  so the invariant does not depend on pipe configuration.
* **Error-shape change, scoped.** The global exception filter now passes through a `details`
  object on 4xx responses that opt in. It keys on `details`, **not** `error`: Nest sets
  `error: 'Bad Request'` on its own exceptions, so keying on that would have widened the response
  body of nearly every endpoint in the API. 5xx never passes anything through.

---

## 10. Rollback instructions

No migration, so rollback is a code revert:

```bash
git revert <commit>
```

Nothing needs undoing in the database. Any programme already switched Active stays Active — that
is Owner-entered state, not something this phase generated. To reverse those:

```sql
-- only the ones this screen switched on, if a full reset is wanted
UPDATE education_programmes SET "reviewStatus" = 'PENDING', "isActive" = false
WHERE "sourceRef" IS NOT NULL;
```

The exception-filter change is the one piece with reach beyond this screen. Reverting it is safe:
no pre-existing endpoint sends `details`, so no other response shape depends on it.

---

## Follow-ups, ranked

| # | Item | Why it matters |
|---|---|---|
| **1** | **Bulk-activate button** | API exists, no UI. 113 programmes = 113 clicks today. Must surface per-programme `skipped` reasons, not a flat success. |
| ~~2~~ | ~~Close the **provider-status audit gap**~~ | **DONE 2026-08-06** — see below. |
| 3 | Show the thumbnail on student-facing Explore cards | Uploads work and are stored; the display wiring belongs to the Explore phase. |
| 4 | Optimistic-concurrency on edit | Two Owners editing one programme: last write wins. Needs a version column. |
| 5 | Pagination | 113 rows render fine; thousands would not. |

---

## Defects found and fixed while building

Both were caught by tests written for this phase, not by review.

**1. The edit whitelist was not actually enforced by the service.**
`UpdateProgrammeDto` listed the editable columns, but `changedFields()` iterated whatever the
caller passed, so protection rested entirely on `ValidationPipe({ whitelist: true })` stripping
unknown properties at the HTTP boundary. An integration test that posted
`{ reviewStatus: 'APPROVED', sourceRef: 'HACKED' }` directly to the service saw both written.
That mattered because `reviewStatus`/`isActive` are exactly the fields the activation endpoint
guards with the student-hold check — reaching them through the edit path would have routed around
that guard entirely, and `sourceRef` is the key the idempotent re-import depends on.
Fixed by adding `EDITABLE_PROGRAMME_FIELDS` and filtering in the service, so the invariant holds
independently of pipe configuration. Test: *"the edit path cannot reach the visibility or
provenance fields"*.

**2. The first version of the error-shape change would have altered nearly every endpoint.**
The deactivation refusal needs to carry the affected students, but the global exception filter
flattens every error to `{statusCode, message, timestamp}`. The first implementation opted in on a
string `error` property — and a test asserting the flat default for a plain
`BadRequestException('…')` failed, because **Nest populates `error: 'Bad Request'` on its own
built-in exceptions**. The "opt-in" would therefore have fired for almost every throw in the API,
silently widening error bodies platform-wide.
Re-keyed on a `details` object, which Nest never sets, and restricted to 4xx. Tests pin both
halves: the flat default survives, and 5xx passes nothing through.

---

## Addendum — three UX fixes (2026-08-06)

From the Owner's first real session on the live screen. Core functionality (toggle, edit, save)
was confirmed working on Ara Institute of Canterbury. "Future Skills" showing 0 programmes was
confirmed **correct, not a bug** — that institution was never in the 91 imported from the
workbooks, so it has nothing to list.

UI and navigation only. No schema change, no new backend logic, and nothing about what gets
written or audited changed.

**1. Back returns to the institution you were on.**
The institution edit view was pure React state, so it had no address. Following through to a
programmes screen and coming back always reset to the top-level list, meaning a 95-row hunt for
the same institution on every return trip. The open institution now lives in the URL
(`/staff/universities?edit=<id>`), so the Programmes screen links straight back to it — and the
browser Back button works for free. The back link now reads "Back to Ara Institute of Canterbury"
rather than "Back to institutions".

**2. A Submit button that saves and leaves.**
`Save changes` kept you inside the expanded row, so finishing a programme meant save, then
collapse, as two actions. There are now two buttons, because the two jobs genuinely differ:

* **Save changes** (secondary) — writes and keeps the row open, for correcting several fields on
  one programme without losing your place.
* **Submit** (primary) — writes, then navigates out to `/staff/universities`, the top-level
  institutions list.

Both call the same audited endpoint; Submit performs no extra write. It navigates **only on a
successful save** — leaving after a failure would discard what was typed with nothing persisted.

Submit's destination was corrected after the first implementation. It originally collapsed the row
and stayed on the institution's programme list, on the reasoning that this keeps the reviewer in
flow through a long list. The Owner's actual workflow is the opposite: Submit ends the visit to
that institution, so it returns all the way to the main list. Recording the correction because the
in-flow argument is the obvious one to re-derive later and re-apply by mistake.

**3. Search on the institutions list — ranked, not just filtered.**
95 institutions with no search meant scrolling. Filtering happens in the browser: the list is
already fetched in one call, so a search endpoint would add a round trip per keystroke to filter
data the page is holding anyway. Revisit above a few thousand rows.

Plain substring filtering was tried first and was visibly wrong: searching "ara" returned **Ara
Institute of Canterbury fourth**, behind institutions merely containing those letters mid-word
(Ta*ra*naki, Ma*ra*ekakaho, Ō*tara*). Results are now ranked — name matches before city matches,
and within each the earlier the match sits in the string the higher it ranks, so "starts with what
I typed" floats to the top. Verified: "ara" → Ara Institute first, "auck" → Auckland Institute of
Studies first, "waikato" → Waikato Institute of Technology first.

Verified by browser click-through: search narrowing with a "N of M institutions" counter, URL
carrying `?edit=<id>`, and the back link landing on the institution's own edit form with its name
populated. Submit was verified end to end — edit a field on a real Ara programme, click Submit,
land on `/staff/universities`, then navigate back in and confirm the field still holds the edited
value. No console errors.

---

## Closed 2026-08-06: the provider-status audit gap

**Fixed.** `ProvidersService.updateProvider` now writes an `audit_logs` row on every genuine
status transition — `eventType: PROVIDER_STATUS_CHANGED`, with `userId`, `oldValue: {status}`,
`newValue: {status, providerName}` and snapshotted actor name/role. The controller threads the
authenticated actor through, so "who made this institution live" is answerable from now on.

Only a real transition is logged: saving the form without touching status writes nothing, so the
trail records decisions rather than form submissions. The write is best-effort in a try/catch —
an audit failure logs a warning and never rolls back or blocks a status change the Owner
successfully made, matching how the auth service treats `PASSWORD_CHANGED`. 7 DB-backed tests.

It does NOT retrospectively explain the Future Skills activation of 2026-08-05 — nothing can,
since no record was written at the time. The original description of the gap follows.

---

### Original description (for context)

**Was not fixed by the curation phase.** Changing an institution's `status` (e.g. PENDING → ACTIVE, the
contractual "we have an agreement" flag) writes **no `crm_event` and no `audit_log` row**. This
surfaced during the production import on 2026-08-05, when "Future Skills" moved to ACTIVE during
the import window and neither table recorded who did it or when — the only evidence was the row's
own `updatedAt`.

This is more consequential than it looks: `provider.status === 'ACTIVE'` is the third condition in
the matching gate, so it is a control over what students can see, and it is the one with no trail.
The programme-level actions built in this phase are audited precisely so they do not extend the
gap, but closing it means adding an event emit to `ProvidersService.updateProvider` — deliberately
out of scope here to keep this phase reviewable.
