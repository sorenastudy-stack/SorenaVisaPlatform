# PR-05 — Health

## What this step does

Step 5 captures every health declaration INZ asks about: tuberculosis exposure, need for renal dialysis, any existing medical condition, need for residential care, pregnancy, intended length of stay, whether a medical exam has been completed (with reference number), a repeating block of TB-risk countries the student has visited, and two compulsory acknowledgements (insurance declaration + public-health acknowledgement). This PR also bundled a login fix that touched `auth.service.ts`.

## INZ source

INZ 1200 Online Student visa, "Health" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/20260519000011_add_visa_health/migration.sql`.
- **Backend:** `visa.service.ts` (Section-5 PATCH + TB-country POST/PATCH/DELETE), `visa.controller.ts` (three new routes), `auth/auth.service.ts` (login fix).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step5Health.tsx` (new, ~520 LOC), `Step4Character.tsx` (advance to Step 5), `app/student/documents/page.tsx`.
- **i18n:** ~67 keys per locale (`visaHealth*`, `visaTbRisk*`, `visaInsurance*`, `visaPublicHealth*`).

## Database changes

Parent-row additions on `VisaApplication` — 11 columns, all nullable:

```text
hasTuberculosis, needsRenalDialysis, hasMedicalCondition, needsResidentialCare,
  isPregnant Boolean?
intendedLengthOfStay String?
hadMedicalExam Boolean?
medicalRefNumber String?
tbCountriesNoMore Boolean?
insuranceDeclarationAgreed, publicHealthAckAgreed Boolean?
```

New repeating child table `VisaTbRiskCountry` (`visa_tb_risk_countries`):

```text
id String PK
visaApplicationId String FK cascade
country String
totalDurationDays Int
sortOrder Int default 0
createdAt, updatedAt
```

No new enums.

Migration filename: `20260519000011_add_visa_health/migration.sql`.

## API endpoints

- `PATCH /students/me/visa/application` — extended allow-list covers the 11 new flat fields.
- `POST /students/me/visa/tb-countries` — add a TB-risk country row.
- `PATCH /students/me/visa/tb-countries/:id` — update a row (country / duration).
- `DELETE /students/me/visa/tb-countries/:id` — remove a row.

## Frontend

- Component: `Step5Health.tsx`, ~520 LOC.
- Conditional UI: TB-risk-country repeating block is rendered behind its own gate; the medical-exam reference-number input only shows when `hadMedicalExam = true`; the two declaration checkboxes are both required true to advance.

## i18n

`visaHealth*`, `visaTbRisk*`, `visaInsurance*`, `visaPublicHealth*`. About 67 keys per locale.

## Validation rules

- All five health Y/Ns are required.
- `hadMedicalExam = true` requires `medicalRefNumber`.
- `tbCountriesNoMore = false` and a non-empty TB-risk list both require every country row to have `country + totalDurationDays`.
- The two acknowledgements must be checked true to advance to Step 6.

## Server-side cascade clearing

- `tbCountriesNoMore = true` keeps any existing TB-risk-country rows but flags them as historical; the service does not auto-delete them (consultant decision: keep the audit trail).
- `hadMedicalExam = false` nulls `medicalRefNumber`.

## Security layers applied

- Standard controller guards + per-row ownership checks on the TB-country endpoints.
- No encrypted columns (no free-text PII in this step).

## How to test it works (manual)

1. Open Step 5.
2. Answer the five health Y/Ns.
3. Toggle "had a medical exam" — verify the reference-number input appears and is required.
4. Add two TB-risk countries via the add-country UI.
5. Check both declarations.
6. Save. Reload — every flat field + the two TB-country rows should round-trip.
7. Delete one TB-country row; reload — only one row left.

## Known limitations

- The intended-length-of-stay input is free-text — INZ accepts both "12 months" and "1 year" but a future cleanup could normalize this into a structured field.

## Commit reference

`f6c148a` — `VISA-PR-5: INZ Health section + login fix`. 13 files changed, +1037/−5.
