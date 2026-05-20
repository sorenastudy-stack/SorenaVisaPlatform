# PR-09 — Background details

## What this step does

Step 9 is INZ's flat declarations block: ten Yes/No questions covering cultural / political associations, intelligence agency involvement, exposure to ill-treatment or armed conflict, war-crime involvement, militia membership, and prior detention. No free-text, no child tables — just ten booleans in INZ's exact order, grouped on screen into six labelled subsections.

## INZ source

INZ 1200 Online Student visa, "Background details" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/<ts>_add_visa_background_details/migration.sql`. Also a `.gitignore` update.
- **Backend:** `visa.service.ts` (PATCH allow-list extended).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step9BackgroundDetails.tsx` (new, ~190 LOC), `Step8Relationships.tsx` (advance to Step 9).
- **i18n:** ~26 keys per locale (`visaBackground*`).

## Database changes

Ten new boolean columns on `VisaApplication`. All nullable:

```text
heldReligiousCulturalPosition Boolean?
heldPoliticalAppointment Boolean?
hadPoliticalAssociation Boolean?
associatedIntelligenceAgency Boolean?
witnessedIllTreatment Boolean?
involvedArmedConflict Boolean?
associatedViolentGroup Boolean?
involvedWarCrimes Boolean?
memberLiberationMilitia Boolean?
everDetainedImprisoned Boolean?
```

No new tables or enums. Migration filename: `<ts>_add_visa_background_details/migration.sql`.

## API endpoints

No new routes — Step 9 PATCHes the shared `application` endpoint with the ten new field names.

## Frontend

- Component: `Step9BackgroundDetails.tsx`, ~190 LOC.
- The ten questions are driven by a single declarative array `QUESTIONS` that pairs each column key with its label key and (optionally) a subsection-heading key. Rendering walks that array — the component is short on purpose.
- Section headings break the list into six logical groups (Cultural / Political appointments / Political associations / Other / Militia / Detention).

## i18n

`visaBackground*`. About 26 keys per locale — section title + intro + ten question labels + six subsection headings + the save/saved/error strings.

## Validation rules

- All ten Y/Ns are required (no draft-saves with a missing answer).
- No conditional follow-ups in this step — every "Yes" answer is recorded but doesn't unlock any further fields. Consultant follow-up happens outside the platform.

## Server-side cascade clearing

Not applicable — no nested gates.

## Security layers applied

- Standard controller guards.
- No encrypted columns (no free-text PII).

## How to test it works (manual)

1. Open Step 9.
2. Answer all ten questions with a mix of Yes/No.
3. Save. Reload — every answer round-trips.
4. Leave one unanswered, try to save — validation should block with a clear message naming the missing field.

## Known limitations

- INZ's actual form lets the consultant attach a free-text note after a "Yes". The platform doesn't model that — consultants record those notes outside the system.

## Commit reference

`ce242f5` — `VISA-PR-9: Background details (Step 9) - 6 subsections, 10 INZ-order Yes/No questions, persistence verified`. 11 files changed, +324/−6.
