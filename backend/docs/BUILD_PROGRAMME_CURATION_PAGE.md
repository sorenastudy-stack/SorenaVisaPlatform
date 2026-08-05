# REVISED SPEC — replaces the earlier "SubjectArea 33-bucket" version entirely

Yashua stopped the previous plan. Read this whole document — it's a full
replacement, not a patch. Do not seed `sorena_subject_area_mapping.csv`, do not
build a 33-bucket taxonomy, and if that migration/seed already ran, it needs to be
reverted (see "What to undo" below). That entire approach was a misunderstanding
on my (Cowork) side of what Yashua actually wants, corrected directly by him.

## What actually happened

I (the Cowork planning session) had invented an abstraction — a 33-bucket
"canonical subject area" mapping — built by keyword-matching raw labels from three
NZ source workbooks down into generic categories. Yashua uploaded those same three
workbooks and pointed out I had "mixed all the fields together." He's right: the
source files don't need re-bucketing. They already contain exact, per-institution,
per-programme data, verified against each institution's own published pages, and
that data should become the actual system records directly — not get flattened
through my invented taxonomy first.

## What to undo (if already done)

- Do NOT use `SubjectArea` / `ProviderSubjectArea` seeded from
  `sorena_subject_area_mapping.csv` as the source of truth for programme
  subject-area tabs. If that table/migration/seed is already in place from the
  prior instruction, leave the schema (it's harmless, additive) but stop using it
  for this feature — the real subject area per programme comes from the source
  workbooks' own `Subject Area` / `Subject Area (Faculty)` column, scoped per
  institution, not the 33-bucket mapping.
- `ProgrammeArticle` (title+url+sortOrder) and the un-approve
  warn-and-confirm-via-`AdmissionProgrammeChoice` logic from the prior spec are
  STILL CORRECT and unaffected by this revision — keep those.

## The actual source data — confirmed by direct inspection of all three workbooks

Attached to this brief: the three source Excel files. Each has a sheet called
`Programme Database` with the real header row at **row 4** (rows 1-3 are a title
and scope note — skip them), then one full data row per programme starting at row
5.

- `NZ_International_Polytechnic_Programmes_2026_2027.xlsx` — **11 institutions
  (ITPs), 278 programme rows**, 29 columns
- `NZ_International_PTE_Programmes_2026_2027.xlsx` — **72 institutions (PTEs), 272
  programme rows**, 26 columns
- `NZ_University_Programmes_Level79_2026_2027.xlsx` — **8 universities, 574
  programme rows**, 25 columns

**Total: 91 institutions, 1,124 programme rows**, all NZQF Levels 4-9 (universities
capped at 7-9), all student-visa-suitable, each independently verified against the
institution's own published programme page (verification date + status recorded
per row).

### Columns present per programme row (shared across all three files, minor naming
### differences noted)

- `Provider Entity` (ITP/PTE) or `University` — the institution's legal/full name
- `Brand` (ITP/PTE only — a shorter display name, e.g. "Ara" for "Ara Institute of
  Canterbury")
- `Subject Area` (ITP/PTE) or `Subject Area (Faculty)` (University) — **this is
  the real per-institution category label. Use this directly as the tab/grouping
  label for that institution — do NOT map it through any external taxonomy.**
- `Programme / Qualification` — the programme name
- `Major / Strand` — optional sub-specialisation within a programme (often blank)
- `NZQF Level` — 4 through 9
- `Qualification Type` — Certificate / Diploma / Bachelor's / Master's / etc.
- `Delivery` — e.g. "On campus / in-person (may include blended components)"
- `Student Visa Suitable` — confirmation text
- `Campus / City`
- `Duration`
- `Remaining 2026 Intake(s)`
- `Published 2027 Intake(s)`
- `Tuition Fee (NZD)` — free text, e.g. "$26,572 per year" — **parse into a
  structured amount + currency + basis where possible, but also keep the raw
  string; some rows have complex conditional fees (see e.g. "New Zealand
  Certificate in Commercial Barbering" in the ITP file, row 7: "$13,286 per 60
  credits or $26,572 per 120 credits (programme dependent)") — don't force these
  into a single clean number if the source itself is conditional, preserve the
  full text**
- `Fee Basis` — e.g. "per year"
- `Fee Year` — e.g. 2026
- `2027 Fee Status` — free text on whether next year's fee is published yet
- `Academic / Subject Prerequisites` — long free text
- `English Requirement` — long free text (IELTS/PTE Academic requirements etc.)
- `Other Requirements` — free text
- `Scholarship / Study Grant` — free text
- `Programme URL` — the institution's own programme page (the actual live source)
- `Secondary Verification Source` — a second URL used to cross-check
- `Verified Date` — when this row was last checked against the live source
- `Verification Status` — e.g. "Double-checked: live programme page + official
  international source"
- `Notes` — free text
- ITP file only: `Projected 2027 Intake(s)`, `2027 Intake Basis`, `2027 Intake(s)
  for Planning` (extra 2027-planning columns not present in PTE/University files)

Each workbook also has `Provider Sources` / `University Sources` (institution-level
metadata — likely website, contact info), `Data Rules`, `QA Checks`, and (PTE/
University only) an `Excluded - No Qualifying Rows` sheet listing rows that were
deliberately excluded from scope — worth a glance but not required reading to
build the importer.

## What to build

### 1. Full import/replacement of institutions and programmes from these 3 files

This is a real data migration, not a demo. Build (or extend the existing importer,
check `programme-import.logic.ts` and the catalog-import phases already built —
`pr_catalog_1_source_change_proposals` / `pr_catalog_2_programme_candidates`) an
import path that reads all three workbooks and:

- **For each of the 91 institutions**: check if a matching `education_providers`
  row already exists (match on name — check existing matching logic before writing
  new rules, current importer may already have a provider-matching approach from
  the earlier catalog-import phases). If it exists, leave the existing
  admin-configured fields (commission terms, agreement dates, status, etc.) alone
  — this import does not touch that. If it does NOT exist yet, **create it**, with:
  - Name from `Provider Entity` / `University`
  - Type: College/PTE/University as appropriate (ITP → likely "College" or
    whatever existing type enum covers polytechnics — check
    `education_providers.type` enum values already in use)
  - Country: New Zealand
  - **Status: set to a state that means "not yet under contract" — do NOT default
    to `ACTIVE`.** Yashua confirmed he doesn't have agreements with all of these
    institutions yet. Check the existing `status` enum on `education_providers`
    (the university edit screen already showed an ACTIVE/other dropdown in an
    earlier screenshot) — use whatever inactive/pending state already exists, or
    if there's genuinely no such state, add one (e.g. `PENDING_AGREEMENT` or
    reuse an existing draft-like status) rather than silently marking new
    institutions as contractually active. **A checkbox/toggle on each institution
    in the admin UI lets Yashua flip it active once he actually has a signed
    agreement — build or reuse that toggle.**
- **For each of the 1,124 programmes**: create an `education_programmes` row
  scoped to its institution, with every column from the source file stored (see
  field list above). Store both structured fields (level, qualification type,
  duration, etc.) AND the raw tuition fee string, English requirement text,
  prerequisites text, etc. — this is exactly the "verified institutional data"
  the platform's core principle already requires, don't trim it down.
  - **Programme status: create as `pending`, same as the existing import
    convention** — these still need an explicit approve action from Yashua before
    they're eligible for the Recommendation Engine (per `matching.service.ts:54`'s
    existing `reviewStatus: 'APPROVED'` gate). Nothing changes here from the
    original spec — bulk import does not bulk-approve.
  - Store `Subject Area` / `Subject Area (Faculty)` as a plain per-institution
    string field on the programme (e.g. `subjectAreaRaw` or similar) — this
    becomes the tab label for that institution's curation page. No cross-
    institution taxonomy, no bucket mapping.

### 2. Per-institution curation page — same navigation structure as before, tabs
### now come directly from the institution's own data

`/staff/universities/[id]/programmes` (still a real route restructure, as
previously scoped) → shows tabs built from the **distinct `Subject Area` values
that actually exist for THIS institution's imported programmes** (e.g. Ara
Institute of Canterbury's tabs would include "Beauty & Hair", "Business &
Management", etc. — whatever subject areas that specific institution's rows
actually contain). No fixed list of 33, no shared taxonomy across institutions —
each institution's tabs are just whatever its own data has.

Clicking a tab → dedicated page listing every programme under that subject area
for that institution, across all levels together, each with its own approve
checkbox (unchanged from prior spec — still per-programme, not bulk).

### 3. Every field must be editable — this is new and important

Yashua's explicit instruction: **all fields on a programme (and on an institution)
must be editable in the admin UI** — tuition fee, duration, intake dates,
prerequisites, English requirement, scholarship info, programme URL, everything.
This matters specifically because:

- When Yashua manually reviews and approves a programme, he may need to correct or
  update something before approving.
- When a **new Excel upload/update comes in later** (re-upload flow, still
  required per the original spec section 5) or when the **"Run web check now" /
  automated re-check** finds a change (e.g. a tuition fee increase), the
  system needs a place for that update to land for review — and Yashua directly
  asked that both the manual-edit path AND the automated-update path route through
  the same editable-fields UI, not two different mechanisms.
- Practical implication: build the field-editing UI once, generically enough that
  both a human manually editing a field and an automated update proposing a new
  value use the same underlying edit surface. If the existing
  `source_change_proposals` / `programme_candidates` review pattern from the
  catalog-import phases already handles "here's a proposed change, confirm or
  reject" — reuse it for both the manual edit path (skip the proposal step, direct
  edit) and the automated-update path (goes through proposal review, per the
  original re-upload rule: never silently overwrite an already-approved
  programme's live data).

### 4. Institution-level "not yet under contract" checkbox

Every institution created by this import that Yashua doesn't yet have a signed
agreement with should be visually flagged in the institutions list (e.g. a
badge/checkbox showing "No agreement yet" alongside the existing ACTIVE/other
status). Yashua will fill in agreement dates, commission terms, and flip it active
once a real contract exists — this import just needs to make sure new institutions
don't default into looking contractually active when they aren't. Reuse whatever
status/checkbox mechanism already exists on the university edit screen (there's
already a Status dropdown visible in the current UI, per the screenshot from
earlier in this project) rather than building a second parallel flag if one isn't
needed.

### 5. Ongoing re-upload / auto-update — unchanged from original spec, restated

Add an "Upload Excel file" option on the institution's programme page so mid-year
updates (new programmes, changed tuition, etc.) can be applied. New programmes →
`pending`, need approval. Changes to already-approved programmes' fields → route
through change-proposal review (see section 3 above), never silent overwrite. This
requirement is unchanged from before, just restated here because it now also
covers ALL the newly-imported fields (tuition, dates, prerequisites, etc.), not
just tuition/scholarship as narrowly scoped earlier.

## Security (per project's standing 10-layer checklist)

- Layer 2 (access control): import, edit, and approve actions restricted to
  OWNER/SUPER_ADMIN, matching existing `@Roles()` patterns.
- Layer 6 (audit log): the bulk import itself, every field edit, every
  approve/un-approve, and every institution active/inactive toggle should write
  audit log entries. A bulk import of 1,124 rows is a significant operation —
  log it as one audit entry summarizing the import (counts of created/updated) is
  fine, doesn't need 1,124 individual entries, but individual field edits after
  the fact do need individual entries.
- Layer 7 (file uploads): reuse existing Excel upload validation.
- Layer 10 (backups): **per the project's standing rule, take a backup before
  running this import**, since it creates ~91 institutions and ~1,124 programmes
  in one operation. Not strictly a "money-touching" migration, but large enough in
  volume that a backup first is the safe default — confirm with Yashua before
  running the actual import against production, run it against local/dev first to
  validate row counts and spot-check a few institutions' data before touching
  production.

## What NOT to do

- Don't build or use a 33-bucket cross-institution taxonomy for this feature —
  reverse course from the earlier spec entirely, per Yashua's direct correction.
- Don't default newly-imported institutions to an active/contracted status.
- Don't silently overwrite an already-approved programme's fields on re-upload —
  route through review, same as before.
- Don't bulk-approve on import — every programme still starts `pending`.
- Don't trim the rich per-programme detail (prerequisites, English requirements,
  scholarship text, verification info) down to a few core fields — store all of
  it, all editable.

## After building — per project's End-of-Phase requirement

Write `docs/PHASE_[N]_PROGRAMME_IMPORT_AND_CURATION.md` per the standard 10-section
template. Note in it explicitly that this supersedes/corrects the earlier
33-bucket `SubjectArea` approach, so a future developer reading history
understands why that table exists but isn't used for this feature.

## Reference files (attached to this brief)

- `NZ_International_Polytechnic_Programmes_2026_2027.xlsx` — 11 ITPs, 278 programmes
- `NZ_International_PTE_Programmes_2026_2027.xlsx` — 72 PTEs, 272 programmes
- `NZ_University_Programmes_Level79_2026_2027.xlsx` — 8 universities, 574 programmes

Real header row is row 4 in the `Programme Database` sheet of each file (rows 1-3
are a title/scope note — skip them).
