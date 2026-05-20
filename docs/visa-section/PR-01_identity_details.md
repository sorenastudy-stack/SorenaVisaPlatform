# PR-01 — Identity Details

## What this step does

Step 1 captures the student's identity as INZ expects it: any names other than the ones already on the admission record, the passport details, place of birth, and any national identity number. Most identity fields the student already gave us during admission (full name, date of birth, nationality, passport number) are re-displayed here read-only — only the visa-specific extras (other names, national ID, passport gender, place-of-birth detail) are new editable inputs. The save creates the parent `VisaApplication` row if it doesn't exist and starts the stepper at Step 1.

## INZ source

INZ 1200 Online Student visa, "Identity Details" page.

## Files created/changed

- **Schema/migration:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_add_visa_application/migration.sql`.
- **Backend:** `backend/src/students/students.module.ts`, `backend/src/students/visa/visa.controller.ts` (new file), `backend/src/students/visa/visa.service.ts` (new file).
- **Frontend:** `frontend/src/components/student/visa/VisaFormContext.tsx` (new), `VisaFormShell.tsx` (new), `steps/Step1IdentityDetails.tsx` (new), `frontend/src/components/common/SearchableSelect.tsx` (new), `app/student/documents/page.tsx`, `app/student/page.tsx`, `components/portal/PortalLayout.tsx`.
- **i18n:** `frontend/src/i18n/messages/en.json`, `fa.json`.
- Also added the `docs/VISA_FIELD_INVENTORY.md` spec reference.

## Database changes

New `VisaApplication` parent table (`visa_applications`). All identity fields nullable so a partial draft can save. PR-1 columns:

| Field | Type | Encrypted |
|-------|------|-----------|
| `id`, `applicationId` (unique FK) | String | — |
| `hasMononym`, `hasUsedOtherNames`, `prevAppliedNzVisa`, `prevRequestedNzeta`, `everTravelledNz`, `totalNzTime24Plus`, `hasNationalId` | Boolean? | — |
| `middleNames`, `countryWhenSubmitting`, `passportCountryOfIssue`, `passportGender`, `stateOfBirth`, `cityOfBirth`, `nationalIdCountry` | String? | — |
| `otherNamesEncrypted`, `nationalIdEncrypted` | Bytes? | Yes |
| `passportIssueDate`, `passportExpiryDate` | DateTime? | — |
| `currentStep` | Int @default(1) | — |

No new child tables or enums. Migration filename: `20260514000001_add_visa_application/migration.sql` (the directory created by the original migration).

## API endpoints

- `GET /students/me/visa/application` — fetch the full visa application + every child collection.
- `POST /students/me/visa/application` — create the row on first visit (idempotent — returns the existing row if one already exists).
- `PATCH /students/me/visa/application` — save Step 1 (and every later flat-field section that PATCHes the parent row).

## Frontend

- Component: `Step1IdentityDetails.tsx`, ~560 LOC.
- Shell: a new `VisaFormShell.tsx` was introduced to host the stepper + the active step; `VisaFormContext.tsx` holds the parent application state plus all child collections, with `setActiveStep` for navigation.
- Reused admission inputs: the student's full name, date of birth, nationality, and passport number render read-only from the admission record.
- Editable fields: other names (with a Y/N gate that controls whether the encrypted field shows), place of birth, passport issue/expiry, gender on passport, national identity number (Y/N gated).
- Conditional UI: `hasMononym` toggles the middle-name input visibility; `hasUsedOtherNames` toggles the encrypted other-names input; `hasNationalId` toggles the encrypted national-ID + country inputs.

## i18n

`visaIdentity*`, `visaShell*`, and `visaCommon*` prefixes. About 70 keys per locale, plus the shared common buttons (`Yes`, `No`, `Back`, `Saving…`).

## Validation rules

- A visa application row must exist before any PATCH; the controller's POST endpoint creates it on first visit.
- Mononym mode hides `middleNames` rather than requiring it.
- Encrypted fields only persist when their parent gate (`hasUsedOtherNames` / `hasNationalId`) is true; the service nulls them otherwise.

## Server-side cascade clearing

Not applicable — no nested gates introduced in PR-01.

## Security layers applied

- **Auth:** `JwtAuthGuard + RolesGuard` with `@Roles('STUDENT', 'AGENT')` on `VisaController`.
- **PII encryption:** `otherNamesEncrypted` and `nationalIdEncrypted` go through `CryptoService` (AES-256-GCM).
- **Ownership:** the service resolves the admission application from `req.user.userId` and only ever touches that user's visa row.
- **HTTPS:** Vercel default (frontend) / nginx-terminated TLS (backend).

## How to test it works (manual)

1. Log in as `test@sorenatest.com`.
2. Navigate to `/student/documents`. The Visa Section should load with Step 1 active.
3. Confirm the read-only block displays the student's admission name, DOB, nationality, and passport.
4. Tick "I have used other names" — an encrypted text input should appear; type a value.
5. Set place of birth (state + city) and the passport issue/expiry dates.
6. Click Save. Expect a green saved banner and Step 2 to become reachable in the stepper.
7. Reload the page. Every input should re-display with the value you saved (encrypted fields decrypt on the GET response).

## Known limitations

- No specific PR-01 limitations beyond the Section-wide ones in the master doc.

## Commit reference

`708690c` — `VISA-PR-1: Visa Section + INZ Identity Details`. 15 files changed, +1639/−36.
