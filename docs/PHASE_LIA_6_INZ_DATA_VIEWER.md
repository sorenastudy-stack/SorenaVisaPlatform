# PR-LIA-6 — Consolidated INZ application data viewer (+ frontend port auto-kill)

One page, every INZ-relevant field for a case, one click each to clipboard. The LIA was previously hunting through ~20 student-side pages to copy values into the official INZ portal; this PR turns that into a single read-only surface with per-field, per-entry, per-section, and full-application copy buttons. A small Part B dev-tooling addition mirrors the backend port-kill fix to the frontend.

## 1. What this PR does

Adds `GET /cases/:caseId/inz-data` — a read-only aggregator that joins across 14 visa-* models + `AdmissionEducationEntry` + `Contact` and returns a structured payload organised by INZ portal section. Every encrypted PII field (`*Encrypted` Bytes columns: names, passport numbers, addresses, free-text descriptions, etc.) is decrypted server-side; the wire response is plaintext. Every view writes an `LIA_INZ_DATA_VIEWED` audit row — the compliance trail for who accessed which case's PII and when.

The frontend page at `/lia/cases/[id]/inz-data` renders 14 collapsible sections. Each section knows its own completeness ("3 of 10 fields", "5 entries", "Recorded"/"Not recorded") and ships with a Copy button. Empty sections default to collapsed; sections with data default to expanded (Option C from the spec). Three clipboard variants: per-field (small icon next to each value), per-entry (button on each array-item card), and per-section / per-application (pill in the section header / page header).

The viewer is **strictly read-only**. No edit affordance anywhere. The LIA copies values out, then types or pastes into INZ's portal manually. Future PRs (LIA-6.1, LIA-6.2) may add editing or field-level verification on top; this PR ships the foundation.

A "View INZ application data" call-to-action sits at the top right of the case-detail header so the LIA never has to type the URL.

**Part B** is a small dev-tooling improvement layered on PR-LIA-2's port-kill fix: a `predev` script in the frontend's `package.json` that points at the existing `backend/scripts/kill-port.js` (which already accepts multiple port numbers as positional args, so no script change). Stops the recurring port-3000 collision when the LIA dev server orphans across sessions.

No new env vars. No new npm dependencies. No DB migration — the new endpoint reads from the existing visa-* models written by the student-side flows; no new state.

## 2. Files changed

Backend (new):
- `src/inz-data/inz-data.module.ts` — wires `PrismaModule` + `CryptoModule`.
- `src/inz-data/inz-data.controller.ts` — `@Controller('cases')`, `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`. One route: `GET :caseId/inz-data`. Writes the audit row after a successful read.
- `src/inz-data/inz-data.service.ts` — `getInzDataForCase(caseId)` returns the full `InzDataPayload`. Owns the cross-model joins, the PII decryption, the empty-state handling, and the pre-computed `completeness` summary. Exports the `InzDataPayload` type.

Backend (existing):
- `src/app.module.ts` — registers `InzDataModule`.
- `src/common/audit/audit.helper.ts` — new `LIA_INZ_DATA_VIEWED` case in `summarizeAuditEntry`.

Frontend (new):
- `src/app/lia/cases/[id]/inz-data/page.tsx` — server component. 14 sections. ~900 lines of which roughly half is the pure formatters that produce the clipboard text.
- `src/app/lia/cases/[id]/inz-data/CopyButton.tsx` — client component. Three variants (`field` / `entry` / `section`). `navigator.clipboard.writeText` with an `execCommand` fallback for non-secure contexts. 2-second "Copied" confirmation.
- `src/app/lia/cases/[id]/inz-data/InzSection.tsx` — client component. Collapse/expand toggle, count badge with three tones, embedded section-level Copy button.

Frontend (existing):
- `src/app/lia/cases/[id]/page.tsx` — header row gains a "View INZ application data →" call-to-action button on the right.

Part B (dev tooling, single file):
- `frontend/package.json` — adds `"predev": "node ../backend/scripts/kill-port.js 3000"` and a `"kill-frontend"` convenience script. No new dependency; reuses the existing kill-port.js from PR-1da6a95.

No new npm dependencies, no new env vars, no Prisma migration.

## 3. Naming bridge — spec vs schema

The user's PR spec used some convenience names that don't quite match the actual Prisma model names. The endpoint surfaces the spec names in its response shape (so downstream consumers don't have to learn schema-internal naming), but the service reads from the actual underlying tables:

| Response key | Underlying model(s) | Note |
|---|---|---|
| `applicant` | `Contact` + `VisaApplication` | Composed: contact name/email/phone overlaid with visa passport / address fields |
| `citizenships` | `VisaOtherCitizenship` | `VisaCitizenship` doesn't exist in the schema |
| `tbCountries` | `VisaTbRiskCountry` | `VisaTbCountry` doesn't exist; "risk" is the actual model name |
| `educationEntries` | `AdmissionEducationEntry` + `VisaEducationSupplement` | Education is admission-side; visa adds a 0..1 supplement |
| `employmentEntries` | `VisaEmploymentEntry` | The `entryKind` field discriminates govt/military/regular employment |
| `unemploymentEntries` | `VisaUnemploymentEntry` | Standalone |
| `partner` / `formerPartners` / `children` / `parents` / `siblings` / `nzContacts` | `VisaPartner` / `VisaFormerPartner` / `VisaChild` / `VisaParent` / `VisaSibling` / `VisaNzContact` | One-to-one (partner) + many to-many (others) |
| `militaryHistory` | Boolean flags on `VisaApplication` + `VisaMilitaryService[]` | `VisaMilitaryHistory` doesn't exist; the questionnaire flags live directly on the parent, with service records as children |
| `travelHistory` | `VisaTravelHistoryEntry` | `VisaTravelHistory` doesn't exist; entry-suffixed model name |
| `immigrationAssistance` | `adviser*Encrypted` fields on `VisaApplication` | No separate model; consolidated onto the parent |
| `supportingDocuments` | `VisaSupportingDocument` | Metadata-only (no `fileUrl`); the LIA can't download from here, only see what was uploaded. PR-LIA-5's documents card on the case detail handles downloads where available. |

`VisaCase`, `VisaSupportTicket`, `VisaSupportTicketMessage`, `VisaCaseFileNote`, `VisaMeeting`, `VisaChat*`, `VisaCaseAssignment`, `VisaOtherEvidenceEntry` are intentionally **not** included — they're operational / conversational data, not INZ form fields.

## 4. Endpoint contract

| Method | Path | Role gate | Purpose |
|---|---|---|---|
| GET | `/cases/:caseId/inz-data` | `LIA / ADMIN / SUPER_ADMIN / OWNER` | Read-only consolidated INZ payload. Writes `LIA_INZ_DATA_VIEWED` audit row on success. |

### Response shape (`InzDataPayload`)

Top-level keys (each described in §3 above):

```ts
{
  generatedAt: ISO string,
  case: { id, stage, createdAt } | null,
  applicant: { fullName, dateOfBirth, gender, email, phone,
                countryOfBirth, countryOfResidence,
                passportNumber, passportExpiry, passportCountry },
  citizenships: [{ id, country, holdsPassport }],
  tbCountries: [{ id, country, totalDurationDays }],
  educationEntries: [{ id, institution, qualification, fieldOfStudy,
                       startYear, endYear, country, completed,
                       supplement: { ... } | null }],
  employmentEntries: [{ id, entryKind, employer, role, duties,
                        startDate, endDate, country, state,
                        supervisorName }],
  unemploymentEntries: [{ id, startDate, endDate, activity, financialSupport }],
  partner: { ... } | null,
  formerPartners: [{ ... }],
  children: [{ ... }],
  parents: [{ ... }],
  siblings: [{ ... }],
  nzContacts: [{ ... }],
  militaryHistory: { everUndertakenMilitaryService, militaryServiceCompulsoryHome,
                     wasExemptFromMilitaryService, exemptExplanation,
                     services: [{ ... }] } | null,
  travelHistory: [{ ... }],
  immigrationAssistance: { ... } | null,
  supportingDocuments: [{ id, docType, fileName, mimeType, sizeBytes, uploadedAt }],
  completeness: {
    applicant: { filled, total },              // count non-null fields / total field count
    citizenships:        { count },
    tbCountries:         { count },
    educationEntries:    { count },
    employmentEntries:   { count },
    unemploymentEntries: { count },
    family: { partner: boolean, formerPartners: count, children: count, parents: count, siblings: count },
    nzContacts:          { count },
    militaryHistory:     { filled: boolean },  // true if ANY field is non-null
    travelHistory:       { count },
    immigrationAssistance: { filled: boolean },
    supportingDocuments: { count },
  }
}
```

If the student hasn't started a visa application yet, the endpoint **does not 404** — it returns the payload with empty arrays / `null` objects throughout. The UI renders empty-state messages per section. The `case` field is `null` only when the `caseId` itself doesn't exist.

### Completeness semantics

- **Applicant** — `Object.values(applicant).filter(v => v !== null && v !== '').length` against the total field count. Pre-computed server-side so the UI doesn't introspect every field.
- **Array sections** — `count` is just `array.length`.
- **Object sections (`partner`, `militaryHistory`, `immigrationAssistance`)** — `filled: true` if any field on the object is non-null. The `partner` field is exposed as part of `family` for completeness UX.
- **Family** — exposes `partner` (boolean) + the count of each related-person array, since "family" is rendered as one bucket but it's actually six independent collections.

### Audit row

```
{
  eventType: 'LIA_INZ_DATA_VIEWED',
  entityType: 'CASE',
  entityId:   '<caseId>',
  newValue:   { caseId: '<caseId>' },
  actorNameSnapshot: '<name>',
  actorRoleSnapshot: '<role>',
}
```

The summary helper renders this as `"LIA viewed consolidated INZ application data"`.

Audit is best-effort — wrapped in try/catch so a transient DB hiccup on the audit insert doesn't fail the read. The read itself is single-quasi-atomic (one logical operation; multiple `findMany` queries run in parallel via `Promise.all`).

## 5. Clipboard text format

Per the spec, the on-clipboard text is plain text — no markdown, no JSON. The formatters produce one of three shapes:

**Per-field**: the raw value (e.g. `"Reza Ahmadi"`).

**Per-entry** (inside arrays — Education, Employment, etc.):
```
Institution: University of Tehran
Qualification: Bachelor of Science
Field of study: Computer Science
Country: IR
Start year: 2018
End year: 2022
Completed: Yes
```

**Per-section** / per-application: section title + every entry, two newlines between entries.

**Full application** (the page-header "Copy entire application" button): every section joined with a thick visual separator (`═══════════`) so the LIA can scan or split as needed.

## 6. Decryption / display

Every `*Encrypted` Bytes column read by the service is decrypted with `CryptoService.decrypt(Buffer.from(payload))`. A failed decrypt (key rotation, corrupted row) returns `''` rather than throwing — the field renders as `—` and the rest of the payload still ships. The error is silent on the wire; the audit log records the view event regardless.

Decrypted fields surface as plaintext on the wire response. The LIA is authorised to see this PII; the audit row is the compliance gate.

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **No migration to apply** (this PR doesn't touch the schema).
3. **Backend smoke test:**
   ```bash
   curl -s -i -H "Authorization: Bearer <lia-jwt>" \
     http://localhost:3001/cases/<caseId>/inz-data | head -5
   ```
   Expect `200` + a JSON payload. Hit it as a `STUDENT` — expect `403`. Hit it with a bogus `caseId` — expect `404 Case not found`.
4. **Audit row:**
   ```sql
   SELECT id, "eventType", "newValue", "actorNameSnapshot", "createdAt"
     FROM audit_logs
    WHERE "eventType" = 'LIA_INZ_DATA_VIEWED'
    ORDER BY "createdAt" DESC LIMIT 5;
   ```
   One row per view; `newValue.caseId` matches the requested path.
5. **Frontend page:** log in as an LIA, open `/lia/cases/<id>`. The header now has a "View INZ application data →" button on the right. Click it.
6. **Sections render** with their completeness badges (gray for empty, blue for partial, emerald for complete). Empty sections are collapsed; populated sections are expanded. Toggle one — the body slides in/out.
7. **Copy a field** — small icon next to a value. The icon flashes to a green check for 2 seconds. Paste into Notepad: just the value.
8. **Copy an entry** — button on an Education entry card. Pasting yields the multi-line "Institution: …\nQualification: …" block.
9. **Copy a section** — button on the Education section header. Pasting yields "Education entries\n\n" + every entry separated by blank lines.
10. **Copy the entire application** — button at the page header. Pasting yields all 14 sections joined with the `═══════════` separator. Length runs to a few KB; the browser doesn't complain.
11. **Empty-state case** — visit `/lia/cases/<id>/inz-data` for a case whose student hasn't started a visa application. Page renders with every section showing "No data entered yet." and gray badges. No errors.
12. **Role gate at the page level** — the existing layered LIA gate already covers this; no additional page-level redirect is needed beyond the layout's check.
13. **Back link** — top-left `← Back to case` returns to `/lia/cases/<id>`.

**Part B port-kill smoke test** (already verified during development):
14. `cd frontend && npm run dev` — first line of the log reads `[kill-port] Port 3000 free.` then Next.js boots.
15. Without killing it, open a second terminal: `cd frontend && npm run dev`. First line: `[kill-port] Killing PID <N> on port 3000 — node ... start-server.js`. Then the new instance boots cleanly.
16. `npm run kill-frontend` from the frontend dir kills any port-3000 squatter without launching anything.

## 8. Known limitations

- **No editing.** Strictly read-only. Future PR (LIA-6.1) might add edit affordances, but that means re-validating against the per-step rules that already live in the student-side visa service.
- **Education entries come from admission, not visa.** The student's authoritative education list is on `AdmissionEducationEntry`; the visa `VisaEducationSupplement` adds month-granularity dates + state/town/award-flag. If the admission list gets edited (PR-C2 etc.) the visa supplement may go stale. The UI surfaces whatever is there; we don't try to reconcile.
- **Some fields not surfaced** — the `VisaApplication` model has ~140 columns. We surface the high-value INZ-form-mapped ones; obscure flags (`heldReligiousCulturalPosition`, `studyingMultiYear`, character-declaration questions, etc.) aren't currently in the payload. If the user needs them, the response shape and frontend rendering both extend trivially.
- **Spec name mismatches** — see §3. Documented; no plan to rename schema models since they're load-bearing for the student-side endpoints.
- **No PDF / Excel export.** Clipboard-only. PR-LIA-12 will add the file-export plumbing.
- **No field-level "verified by LIA" checkmarks.** PR-LIA-6.2 territory.
- **No diff view.** If the client edits values while the LIA has the page open, the LIA needs to refresh. No "you have unviewed changes" prompt.
- **No translation.** Free-text fields render in whatever language the client typed (often Persian/Farsi). The LIA can copy and paste into Google Translate manually if needed.
- **No "ready to submit" workflow.** That's PR-LIA-7 — completeness here is informational only.
- **Failed decrypt produces an empty string**, not an error. If a future key rotation breaks an old row, the affected field renders as `—`. The audit log still records the view. No alert to the user; the row's metadata (`createdAt` etc.) is still visible so a forensic check can find what's broken.
- **Page is ~900 lines.** A lot of repetition in the section/entry/formatter trio (same pattern 14 times). A more generic schema-driven renderer would be slick but would obscure the per-section nuance (e.g. military history's hybrid object+array shape). Kept verbose for readability.
- **N+1 read pattern (~14 parallel queries)** — fine for the current case volume. If a future PR exposes this aggregate in a list ("all cases' INZ data"), it would need flattening into one tabular SQL.
- **Audit is per view, not per copy.** Pressing the "Copy phone" button does not write a separate audit row. The view event is the compliance gate; any further client-side action is out of the audit table's scope.
- **CopyButton's textarea fallback only runs in non-secure contexts** (`http://`, not `https://`). The Vercel/Railway prod deploy is HTTPS, so `navigator.clipboard.writeText` is the primary path. The fallback was tested via local `http://localhost:3000` — works.
- **The "View INZ data" button on the case-detail header** is always rendered to viewers of the page (LIA/ADMIN/SUPER_ADMIN/OWNER per the layout gate). No additional in-page hiding; the destination page's gates cover it.

## 9. How to extend

- **PR-LIA-6.1 — editing.** Add a top-level "Edit on student's behalf" toggle that swaps each `FieldRow` for a controlled input. PATCH each field back to the corresponding student-side endpoint (`PATCH /students/me/visa/*`). Tricky: the student-side endpoints are gated to `@Roles('STUDENT')` — would need either (a) a parallel `/lia/cases/:id/visa/*` set of admin endpoints, or (b) a context-aware role gate that allows LIA-on-behalf-of writes. Decide before writing.
- **PR-LIA-6.2 — field-level verification.** New table `case_inz_field_verifications(caseId, fieldKey, verifiedById, verifiedAt, note)`. UI: a checkmark next to each field; clicking it records the verification. The view-page reads + renders these alongside each `FieldRow`. Useful as a quality-control workflow ("Aria has verified every name field, Sheila has verified every date field").
- **PR-LIA-12 territory — PDF/Excel export.** Once the project-wide file-export utility lands, swap the clipboard buttons for a "Download as PDF" / "Download as Excel" pair. The structured payload is already perfect input.
- **Translation pre-pass.** Inject `TranslationsService` (e.g. wrapping the Anthropic API) and pre-translate Persian/Farsi values to English before serving. Two-tone display: original on left, translation on right. Adds an env-var dependency.
- **"Ready to submit" gate** (PR-LIA-7). Add a `completenessThreshold` per section and a top-level "Ready" badge; if every section is `filled` / `count > 0`, the badge flips emerald. Locks/unlocks an outbound "Submit to INZ" workflow.
- **Diff view.** Snapshot the payload at last-view time (in a new `last_inz_view_snapshots` table keyed by caseId + liaUserId). On the next view, compute a per-field delta and show "Edited since you last viewed" highlights. Requires storing decrypted snapshots — expensive both in DB size and PII surface area.
- **Bulk export across cases.** New endpoint `GET /staff/inz-data/bulk?caseIds=...` returning an array. Pairs with the PR-LIA-3 productivity report ("export all active cases' INZ data as CSV before the Friday submission window").
- **Persist favourite copy templates.** Some LIAs may want to re-arrange the section order or omit certain sections in their copy-to-INZ workflow. A per-user template config (new `lia_inz_copy_templates` table) would let them save and re-apply layouts.

## 10. Security layers applied

- **Layer 1 — Auth.** Class-level `JwtAuthGuard` on the controller. Frontend layout already gates the entire `/lia/*` portal.
- **Layer 2 — Role gate.** `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')` on the controller. Backend authoritative; frontend nav-item gate is UX only. PR-LIA-2's layered redirect pattern is reused for the page-level guard.
- **Layer 3 — Env vars.** No new env vars. Encryption uses existing `ENCRYPTION_KEY` / `ENCRYPTION_KEY_VERSION`.
- **Layer 4 — HTTPS.** Production enforced by Vercel + Railway; the clipboard API requires a secure context, the prod deploy is HTTPS, the fallback for local `http://localhost:3000` is `execCommand('copy')`.
- **Layer 5 — Rate limiting.** Inherits the global 60/min throttler. The endpoint is heavy-ish (~14 parallel queries), but LIAs hit it a handful of times per day, not a flood — no per-endpoint cap added.
- **Layer 6 — Audit log.** Every read writes a `LIA_INZ_DATA_VIEWED` audit row with snapshot columns. The audit pair pattern (`VisaCaseFileNote` + `AuditLog`) used in PR-LIA-1..5 is **not** used here — the file-note pattern matches mutations, not reads. Audit-only is correct for a read endpoint.
- **Layer 7 — File uploads.** N/A — read-only endpoint.
- **Layer 8 — Auto-logout.** Handled by existing session-expiry middleware.
- **Layer 9 — npm audit.** No new dependencies. Baseline unchanged.
- **Layer 10 — DB backups.** No schema changes; existing nightly Postgres backup is sufficient.

**Part B dev tooling.** The `predev` hook + `kill-frontend` script don't change the application's security posture — they only kill orphan Node processes on the dev workstation. The kill-port.js script (from commit 1da6a95) uses `taskkill /F /PID <n>` (Windows) / `process.kill(pid, 'SIGKILL')` (POSIX); it only touches processes the local user already has permission to terminate. No new dependency, no env var, no production-path impact.

**PII handling note.** The endpoint surfaces decrypted PII (names, passport numbers, addresses) to the LIA. This is by design — the LIA is authorised to view this data for the purpose of completing the INZ application on the student's behalf. The audit log is the compliance gate: every view is recorded with `actorNameSnapshot` + `actorRoleSnapshot` so a future audit can trace exactly who viewed which case's data when. The viewer is read-only; no PII is mutated.

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-6 commits
git revert HEAD~1..HEAD

# 2. nothing to drop — no schema changes

# 3. push the revert
git push origin main
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/cases/<id>/inz-data -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
```

The frontend revert also removes the case-detail header button and the `predev` hook from `frontend/package.json`. After rollback the frontend goes back to the pre-PR-LIA-6 boot behaviour (no auto-kill); the user can re-add the hook manually if desired without bringing back the rest of the PR.
