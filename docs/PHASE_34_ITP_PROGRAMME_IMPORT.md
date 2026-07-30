# Phase 34 — ITP programme import (schema + importer + backfill)

Adds the schema, an **idempotent importer**, and a provider-type backfill to load
NZ programme data (Institutes of Technology & Polytechnics first, then the
University and PTE files, which **reuse the same importer**). Everything imports
as **PENDING** — nothing reaches applicants until staff approve it.

**Date:** 2026-07-30
**Status:** schema applied + importer/backfill **verified against a synthetic
sample**. The **real 278-row ITP import is BLOCKED** — the source `.xlsx` is not
in the workspace (see §6).

---

## 1. What it does

Loads `EducationProvider` + `EducationProgramme` (+ `ProgrammeRequirement`,
`ProgrammeIntake`, `ProgrammeStudyField`) from the verified NZ programme
spreadsheets. Every provider lands `status = PENDING`; every programme lands
`reviewStatus = PENDING, isActive = false`. The matching engine already filters
to APPROVED-only (`passesHardFilter`), so imported rows are **invisible to
applicants** until a staff member approves them in the (still-to-build) UI.

## 2. Schema increment (committed `2b6e7d2`)

Isolated **additive** migration
(`20260730020000_phase34_itp_import_schema`), applied via the approved
`migrate diff → db execute → migrate resolve --applied` workaround (avoids the
pre-existing 261-line drift `migrate dev` would regenerate).

| Change | Detail |
|---|---|
| enum `InstitutionType` | `UNIVERSITY / ITP / PTE` — new **authoritative** field on `EducationProvider`. Legacy `providerType` kept, flagged for later consolidation. |
| enum `VerificationStatus` | `VERIFIED / UNVERIFIED / NEEDS_RECHECK` — data-verification state (distinct from `reviewStatus` = the staff decision to offer). |
| enum `IntakeBasis` | `REMAINING / PUBLISHED / PROJECTED`. |
| `QualificationLevel` + `CERTIFICATE` | New lowest rung (NZ Certificates, NZQF 3–5). Added to `LEVEL_ORDER` (`matching.logic.ts`) + DTO + frontend Q33. |
| `EducationProvider` | `+ institutionType`, `+ legalEntityName` (source "Provider Entity" = legal body vs `name` = brand). |
| `EducationProgramme` | `+ majorStrand, qualificationType, deliveryMode, studentVisaSuitable, campusCity, durationText, feeBasis, feeYear, fee2027Status, scholarshipNote, programmeUrl, verificationSourceUrl, verifiedAt, verificationStatus, notes` (all nullable). |
| `ProgrammeRequirement` | `+ englishRequirementText, academicPrerequisites, otherRequirements`. |
| `ProgrammeIntake` (new child model) | `programmeId, year, label, basis, needsReconfirmation` — a **real child model**, not a JSON blob. `PROJECTED` intakes set `needsReconfirmation = true`. |

New StudyFields seeded (`seed-study-fields.ts`, 23 total): `personal_services`,
`sport_recreation`, `social_community`, `foundation_pathways`. All
`backgroundWeight = 0` and map to q16/q25 → `'Other'`
(`frontend/.../v2/study-field-maps.ts`), so **scoring stays byte-identical**
(no q16 option existed for these; guard still 7/7).

## 3. The importer — `backend/scripts/import-programmes.ts`

```
npx ts-node scripts/import-programmes.ts <file.xlsx> [--type=ITP|UNIVERSITY|PTE] [--dry]
```

- **Idempotent by natural key.** Provider by `name`; programme by
  `(providerId, name, campusCity, nzqfLevel)`; requirement upsert by
  `programmeId`; intakes `deleteMany + createMany` (replace, never accumulate);
  `ProgrammeStudyField` upsert. Re-running makes **zero duplicates** — proven.
- **All PENDING.** Providers `PENDING`; programmes `reviewStatus PENDING`,
  `isActive false`. Nothing auto-approved.
- **`--type`** sets the authoritative `institutionType` (default `ITP`) and
  derives legacy `providerType` (ITP→POLYTECHNIC, etc.).
- **Parsers:** Excel serial + string dates, duration (year/month/week →
  months), NZQF level, IELTS min, Yes/No, verification status,
  Qualification Type → `QualificationLevel` (with NZQF fallback).
- **StudyField tagging** — Subject Area → key, with title-split where one
  Subject Area covers two fields:

  | Subject Area | → StudyField |
  |---|---|
  | Business & Management | `business_management` |
  | Computing & IT | `it_computer_science` |
  | Health & Nursing | `nursing` if title has "nurs", else `healthcare_medical` |
  | Engineering | `engineering` |
  | Construction & Architecture | `construction_trades` |
  | Science & Environment | `science_environment` |
  | Hospitality & Tourism | `hospitality_culinary` |
  | Beauty & Hair | `personal_services` |
  | Sport & Outdoor | `sport_recreation` |
  | English Language / Foundation & Pathways | `foundation_pathways` |
  | Creative Arts & Media | `media_communication` if title ~ media/journal/visual/film/broadcast, else `arts_design` |
  | Education & Social Services | `social_community` if title ~ social/counsel/community/youth, else `education_teaching` |
  | Other | per-title: ICT→IT, commerce→business, media→media, art/design→arts, mentor/leadership→business, maritime→aviation_transport, dairy/farm→agriculture, **else `general_interdisciplinary` + FLAGGED** |

  Any row that can't be mapped to a specific field is printed under
  **`⚠ rows fell back to general_interdisciplinary/other`** for manual review —
  it never guesses silently.

## 4. Backfill — `backend/scripts/backfill-institution-type.ts`

```
npx ts-node scripts/backfill-institution-type.ts [--dry]
```

Fills `institutionType` on **existing** providers from legacy `providerType`:
`POLYTECHNIC→ITP`, `UNIVERSITY→UNIVERSITY` (unambiguous);
`COLLEGE`/`SCHOOL→PTE` **and flagged** for staff confirmation (a "College" may be
an ITP subsidiary or a PTE). Only writes where `institutionType IS NULL` (never
overrides staff edits — safe to re-run). Unknown enum values are left null and
flagged.

## 5. Verification done

- Schema applied; backend build clean; **60/60** backend tests (scoring golden +
  matching); frontend v2 byte-identity guard **7/7**.
- **Synthetic-sample test** (`scratchpad/test-importer.cjs`) — writes a 6-row
  `.xlsx` exercising the tricky branches, runs the importer **twice**, asserts:
  provider `PENDING`+`ITP`; **6 programmes, no duplicates after 2 runs**; all
  `PENDING`/`isActive false`; BIT → `BACHELOR`/`LEVEL_7`/visa-suitable/36mo/fee;
  3 intakes incl. `PROJECTED needsReconfirmation`; English `6.0` parsed;
  Journalism→`media_communication`; Contemporary Art→`arts_design`+`CERTIFICATE`;
  Social Work→`social_community`; Dairy Farming (Other)→`agriculture`;
  Hairdressing (Beauty)→`personal_services`. **11/11 OK.**
- Backfill dry-run clean (dev DB has 0 providers).

## 6. ⚠ BLOCKED — real 278-row import

The actual `NZ_International_Polytechnic_Programmes_2026_2027.xlsx` is **not in
the workspace**. The importer + mapping are proven on a synthetic sample, but the
real import cannot be verified until the file is placed at an accessible path.
This is real production data — worth confirming the mapping on the real 278 rows
(especially the "Other" title-splits and any unmapped fallbacks) before it lands.

**To run when the file is provided:**
```
npx ts-node scripts/import-programmes.ts "<path>/NZ_International_Polytechnic_Programmes_2026_2027.xlsx" --type=ITP --dry
# review the ⚠ unmapped list + counts, then re-run without --dry
```

## 7. Next (deferred until real import verified)

**Staff approval UI** — extend `/staff/universities` with University / ITP / PTE
**grouped, checkbox-selectable** approval (flip `reviewStatus`→APPROVED +
`isActive`, and confirm/correct `institutionType` on the backfill-flagged
providers). Deliberately **not built yet** — building it against synthetic data
risks baking in wrong assumptions; it lands once the real ITP rows are in and the
mapping is confirmed. Then the University + PTE files import through the same tool.
