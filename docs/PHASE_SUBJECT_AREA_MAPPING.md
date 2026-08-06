> **SUPERSEDED — do not build against this document.**
>
> This describes the 33-bucket shared `SubjectArea` taxonomy, which was abandoned on
> 2026-08-05 before any of it shipped. The catalogue import instead uses **each institution's
> own Subject Area labels** verbatim (`education_programmes.subjectAreaRaw`), with no shared
> taxonomy and no `SubjectArea`/`ProviderSubjectArea` tables. See
> `PHASE_PROGRAMMES_CURATION_SCREEN.md` and the import commit `7ffd2e5`.
>
> Kept only as a record of the approach considered and the reasons it was dropped.

# Phase: Programme Subject Area Mapping (ITP + PTE + University)

> Placed in the repo 2026-08-05 (the phase itself was generated 2026-07-30). The
> companion deliverable `sorena_subject_area_mapping.csv` is **still outstanding** —
> see "Repo status" at the foot of this file.

## 1. What this phase does

Sorena received three verified NZ programme data files from the research council, covering every institution type in scope: International Technology Providers / Polytechnics (ITP, 278 programme rows), Private Training Establishments (PTE, 272 rows), and all 8 NZ universities at NZQF Levels 7-9 — Bachelor's through Master's/Postgraduate Diploma (University, 574 rows). Each file uses its own free-text "Subject Area" (or "Subject Area (Faculty)") column, and all three use different, mutually inconsistent labeling conventions:

- ITP uses 14 broad categories (e.g. "Business & Management").
- PTE uses 133 granular, often-duplicate labels (e.g. "Cookery", "Culinary Arts / Cookery", "Culinary Arts / Advanced Cookery" — all the same subject).
- University uses 57 labels that are literal faculty names as published by each institution, several of them bilingual English/Māori (e.g. Massey University's "College of Sciences (Te Wahanga Putaiao)"), which required care not to misclassify by the Māori honorific instead of the actual English faculty subject.

This phase produced a single lookup table (`sorena_subject_area_mapping.csv`) that maps all 204 distinct raw Subject Area labels across the three files to one of 33 clean, canonical buckets. This table is meant to be loaded directly by the programme importer so that Sorena's Recommendation Engine (see `Recommendation_Domain_v3.0.docx`) matches applicants against 33 consistent categories instead of 204 fragmented, overlapping ones — this is now the complete dataset; no further institution types remain to be added.

No application code was written in this phase — this is a data-preparation deliverable that unblocks the programme import work for the "Third" functional layer (controlled, database-driven programme matching) described in the project brief.

## 2. Files created or changed

| File | Purpose |
|---|---|
| `sorena_subject_area_mapping.csv` | The lookup table: `source_file, raw_subject_area_label, canonical_bucket, row_count, sample_provider_if_blank`. 204 data rows (one per distinct raw label per source file, across all 3 files). Delivered to the user via chat; not yet placed in the repo (see Rollback/next steps below). |

No files in the actual NestJS/Prisma project were touched. This phase was pure data analysis against three source Excel workbooks:
- `NZ_International_Polytechnic_Programmes_2026_2027.xlsx` (ITP, 278 rows)
- `NZ_International_PTE_Programmes_2026_2027.xlsx` (PTE, 272 rows)
- `NZ_University_Programmes_Level79_2026_2027.xlsx` (University, 574 rows)

Combined: **1,124 programme rows** across all three institution types.

## 3. Database tables/columns added

None yet. This phase produced the mapping data only. When the importer is built, the expected shape is:

- A `subject_area_raw` (or similar) free-text field captured from the source file during import, retained for traceability.
- A `subject_area_canonical` (or a foreign key to a new `SubjectArea` lookup table) populated via this mapping CSV at import time.

Recommend a small `SubjectArea` table (`id`, `name`) seeded from the 33 canonical buckets below, with programmes foreign-keyed to it — this keeps the taxonomy centrally editable rather than duplicated as strings across every programme row.

## 4. Environment variables added

None.

## 5. Third-party services connected

None. All work was local file processing (Python/openpyxl) against the three uploaded Excel files.

## 6. How to test it works

1. Open `sorena_subject_area_mapping.csv` and confirm it has 205 lines (1 header + 204 data rows).
2. Confirm every row has a non-empty `canonical_bucket` value that is NOT the literal string `NEEDS_MANUAL_REVIEW` (there are currently zero such rows — full coverage).
3. Spot-check known-messy labels resolve sensibly, e.g.:
   - PTE: `Cookery`, `Culinary Arts / Cookery`, `Culinary Arts / Advanced Cookery` → all map to `Culinary Arts, Cookery & Pâtisserie`
   - PTE: `(blank)` rows from Alphacrucis College → `Theology / Christian Ministry` (inferred from provider name, see `sample_provider_if_blank` column); from Mainland Aviation College → `Aviation / Pilot Training`; from AGI Education Limited → `Unclassified / Blank` (no reliable inference available — flagged, not guessed)
   - University: `College of Sciences (Te Wahanga Putaiao)` (Massey's bilingual faculty name) → `Science & Natural Environment`, NOT `Māori & Indigenous Studies` — confirms the English subject was used, not the Māori honorific in the name
   - University: `Maori and Indigenous Studies`, `Te Ara Poutama: Maori and Indigenous Development`, `Te Kawa a Maui (Maori Studies)` → correctly grouped under `Māori & Indigenous Studies` (14 rows total) since these genuinely are Māori Studies programmes, not just bilingual faculty branding
4. Sum the `row_count` column grouped by `source_file` and confirm ITP totals 278, PTE totals 272, University totals 574 (matches each source workbook's Programme Database sheet / QA Checks tab).
5. Sum `row_count` grouped by `canonical_bucket` to get the 33-bucket distribution. Business/Business Management is the largest combined bucket (198 rows), followed by Science & Natural Environment (97) and Creative & Performing Arts (91). Several niche buckets (Financial Services, Animal Care) sit at 1 row.

## 7. Known limitations

- The bucket assignment rules are keyword-based (substring matching on the lowercased raw label), authored by directly inspecting the label lists from these three specific files. If a fourth source file is ever added (none currently planned — this was described as the last database), its labels will need the same review pass; do not assume the existing rules will classify a new file's labels correctly without checking the `NEEDS_MANUAL_REVIEW` count first.
- Two PTE rows (from AGI Education Limited) remain genuinely `Unclassified / Blank` — the source file has no Subject Area value and the provider name doesn't map to an obvious single subject. These need either a manual look at AGI's actual programme names, or acceptance as a permanent "uncategorised" bucket.
- The CSV is a flat file, not yet loaded into the database or wired into any importer code. Claude Code (in the VS Code project) still needs to (a) decide where this lookup lives — static seed data vs. a `SubjectArea` table — and (b) write the actual import logic that reads Provider/Programme rows from the source workbooks and applies this mapping.
- The "Other / General (ITP catch-all)" bucket (16 rows) is a genuine ITP source category, not a mapping failure — it reflects that the source file itself grouped some programmes as "Other". Worth a manual look before launch to see if those 16 programmes deserve better categorisation.
- "Science & Natural Environment" and "Agriculture, Horticulture, Viticulture & Environment" are adjacent/overlapping buckets by design (both can include environmental science programmes) — if the Recommendation Engine needs a stricter split, this pair should be reviewed first.
- "Medicine / Nursing / Health Science / Pharmacy" (university-level, 72 rows) and "Nursing / Health Science / Pharmacy" (non-university, 32 rows) were deliberately kept as two separate buckets rather than merged, since a Level 7-9 medical/health science degree and a PTE-level health certificate are not equivalent for programme-matching purposes. Confirm this split still makes sense once the Recommendation Engine's actual matching logic (academic level + subject) is designed — it may turn out the level field alone is sufficient and these two buckets should merge.

## 8. How a future developer would extend this

- To add a new canonical bucket, or reclassify a raw label: locate the raw label in the CSV, decide its correct canonical bucket, and either edit the CSV directly (safe for one-off fixes) or update the keyword-rule ruleset and regenerate (safer for bulk changes — keeps the mapping logic auditable rather than hand-edited). The ruleset logic is documented in full in this handover's "How to test" section and can be reconstructed from the CSV's existing `raw → canonical` pairs if the generating script itself isn't available in a given environment.
- If Sorena's programme taxonomy in the actual product ends up needing fewer or more categories than these 33, treat this CSV as a first draft — it was built purely from how NZ providers/universities name their own subject areas, not from Sorena's ideal recommendation-engine taxonomy. Product/business judgement should review the 33 buckets before they're locked into the schema.
- Bilingual (English/Māori) faculty names are a pattern specific to NZ universities (several institutions publish faculty names as "English Name (Māori Name)"). If more university-sourced data is added later, watch for the same pattern and route by the English subject, not the Māori honorific — see the Massey examples in section 6 above.

## 9. Security layers applied

Not applicable — no personal data, payments, or user-facing endpoints were touched in this phase. Source files are institutional programme catalogues (publicly published course information), not client data.

## 10. Rollback instructions

This phase produced a standalone CSV file with no database migrations, no code changes, and no deployed changes. To "roll back," simply discard `sorena_subject_area_mapping.csv` and do not import it. If it has already been loaded into a `SubjectArea` table or used to populate a `subject_area_canonical` column, roll back via the corresponding Prisma migration (not yet created — flag this when that migration is written, so a down-migration exists).

---

*Generated 2026-07-30. Source files: `NZ_International_Polytechnic_Programmes_2026_2027.xlsx`, `NZ_International_PTE_Programmes_2026_2027.xlsx`, `NZ_University_Programmes_Level79_2026_2027.xlsx`. Companion deliverable: `sorena_subject_area_mapping.csv` (delivered separately in this conversation). This supersedes the earlier ITP+PTE-only version of this document.*

---

## Repo status (added 2026-08-05, Programme Curation phase)

**Still outstanding — blocks the Programme Curation build:**

| Artefact | Status |
|---|---|
| `sorena_subject_area_mapping.csv` (204 rows) | **NOT in the repo.** Needed to seed the 33 buckets and to map each imported programme to one. |
| `NZ_International_Polytechnic_Programmes_2026_2027.xlsx` | Not in the repo (1,124 programme rows live across the three) |
| `NZ_International_PTE_Programmes_2026_2027.xlsx` | Not in the repo |
| `NZ_University_Programmes_Level79_2026_2027.xlsx` | Not in the repo |

This document names only **14 of the 33** canonical buckets. The remaining 19, and all
204 `raw label → bucket` pairs, exist only in the CSV — they cannot be reconstructed
from this file.

Production catalogue state at time of writing: `education_programmes` = **0 rows**,
`study_fields` = **0**, `programme_study_fields` = **0**. Nothing has been imported yet.
