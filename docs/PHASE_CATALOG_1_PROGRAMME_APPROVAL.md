# PR-CATALOG-1 (Piece 1) — Owner-triggerable import + per-programme approval queue + uniform visibility

Closes the manual loop the Owner asked to verify: **activate an institution →
import its programmes (Excel) → review + approve each → it appears to students** —
fully clickable, per-programme reviewed, and consistent across both student
surfaces. Designed so **Piece 2** (monthly automated web re-sync) slots into the
same review queue later with no rework.

**Date:** 2026-08-01
**Status:** built + verified (integration smoke 12/12). Piece 2 NOT built (design
locked via the shared `source` field + empty `ProgrammeChangeProposal` table).

---

## The three gaps this closes

1. **No Owner-facing import** → the CLI-only `import-programmes.ts` is now also a
   clickable per-institution upload.
2. **No approval UI** → a real cross-institution "Programme approvals" queue,
   per-programme Approve/Reject (no bulk — per the explicit ask).
3. **Inconsistent visibility** → Apply Step 1 and the matcher now use the
   **identical** rule.

## Shared model (Piece-2-ready, migrated now)

- `enum ProgrammeSource { MANUAL_EXCEL, MANUAL_ENTRY, AUTOMATED_WEB_CHECK }`.
- `EducationProgramme.source` (default `MANUAL_ENTRY`) + `sourceRef` — provenance
  on every programme. Excel import → `MANUAL_EXCEL`; hand-add → `MANUAL_ENTRY`.
- `ProgrammeChangeProposal` (+ `ChangeProposalStatus`) — **created empty now**; its
  producer (the Piece-2 monthly web check) lands proposed field-changes to
  already-approved programmes here, reviewed in the same queue, applied only on
  approval. Locking the shape now means Piece 2 needs no migration.

## Import (shared code path)

The importer's parse/map/upsert was extracted into `providers/import/`:
`programme-import.logic.ts` (pure parsers + StudyField mapping, `studyFieldKey`
now returns an `unmapped` flag) and `ProgrammeImportService` (the DB loop). **One
code path**: the CLI `import-programmes.ts` is a thin wrapper (bulk mode: providers
by `Brand`); the endpoint uses a fixed `providerId` (per-institution). All rows
land `reviewStatus=PENDING, isActive=false, source=MANUAL_EXCEL`.

## Endpoints (`/providers/*` — the provider-catalog domain)

`/providers/*` is its own `@Controller('providers')` that already hosts
create/approve/reject/scholarships (with OWNER-inclusive role constants) and is
what `/staff/universities` calls — so these extend that API rather than splitting
the catalog across prefixes (the session's `/staff/*` endpoints are case/student-scoped, a different domain).

- **`POST /providers/:id/import-programmes`** — `PROVIDER_ADMIN` (OWNER/SUPER_ADMIN),
  multipart Excel upload (memory storage). Infers `--type` from the provider's
  `institutionType`. Returns `{ created, updated, skipped, unmapped[] }`.
- **`GET /providers/programmes/pending`** — `CATALOG_ADMIN`, cross-institution PENDING
  queue with provider (+status), source, mapped StudyField, key fields.
- **`PATCH /providers/programmes/:id/approve|reject`** — guard widened from
  `('ADMIN','SUPER_ADMIN')` to the `CATALOG_ADMIN` constant (adds OWNER). Per-programme only.

## Filter fix (uniform visibility — no silent inconsistency)

`/public/programmes` (Apply Step 1) gained `provider: { status: 'ACTIVE' }`, so it
now matches the matcher exactly: **provider ACTIVE AND programme APPROVED AND
programme isActive** on **both** surfaces. (Same "no silent inconsistency between
surfaces" principle as the PR-RECS-2 reorder finding.)

## UI (`/staff/universities`, OWNER/SUPER_ADMIN)

- **Import section** in the institution edit view — Excel file picker + Import →
  toast summary (created/updated + unmapped-StudyField count).
- **"Programme approvals"** — a new nav page + queue: each pending programme with
  provider · source badge · StudyField · key fields, individual Approve/Reject, and
  a note when the institution isn't ACTIVE ("approving won't show it to students
  until the institution is Active").

## Verification

- **Integration smoke 12/12** (real DB, both real surfaces): Excel import → 2
  PENDING/`MANUAL_EXCEL` programmes → **invisible** in Apply Step 1 (`listProgrammes`)
  AND the matcher (`recommend`) → shown in the pending queue with source → approve →
  **visible** in BOTH → the still-PENDING sibling stays hidden → provider set
  INACTIVE → **hidden** in BOTH (proving the uniform rule).
- Matching + scoring gate 100/100; refactored CLI runs; backend + frontend
  production builds clean.

## Piece 2 (NOT built — separate later phase)

Monthly `@Cron` (infra exists: `@nestjs/schedule`) that, per ACTIVE provider, fetches
each approved programme's `programmeUrl` (`axios` — no headless browser first pass),
AI-extracts fields (`ClaudeService`/`@anthropic-ai/sdk`), field-diffs vs the DB, and
files `ProgrammeChangeProposal`s (`source=AUTOMATED_WEB_CHECK`) into this same queue —
**human-reviewed, nothing auto-applied**. Honest caveat (unchanged): university sites
vary wildly; JS-heavy/anti-bot sites won't be covered first pass; **manual Excel stays
the reliable default** and automation is an assistive aid needing ongoing correction.
