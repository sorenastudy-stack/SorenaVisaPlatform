# PR-11 — Travel history

## What this step does

Step 11 captures international travel in the last five years (excluding trips to and from New Zealand). One gate Y/N decides whether the repeating block is shown. Each trip card holds destination country, month/year entered, optional month/year exited, arrival mode (air/sea/land), point of entry, purpose of travel (8 categories), and a conditional "other purpose" free-text field. Destination, point of entry, and other-purpose are PII and encrypted.

## INZ source

INZ 1200 Online Student visa, "Travel history" page.

## Files created/changed

- **Schema/migration:** `schema.prisma`, `prisma/migrations/20260520033156_visa_pr11_travel_history/migration.sql`.
- **Backend:** `dto/travel-history.dto.ts` (new), `visa.service.ts` (`getTravelHistory` + `saveTravelHistory`), `visa.controller.ts` (two new routes).
- **Frontend:** `VisaFormContext.tsx`, `VisaFormShell.tsx`, `VisaStepper.tsx`, `steps/Step11TravelHistory.tsx` (new, ~480 LOC), `Step10MilitaryHistory.tsx` (advance to Step 11).
- **i18n:** ~47 keys per locale (`visaTravel*`).

## Database changes

Parent-row addition on `VisaApplication`:

```text
hasTravelledInternationally Boolean?
```

New child table `VisaTravelHistoryEntry` (`visa_travel_history_entries`):

```text
id String PK
visaApplicationId String FK cascade
destinationEncrypted Bytes?
dateEnteredMonth, dateEnteredYear Int?
dateExitedMonth, dateExitedYear Int?
arrivalMode VisaArrivalMode?         // AIR | SEA | LAND
pointOfEntryEncrypted Bytes?
purposeOfTravel VisaPurposeOfTravel? // EDUCATION..OTHER
otherPurposeEncrypted Bytes?         // only populated when purposeOfTravel = OTHER
sortOrder Int default 0
createdAt, updatedAt
```

Month + year are stored as separate `INTEGER` columns — INZ collects month-precision and a synthetic day-1 timestamp would mislead downstream date math.

Two new enums:
- `VisaArrivalMode` — `AIR`, `SEA`, `LAND`.
- `VisaPurposeOfTravel` — `EDUCATION`, `TOURISM`, `BUSINESS`, `FAMILY`, `MEDICAL`, `TRANSIT`, `WORK`, `OTHER`.

Migration filename: `20260520033156_visa_pr11_travel_history/migration.sql`.

## API endpoints

- `GET /students/me/visa/travel-history` — returns the gate + decrypted entries.
- `PATCH /students/me/visa/travel-history` — full-payload replace-on-save (transactional delete-then-insert).

## Frontend

- Component: `Step11TravelHistory.tsx`, ~480 LOC.
- Replace-on-save mirrors PR-10's pattern.
- Conditional UI: entries block shown only when the gate = Yes. "Other purpose" text input shown only when `purposeOfTravel = OTHER`.
- Remove button on the last remaining card is disabled when the gate = Yes (the student must keep at least one entry).
- `api.put` was *not* added in this PR (still PATCH replace-on-save); PR-13 introduced `api.put`.

## i18n

`visaTravel*`. About 47 keys per locale — section title + intro + savedBanner + gate copy + entry-card field labels + 8 purpose enum values + 3 arrival-mode enum values + add/remove buttons + per-field validation messages.

## Validation rules

- Gate is required.
- `gate = true` → at least one entry with: destination, dateEnteredMonth (1..12), dateEnteredYear (1900..current), arrival mode, point of entry, purposeOfTravel.
- Exit month + year are optional, but if either is present both must be — and the exit date must be `>=` entered date (compared via `year * 12 + (month - 1)`).
- `purposeOfTravel = OTHER` → other-purpose text required.
- `gate = false` → entries must be empty (defensive server check).

## Server-side cascade clearing

Replace-on-save handles it: when gate flips Yes→No, the next save's `entries` array is empty so all rows are wiped in the transaction.

## Security layers applied

- Standard controller guards + ownership check.
- Three encrypted columns per row (`destinationEncrypted`, `pointOfEntryEncrypted`, `otherPurposeEncrypted`).
- Replace-on-save transaction ensures no half-state.

## How to test it works (manual)

1. Open Step 11. Toggle gate to Yes — verify one empty trip card appears.
2. Fill destination, mm/yyyy entered + mm/yyyy exited, arrival mode = Air, point of entry, purpose = Education.
3. Add a second trip with purpose = Other — verify the "other purpose" text input appears and is required.
4. Save. Reload — both entries round-trip, encrypted fields decrypt.
5. Set the second trip's exit date earlier than its entered date — save should fail with "exit before entered" message.
6. Flip gate to No, save. Reload — entries are gone.

## Known limitations

- The purpose enum is INZ's fixed list — adding a new purpose requires a Prisma enum migration. `OTHER` is the escape hatch.

## Commit reference

`30085f9` — `feat(visa): VISA-PR-11 Travel history`. 12 files changed, +1138/−5.
