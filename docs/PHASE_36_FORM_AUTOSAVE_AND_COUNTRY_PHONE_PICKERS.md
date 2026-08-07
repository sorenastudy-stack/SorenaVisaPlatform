# Phase 36: Form Autosave and Country/Phone Pickers

Session of 2026-08-08. Handover document — written so the next session, or Yashua reading it
alone, can pick up without needing the conversation.

**Shipped in one commit:** `a6d1317` — 13 files, +990 / −37. Frontend only. No migration, no
schema change, no backfill, no production data touched.

---

## 1. What this phase does

Three related pieces of form work, landed together because they touch the same nine files.

1. **Session-scoped autosave on `/assessment`.** An accidental refresh or browser crash no
   longer loses the answers. Abandoning the form and returning later still starts from the
   beginning — that is the product decision, not a gap.
2. **Country is a searchable dropdown everywhere.** Three fields still took a country as free
   text; they now use the shared `CountrySelect`.
3. **Phone country code is a searchable dropdown everywhere.** Six fields were bare
   `<input type="tel">`; they now use one new `PhoneInput` that emits a single E.164 string.

Points 2 and 3 implement a standing platform rule agreed this session: **anywhere on the
platform a user enters a country or a phone country code, it must be a searchable dropdown
with a filter-as-you-type search field — never free text, never a plain `<select>`.** This
applies to every portal and every role. A full inventory was taken before any code was
written; the fifteen student- and staff-facing forms already using `CountrySelect` /
`CountryPicker` were already compliant and were left alone.

### The one real bug this fixed

`/assessment`'s **nationality** field was a text input whose placeholder asked the applicant to
know their own ISO 3166 code (`"ISO code, e.g. IR"`). That value feeds `buildMatchCriteria`,
and `backend/src/matching/matching.logic.ts:50` documents the contract as
`nationality?: string; // Q5 → scholarship scoping (ISO)`. An applicant typing "Iran" instead
of "IR" would have silently missed both nationality-scoped scholarships and their nationality's
tuition rate.

`/assessment` is not live, so **no real applicant was affected**. This was found while doing the
inventory, not by a report.

---

## 2. Files created or changed

**New — shared logic and component**
| File | What it is |
|---|---|
| `frontend/src/lib/phone.ts` | `composeE164` / `parseE164` / `isValidE164`. Pure, no React. |
| `frontend/src/components/common/PhoneInput.tsx` | The one phone field for the whole platform. |
| `frontend/src/lib/scorecard/v2/assessment-draft.ts` | `saveDraft` / `loadDraft` / `clearDraft` / `hasAnswers`. Pure, no React. |

**New — tests**
| File | Coverage |
|---|---|
| `frontend/src/lib/phone.test.ts` | 15 tests. E.164 across all 249 countries. |
| `frontend/src/app/assessment/assessment-autosave.test.tsx` | 7 tests. Drives the real page. |

**Changed**
| File | Change |
|---|---|
| `frontend/src/lib/country-codes.ts` | Added `DIAL_CODES` (249 entries), `getDialCode`, `dialCodeToCountry`, `getSearchableDialCodes`. |
| `frontend/src/app/assessment/page.tsx` | Autosave wiring; `country` and `phone` field types now render the pickers; "Start over" clears answers. |
| `frontend/src/app/lia/officers/[id]/EditOfficerButton.tsx` | `countryOfPosting` free text → `CountrySelect`. |
| `frontend/src/components/scorecard/ScorecardForm.tsx` | `phone` → `PhoneInput`. |
| `frontend/src/components/staff/users/CreateStaffOverlay.tsx` | `mobileNumber` → `PhoneInput` via `Controller`. |
| `frontend/src/components/staff/users/EditStaffOverlay.tsx` | Same. |
| `frontend/src/components/staff/marketing/CreateAgentButton.tsx` | `phone` → `PhoneInput`. |
| `frontend/src/components/LeadForm.tsx` | `phone` + `whatsapp` → `PhoneInput theme="dark"`, via `Controller`. **Since deleted — see below.** |

**Deleted in the follow-up commit** `0d32f0c`: `LeadForm.tsx` and
`lib/schemas/lead.schema.ts`, its only dependant. Both were dead code — nothing imported the
component and no route rendered it. `types/acquisition.ts` was kept: `VerifyEmailResponse` is
used by the live `/verify-email` route, and `LeadResponse` / `CreateLeadPayload` still document
the shape of `POST /acquisition/leads`, which is live and receives the real marketing site's
submissions.

---

## 3. Database tables/columns added

**None.** This is the central design constraint of the phase and it was deliberate.

`PhoneInput` emits **one E.164 string**, exactly what the six free-text inputs POSTed before. The
(country, national digits) split exists only inside the component and is recomputed from the
stored string on load. Country fields already stored ISO alpha-2 codes.

Consequently: no migration, no backfill, and every existing validator still passes — checked
individually against `PHONE_REGEX` (`/^[+0-9 ()\-]{5,32}$/`, staff DTOs), the
`"must start with +"` rule in `ScorecardForm`, and `z.string().max(30)` in `lead.schema.ts`.

Autosave writes to the browser's `sessionStorage`, not to the database. See §7 for why.

---

## 4. Environment variables added

**None.**

---

## 5. Third-party services connected

**None.** The dialling-code table is hand-maintained in `country-codes.ts` rather than pulled
from a library. `libphonenumber-js` was considered and rejected: it is ~150 kB for per-country
length and format validation we do not need. What we need is composition and a tolerant parse.

`DIAL_CODES` is guarded by two tests: every country the dropdown can show must have a dialling
code, and every code must be a bare digit string. If `i18n-iso-countries` adds a territory, the
suite fails rather than the picker silently dropping it.

---

## 6. How to test it works

**Automated** — all green at `a6d1317`:

```bash
cd backend  && npx jest src/scorecard/scoring/scoring.spec.ts   # 47/47
cd frontend && npx vitest run                                    # 29/29
cd frontend && node scripts/verify-v2-scoring.cjs                # BYTE-IDENTICAL: true
cd frontend && npx tsc --noEmit && npm run build                 # clean
```

Scoring is untouched by design — these are UI, session storage, and component swaps. All three
scoring layers were re-run to prove exactly that, not because a change was expected.

**Both new suites were checked against the code they guard**, because a test that cannot fail is
worth nothing:

- Removing `clearDraft()` from the submit path makes the autosave suite fail
  (`expected '{"version":1,...}' to be null`). Verified, then restored.
- The phone suite loops over all 249 countries × 5 messy input shapes rather than asserting on a
  handful of samples.

**Manual — browser proof (this is what "verified" means on this project):**

`LeadForm` has **no route in this repo** (see §7), so it was rendered through a temporary
harness page under a real Chromium, and the submitted payload was intercepted:

```
"phone":    "+989123456789"   ← typed "0912 345 6789" with Iran selected
"whatsapp": "+447700900123"   ← pasted "+44 7700 900123" into a field set to NZ
```

That single capture proves three behaviours at once: the domestic trunk zero is dropped, a
pasted international number moves the picker instead of doubling the code, and both values leave
the form as valid single-string E.164.

The dark theme was confirmed visually in the same run. It caught one real layout bug that was
fixed before commit: as a CSS-grid child the component was sized by its min-content and the
WhatsApp field overflowed its column. `min-w-0` on the root fixed it.

**Manual — still to do after deploy:**
- `/assessment` — answer a few questions, hit refresh, confirm the answers return; open in a new
  tab and confirm it is empty.
- `/staff/users` — create and edit a staff user, confirm an existing mobile number hydrates into
  the picker correctly.
- LIA officer edit — confirm a legacy free-text country renders and normalises on save.

---

## 7. Known limitations

**1. A shared calling code shows the canonical country's flag.** Documented in
`country-codes.ts` at `CANONICAL_FOR_SHARED_CODE`. Calling codes are many-to-one — `+1` is 25
countries, `+44` is four, `+7` is two — so the country cannot be recovered from a number alone.
A Canadian number reopened in an edit form shows the US flag; a Jersey number shows the UK flag.

**The data is not affected**: the E.164 string round-trips byte for byte, asserted for every
country in `phone.test.ts`. Only the flag glyph is approximate. Fixing it means storing the
country separately alongside every phone number — a schema change and a platform-wide backfill
to correct a cosmetic detail. **Reviewed and accepted; do not "fix" this without revisiting the
storage shape.**

**2. Flag emoji do not render on Windows.** Windows ships no font for regional-indicator
sequences, so the picker shows the letters (`NZ`) rather than 🇳🇿. This is pre-existing
behaviour shared with `CountryPicker` and `CountrySelect`, not a regression, and it is correct
on macOS, iOS, and Android.

**3. ~~`LeadForm` is orphaned in this repo.~~ Resolved — it was deleted.** Nothing imported it;
the live marketing lead form is on `www.sorenavisa.com`, a separate property (see the Railway
URL topology note). It was updated for consistency during this phase and verified through a
temporary harness, then removed once that was confirmed, along with `lib/schemas/lead.schema.ts`.
The backend endpoint it posted to is untouched and still live.

**4. `LeadForm` had a pre-existing bug that blocked submission — recorded here because the real
marketing form may share it.** `studyLevel` and `preferredLanguage` rendered an empty `""`
option, which fails their `z.enum()`, and neither field rendered its error message — so the form
silently did nothing when Send was pressed. It went out with the component rather than being
fixed. **If the marketing site's form is built from the same schema, it has the same bug**: fix
by making both `.optional().or(z.literal(''))`, or by stripping empty strings before validation.

**5. `countryOfPosting` legacy values were not audited in production.** The local database has
zero officer rows. Legacy free text renders through unchanged (without a flag) and normalises to
an ISO code on the next save, so nothing breaks either way — but the number of affected
production rows is unknown.

**6. Autosave does not cover the multi-step UX, because there isn't one yet.** The draft format
carries a `step` field that is always written as `0`. It is there so the multi-step work can use
it without a format change and without invalidating drafts.

---

## 8. How a future developer would extend this

**Adding a country or phone field anywhere.** Use the existing components; do not write a new
one, and do not use a plain `<input>` or `<select>`:

```tsx
<CountrySelect value={value || null} onChange={(code) => setValue(code ?? '')} />
<PhoneInput value={value} onChange={setValue} />
```

With `react-hook-form`, wrap in `<Controller>` — both are controlled components, so `register()`
will not work. Four call sites in this commit show the pattern.

**Changing the assessment's questions.** If a change makes existing drafts wrong — a key
renamed, an option list narrowed — bump `DRAFT_VERSION` in `assessment-draft.ts`. Old drafts are
then discarded rather than migrated, which is the intended trade: a stale draft is worth far less
than a form in a state no code expects.

**Building the multi-step UX.** Pass the current step as the second argument to `saveDraft`, and
read `draft.step` back on restore. The format already supports it.

**Do not move autosave to the database.** The session-scoped behaviour is a product decision, not
a limitation — see §7 of the constraint list below. A persistent draft would need an anonymous
identifier in a cookie for a public route, a retention policy, and would leave half-finished
answers about health and criminal history in the database for visitors who never submitted.

**If a country ever needs a non-standard trunk-prefix rule**, add it to `KEEPS_TRUNK_ZERO` in
`phone.ts`. Currently only `IT` and `VA`, where the leading zero is part of the subscriber
number. Everywhere else the zero is stripped because the country code replaces it.

---

## 9. Security layers applied

**No new attack surface.** No new endpoint, no new stored field, no change to what is persisted
or to any authorisation check. The three fields whose UI changed are gated exactly as before.

**Reduced data exposure.** Choosing `sessionStorage` over a database draft means half-finished
`/assessment` answers — which include health status, criminal history, and visa refusals — are
never persisted server-side for a visitor who does not submit. There is nothing to retain, leak,
or be asked to delete.

**Fail-safe storage access.** Every `sessionStorage` call is wrapped: Safari private mode and
locked-down enterprise browsers throw on access, and a broken autosave must never break the
form. Asserted by a test that injects a throwing storage object.

**Input is narrowed, not widened.** Free-text country and phone fields became constrained
pickers. `composeE164` discards every non-digit character, so nothing a user types survives into
the stored value except digits and a leading `+`. A malformed draft — corrupt JSON, wrong
version, a non-object `answers` — is discarded rather than fed into the form.

---

## 10. Rollback instructions

Frontend-only, no data written, so rollback is a plain revert:

```bash
git revert a6d1317
git push origin main
```

Railway redeploys the frontend service (`ample-dream`) automatically. The backend service is
unaffected — nothing in this commit touches `backend/`.

**Nothing else needs undoing.** No migration to reverse, no backfill to re-run, no data written
in a new shape. Any `sv_assessment_v2_draft` key in a visitor's `sessionStorage` dies with their
tab; after a revert the key is simply ignored.

**Partial rollback**, if only one of the three pieces is a problem:
- Autosave only → revert `assessment-draft.ts` + the two effects and the `clearDraft()` call in
  `page.tsx`.
- Phone only → revert `PhoneInput.tsx`, `phone.ts`, the `DIAL_CODES` block, and the six call
  sites. `country-codes.ts`'s original exports are untouched additions-only.
- Country only → revert the `CountrySelect` swaps in `page.tsx` and `EditOfficerButton.tsx`.
  Note this reinstates the nationality/ISO correctness risk in §1.

---

## Commits in this session

| Hash | Message |
|---|---|
| `a6d1317` | feat(forms): session-scoped autosave, and searchable country/phone pickers platform-wide |
| `24b4350` | docs: Phase 36 handover |
| `0d32f0c` | chore(frontend): delete LeadForm — dead code with no route and no live use |

Previous session tip was `d5d7fa0` (the q16/q25 StudyField id/key fix).

---

## Still pending before `/assessment` can replace `/scorecard`

Unchanged from the previous handover except that autosave and the country pickers are now done:

- ~~Session-scoped autosave~~ — **done this phase**
- ~~Country pickers~~ — **done this phase**
- Multi-step UX
- Validation polish
- ~12 UI strings to Persian + an RTL pass (the scorecard *questions* explicitly do **not** need
  translating)
- The result-gate decision
- AI foundation + Recommendation Explanation Agent
- Programme enrichment data
- Wiring vitest into CI — currently the 29 frontend tests only run locally, which means the two
  suites added this phase do not yet guard anything on a push

## Other open items (unchanged)

- Seafield's 2 deferred programmes — needs the importer to update in place
- 4 institutions without coordinates
- The unexplained 2026-08-05 Future Skills activation
- Bulk-activate button (top follow-up in the curation phase doc)
- Remaining launch work: OPS portal, Sales portal, legacy `/admin/*`, Student portal My Case /
  Payments, client portal polish
