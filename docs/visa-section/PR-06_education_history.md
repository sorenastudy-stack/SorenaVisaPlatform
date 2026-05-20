# PR-06 — Education history

## What this step does

Step 6 supplements the education history Sorena already captures during the admission flow. The admission form stores qualification level, institution name, country, and start/end *year*; INZ Section 6 asks for a few extra details on top — start/end *month*, the institution's state and town, and whether the qualification was actually awarded by the institution. The PR introduces a per-row supplement table that hangs off each existing `AdmissionEducationEntry` so we don't duplicate data and don't lose the link if either parent is deleted.

## INZ source

INZ 1200 Online Student visa, "Education history" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/<ts>_add_visa_education_supplements/migration.sql`.
- **Backend:** `visa.service.ts` (`PATCH education-supplements/:id` handler that upserts a supplement row by the admission education entry's id), `visa.controller.ts` (one route).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step6EducationHistory.tsx` (new, ~420 LOC), `Step5Health.tsx` (advance to Step 6), `app/student/documents/page.tsx`.
- **i18n:** ~36 keys per locale (`visaEducation*`).

## Database changes

New child table `VisaEducationSupplement` (`visa_education_supplements`):

```text
id String PK
visaApplicationId String FK cascade
educationEntryId  String UNIQUE FK to admission_education_entries cascade
startMonth, endMonth Int?
institutionState, institutionTown String?
qualificationAwarded Boolean?
createdAt, updatedAt
```

The `UNIQUE(educationEntryId)` constraint enforces one supplement per admission row. Cascades from either parent so deleting the admission entry or the visa application removes the supplement.

Also added a `visaSupplement` relation back-pointer on `AdmissionEducationEntry`.

Migration filename: `<ts>_add_visa_education_supplements/migration.sql`.

## API endpoints

- `PATCH /students/me/visa/education-supplements/:educationEntryId` — upsert the supplement for one admission education entry.

## Frontend

- Component: `Step6EducationHistory.tsx`, ~420 LOC.
- Renders one card per existing admission education entry; the read-only header re-displays the admission data (provider, qualification level, country, years) and the editable body holds the five supplement fields.
- If the student has zero admission education entries, the step shows an empty-state hint pointing back to the admission flow.

## i18n

`visaEducation*`. About 36 keys per locale — mostly field labels and the empty-state copy.

## Validation rules

- A supplement row is optional for any admission entry — the student can leave it blank.
- When *any* supplement field is set, the service interprets that as "this row is in scope" and persists the row even if other fields are null (draft-friendly).
- Month inputs must be 1..12 when present; the service validates this.

## Server-side cascade clearing

Not applicable — supplements track admission rows passively. Deletion of an admission education entry cascades through Postgres FK semantics.

## Security layers applied

- Standard controller guards + an ownership check that walks the admission FK to ensure the caller owns both the admission entry and (transitively) the visa application.
- No encrypted columns.

## How to test it works (manual)

1. Add at least one education entry on the admission form.
2. Open Step 6 — verify a card appears for each admission entry, with the admission data read-only.
3. Set start month, end month, state, town, and qualification-awarded for one card.
4. Save. Reload — values round-trip.
5. Delete the admission entry — the supplement should disappear too (cascade).

## Known limitations

- PR-14 later reads "did the student attend any tertiary study?" by checking `educationEntries.length > 0`. If a student deletes all admission entries the supplement gating disappears too; that's the intended behaviour, but worth knowing.

## Commit reference

`8d52c86` — `VISA-PR-6: INZ Education history section`. 12 files changed, +873/−10.
