# PR-10 — Military history

## What this step does

Step 10 captures INZ's military-service block. Three gating Yes/No questions decide whether further detail is needed: whether military service is compulsory in the student's home country (D1), whether they have ever undertaken military service (D2), and whether they were exempt where it was required (D3). A `D3 = true` answer unlocks an encrypted free-text exemption explanation; a `D2 = true` answer unlocks a repeating block of service periods (corps, division, brigade, battalion, unit, rank, encrypted duties, commanding officer). This is the first step that adopted the "replace-on-save" pattern: the whole payload PATCHes one endpoint and the backend wipes + re-inserts the child rows atomically.

## INZ source

INZ 1200 Online Student visa, "Military service" page (Section D).

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/20260520023930_add_visa_military_service/migration.sql`.
- **Backend:** `dto/military-history.dto.ts` (new), `visa.service.ts` (`getMilitaryHistory` + `saveMilitaryHistory`), `visa.controller.ts` (two new routes).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step10MilitaryHistory.tsx` (new, ~490 LOC), `Step9BackgroundDetails.tsx` (advance to Step 10).
- **i18n:** ~51 keys per locale (`visaMilitary*`).

## Database changes

Parent-row additions on `VisaApplication` (all nullable):

```text
militaryServiceCompulsoryHome  Boolean?    // D1
everUndertakenMilitaryService  Boolean?    // D2 — referenced by PR-14
wasExemptFromMilitaryService   Boolean?    // D3
exemptExplanationEncrypted     Bytes?      // encrypted free-text reason
```

New child table `VisaMilitaryService` (`visa_military_services`):

```text
id String PK
visaApplicationId String FK cascade
dateStarted, dateFinished DateTime?
location, corps, division, brigade, battalion, unit, rank, commandingOfficer String?
dutiesEncrypted Bytes?
sortOrder Int default 0
createdAt, updatedAt
```

`dutiesEncrypted` is the only PII column on the child row. `exemptExplanationEncrypted` is the only PII column added to the parent.

Migration filename: `20260520023930_add_visa_military_service/migration.sql`.

## API endpoints

- `GET /students/me/visa/military-history` — returns the three gate Y/Ns + decrypted explanation + decrypted entries array.
- `PATCH /students/me/visa/military-history` — full-payload replace-on-save: the service validates, encrypts free-text, wipes any prior `VisaMilitaryService` rows, and re-inserts in one transaction.

## Frontend

- Component: `Step10MilitaryHistory.tsx`, ~490 LOC.
- Replace-on-save: the user adds/removes entries locally; the whole payload posts on save.
- Conditional UI: D3 explanation textarea shown only when D3 = true (with a 20-character minimum counter). D4 repeating block shown only when D2 = true.
- Reusable building blocks `YesNo`, `Asterisk`, `inputClass`, `dateInputClass` defined inline (these became the shared pattern PR-11..PR-14 mirror).

## i18n

`visaMilitary*`. About 51 keys per locale — section title + intro + saved/error/missing banners + three D-question labels + 11 row-field labels + 11 row-error labels + add/remove buttons + the explanation counter format.

## Validation rules

- D1, D2, D3 are all required booleans.
- `D3 = true` → exemption explanation must be ≥ 20 trimmed characters.
- `D2 = true` → at least one service entry with every required field populated.
- `D2 = false` → no entries allowed in the payload (defensive — the service rejects a hand-rolled curl that sends them).

## Server-side cascade clearing

Replace-on-save handles it implicitly: every PATCH deletes all prior rows before inserting the new payload, so a Yes→No flip of D2 simply means the new payload's `militaryServices` array is empty and nothing gets re-inserted. The D3 explanation column nulls when D3 = false.

## Security layers applied

- Standard controller guards + ownership via `resolveAdmissionApplication(userId)`.
- Two encrypted columns (`exemptExplanationEncrypted`, `dutiesEncrypted`).
- Replace-on-save transaction ensures no half-state if the insert fails mid-way.

## How to test it works (manual)

1. Open Step 10.
2. Set D1=Yes, D2=No, D3=No — save. Reload, confirm values stick.
3. Flip D2=Yes — verify the repeating block appears requiring at least one entry.
4. Add one entry with all 11 fields including a long duties description. Save.
5. Reload — the entry round-trips, duties decrypts.
6. Flip D2=No again, save. Reload — the entry is gone.
7. Flip D3=Yes with only a 5-char explanation — save should fail with a clear min-length message.

## Known limitations

- The replace-on-save transaction is intentional and matches PR-11/PR-13/PR-14, but it means there is no per-row UI mutation — every change is staged client-side until save.

## Commit reference

`97a5154` — `VISA-PR-10: Military history (Step 10) - D1/D2/D3 gates, D4 repeating service declarations, AES-256-GCM encrypted duties + exemption explanation`. 12 files changed, +1026/−4.
