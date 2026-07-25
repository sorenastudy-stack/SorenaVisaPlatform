# Phase 15 — Staff Allocation & Language/Country UX

End-of-phase handover for two related pieces of work: (a) upgrading the client
"First language" + "Country of residence" fields to searchable dropdowns with full
display names everywhere, and (b) finalising the two auto-allocation systems that
depend on that language data — the Client Officer language-match fallback and the
Admission Officer trigger timing. Built, tested, and shipped; a one-off legacy
country-data normalization was also run against production.

**Date:** 2026-07-24 → 2026-07-25
**Commits (this phase):**
- `8baf7f3` — feat(scorecard): searchable dropdowns for First language + Country of residence, full names everywhere
- `9cd8732` — feat(alloc): English-speaker Client-Officer fallback + Admission Officer assignment at LIA-signed

---

## 1. What this phase does

**Part A — Language/Country UX (`8baf7f3`).** The scorecard's "First language" and
"Country of residence" fields are now proper **searchable comboboxes** (search box
pinned at the top, full display names — "Persian (Farsi)", "Chile" — not raw codes),
built on one shared component so they look and behave identically. The same
searchable pattern + clean-name display was applied across the staff surfaces too.
Storage formats: language stays a lowercase ISO 639-1 code in
`Contact.preferredLanguage` (**unchanged**); country now stores the ISO 3166-1
**alpha-2 code** in `Contact.countryOfResidence` (a deliberate change from messy
free text — see §7). This makes the language-matching auto-assignment reliable
(clean codes in, no silent English fallback) and eliminates dirty country data.

**Part B — Auto-allocation finalisation (`9cd8732`).**
- **Client Officer** (`assignConsultantToCase`): when no officer speaks the client's
  language, the fallback pool is now **English-speaking officers specifically**
  (least-loaded among them), instead of "all officers regardless of language". Only
  when no English speaker exists at all does it use the full pool as a last resort.
- **Admission Officer** (`assignAdmissionToCase`): now also fires at the **LIA-signed**
  moment (the Phase C partial-webhook branch), so the owner slot is filled earlier
  in the lead-based flow rather than waiting for full contract completion or the
  ACCOUNT_OPENING payment.
- **Equal-split method** is unchanged and confirmed correct: **least-loaded** by
  current active caseload, for both roles.

## 2. Files created or changed

Pulled from `git show --stat 8baf7f3` (10 files) and `git show --stat 9cd8732` (4 files).

**Part A — `8baf7f3`**

*Created*
- `frontend/src/components/common/SearchableSelect.tsx` — the shared searchable
  single-select combobox (search box at top, full-name options, stores a code; no
  next-intl dependency, so it works in the public scorecard and staff surfaces alike).
- `frontend/src/components/scorecard/ScorecardCountrySelect.tsx` — country picker
  over the full ISO 3166-1 catalogue (flags + localised names), stores alpha-2.

*Changed*
- `frontend/src/components/scorecard/LanguageSelect.tsx` — rewritten onto
  `SearchableSelect` over the full ISO 639-1 option list (was a hybrid select + Other).
- `frontend/src/lib/scorecard/questions.ts` — new `'country'` question type;
  `current_country` changed from `'text'` → `'country'`.
- `frontend/src/components/scorecard/ScorecardForm.tsx` — renders the `'country'` type.
- `frontend/src/components/staff/team/StaffEditClient.tsx` — staff spoken-languages
  editor is now a searchable full-list picker + removable chips (was 6 hard-coded chips).
- `frontend/src/components/staff/team/StaffListClient.tsx` — language chips use the
  full `languageLabel` (ISO 639-1) instead of the 6-item `langLabel`.
- `frontend/src/app/sales/leads/[id]/page.tsx` — lead-detail language shows the full
  name instead of a raw upper-cased code.
- `backend/src/leads/client-id.ts` — `resolveCountryCode` now accepts an alpha-2 code
  directly (GB→UK convention preserved) AND still resolves legacy free text.
- `backend/src/leads/client-id.spec.ts` — tests for both the code and legacy-name paths.

**Part B — `9cd8732`**
- `backend/src/cases/lia-assignment.service.ts` — `assignConsultantToCase` pool
  priority: language-match → **english-fallback** → all-fallback; `poolKind` added to
  the audit row. Language-match-first logic unchanged.
- `backend/src/contracts/contracts.service.ts` — `assignAdmissionToCase(caseId)`
  added to the LIA-signed partial branch of `handleDocusealWebhook` (never-throw,
  idempotent).
- `backend/src/cases/lia-assignment.consultant.spec.ts` — **new** DB-backed spec
  (language-match, english-fallback ×2, all-fallback edge, least-loaded 2/2/2).
- `backend/src/contracts/contracts.phase-c.spec.ts` — added the admission-at-LIA-signed
  idempotency test.

The Client Officer pool priority (the core allocation change):

```ts
if (clientLang !== 'en' && langAware.length > 0) { pool = langAware;        poolKind = 'language-match'; }
else if (englishSpeakers.length > 0)             { pool = englishSpeakers;  poolKind = 'english-fallback'; }
else                                             { pool = candidates;       poolKind = 'all-fallback'; }
// least-loaded pick within the chosen pool
```

## 3. Database tables / columns added

**None — no schema migration.** `Contact.preferredLanguage` (String),
`Contact.countryOfResidence` (String), and `User.languages` (String[]) are all
unchanged in the schema.

**One deliberate VALUE-format change (not a schema change):**
`Contact.countryOfResidence` now holds an ISO 3166-1 **alpha-2 code** (e.g. `NZ`)
for new entries, instead of free-text names. This is the format the staff country
picker and the Client ID generator already use. `displayCountry(code)` renders the
full name; `resolveCountryCode` reads the code directly (and still resolves any
legacy free text as a safety net), so Client ID generation is unaffected.

**Legacy data normalization (one-off, production).** Existing free-text
`countryOfResidence` values were normalized to alpha-2 codes using the same
`i18n-iso-countries` name→code mapping — after a backup of the `contacts` table and
a reviewed dry run. **17 rows updated** (New Zealand→`NZ` ×10, Iran→`IR` ×6,
Australia→`AU` ×1); **1 unmappable typo ("chili") was left untouched** and flagged
for manual review rather than guessed at.

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None new.** Country + language display/search use the already-bundled
`i18n-iso-countries` library and the in-repo curated ISO 639-1 language list
(`@/lib/languages`). No network lookups.

## 6. How to test it works

**A. Scorecard dropdowns** (`/scorecard`)
1. "Current country of residence" is now a searchable dropdown — type "chi" → see
   Chile / China with flags; pick Chile → trigger shows "🇨🇱 Chile". Submit (throwaway
   email) and confirm the new `Contact.countryOfResidence = 'CL'` and the lead's
   `clientId` prefix resolved correctly (e.g. `CL-2026-000xxx`).
2. "First language" — type "per" → "Farsi (Persian)"; confirm `preferredLanguage = 'fa'`.

**B. Client Officer language allocation**
1. In `/staff/team`, give two Client Officers different `languages` (one `fa,en`, one
   `en` only) via the searchable language picker.
2. A `fa`-language lead → its case's Client Officer is the `fa` speaker (audit:
   `CONSULTANT_AUTO_ASSIGNED`, `poolKind: 'language-match'`).
3. A lead in a language nobody speaks, with English officers available → goes to an
   **English** officer (`poolKind: 'english-fallback'`), never a non-English idle one.
4. Several English-client cases across 2–3 equal officers → they **spread** (least-loaded),
   not piled on one.

**C. Admission Officer timing (lead-based flow)**
1. Ensure an active Admission Officer (role `CONSULTANT`) exists.
2. Send a contract lead-based; client signs → case auto-creates, Admission slot empty.
3. LIA signs (Director pending) → the Admission slot is **now filled** (alongside the
   $200 invoice + STUDENT promotion).
4. Director signs → Admission Officer **unchanged** (idempotent).

**Automated:** `lia-assignment.consultant.spec` (pool priority + least-loaded 2/2/2),
`contracts.phase-c.spec` (admission at LIA-signed, idempotent), `client-id.spec`
(code + legacy-name resolution) — all green.

## 7. Known limitations

- **`Contact.countryOfResidence` is now mixed old/new during transition** — new rows
  are alpha-2 codes; the production backfill converted the resolvable legacy names.
  The one unmappable value ("chili") remains as-is and needs a manual fix (`CL`) if
  desired. `displayCountry` is fail-soft, so any residual free text still renders
  without error.
- **The scorecard "First language" list is a curated ISO 639-1 set (~89 languages)**,
  chosen for good display names ("Farsi (Persian)"), not the entire ISO catalogue.
  It covers effectively all real clients; extend `@/lib/languages` if a gap appears.
- **`LeadForm.tsx` was left untouched** — it has an old raw language `<select>` storing
  names, but it is **dead code** (not imported/rendered anywhere). Remove separately.
- **Client language depends on the scorecard being filled in** — a lead created by a
  path that doesn't capture `first_language` has `preferredLanguage = 'en'` and so
  routes via the English-fallback pool (correct, by design).
- **Admission Officer is assigned at LIA-signed, not at client-signed** — the case
  exists at client-signed (Phase B) but its owner is filled one step later, at
  LIA-signed, matching the invoice/promotion timing.

## 8. How a future developer would extend this

- **Reuse the searchable dropdown** anywhere: `SearchableSelect`
  (`frontend/src/components/common/SearchableSelect.tsx`) takes `{ value, onChange,
  options: { value, label, glyph?, searchExtra? }[] }`. Country options come from
  `getSearchableCountries(locale)` in `@/lib/country-codes`; language options from
  `ALL_LANGUAGE_OPTIONS` in `@/lib/languages`.
- **Change the Client Officer pool logic:** `assignConsultantToCase` in
  `backend/src/cases/lia-assignment.service.ts` — the `poolKind` branch is the single
  place; `poolKind` is written to the audit for observability.
- **Change the Admission trigger timing:** the call is in the LIA-signed branch of
  `handleDocusealWebhook` (`contracts.service.ts`), next to the invoice/promotion
  calls; the send / full-completion / ACCOUNT_OPENING call sites remain as idempotent
  safety nets and must stay.
- **Swap least-loaded for round-robin** (if ever wanted): the load is `c.consultantCases`
  / `c.cases` length from `findActiveConsultants` / `findActiveAdmissionSpecialists`;
  a round-robin would need a new persisted per-role counter (none exists today).

## 9. Security layers applied

- **No new trust surface.** All changes are UX/display + assignment logic; no new
  endpoints, secrets, or role gates.
- **Assignment stays server-side + audited.** Both auto-assign methods run in a
  transaction and write an audit row (`CONSULTANT_AUTO_ASSIGNED` with `poolKind`,
  `ADMISSION_AUTO_ASSIGNED`), so every automatic allocation is traceable.
- **Language matching keys on language only** — nationality/country is never read in
  the consultant/pastoral assignment path (existing compliance note, preserved).
- **Client ID resolution is fail-soft** — an unrecognised country value resolves to
  the `TEST` prefix rather than erroring, so dirty/edge data can never break lead
  creation.
- **The production data normalization was backup-first + dry-run-reviewed**, and
  refused to guess unmappable values.

## 10. Rollback instructions

No schema migration, so rollback is a git revert (+ optional data note):

1. **Revert both:** `git revert 9cd8732 8baf7f3`. This restores the previous field
   UX (language hybrid picker; country free-text input), the previous Client Officer
   fallback ("all officers by load"), and removes the Admission-at-LIA-signed call
   (the later call sites still assign the owner at full completion / payment).
2. **Revert only the allocation change** (keep the dropdowns): `git revert 9cd8732`.
   Safe and independent — the two commits don't depend on each other at runtime.
3. **Revert only the dropdowns** (keep allocation): `git revert 8baf7f3`. Note the
   scorecard would again store free-text country; the code-aware `resolveCountryCode`
   is harmless to keep, but if fully reverting, legacy name resolution still works.
4. **Country data:** the normalized `countryOfResidence` codes are valid regardless of
   which code version is deployed (`resolveCountryCode` + `displayCountry` handle both
   codes and names). No data rollback is needed; the pre-normalization `contacts`
   backup CSV exists in the scratchpad if ever required.
