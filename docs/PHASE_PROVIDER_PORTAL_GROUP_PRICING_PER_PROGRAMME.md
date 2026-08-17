# Provider Portal — Per-programme pricing by country group

**Status:** DONE — 17 August 2026
**Depends on:** Slice D (programme CRUD) and Slice E (country groups + the specificity rule).
**Closes:** the "editing existing rate rows" item deferred out of Slice E.

---

## 1. What this phase does

An institution can now set a tuition fee and a scholarship **for one programme,
for one country group** — from the programme's own edit form, rather than by
uploading a sheet.

Slice E could only *create* group-scoped rates. This adds the two verbs it was
missing:

- **Edit** — a changed amount returns the row to PENDING; an unchanged save
  leaves the approval alone. The rule slice C established for tuition uploads.
- **Uncheck** — deactivates the row. It is never deleted, because a price a
  student may already have been quoted should stay on the record.

**No change to the matching logic.** These rows carry both `programmeId` and
`nationalityGroupId`, which is a shape slice E's resolver already ranks: a
programme-scoped group row scores programme(2) on top of a GROUP nationality
match, and still loses outright to any exact-nationality row. That was verified
end-to-end rather than assumed.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/provider-portal/provider-programme-pricing.service.ts` | Create / edit / deactivate, per group, for one programme. |
| `backend/src/provider-portal/dto/programme-group-pricing.dto.ts` | The desired-state payload. |
| `frontend/src/components/provider/ProgrammeGroupPricing.tsx` | The form section. |

**Changed**
| File | Change |
|---|---|
| `backend/src/provider-portal/provider-programme.controller.ts` | `GET` and `PUT :id/group-pricing`. |
| `backend/src/provider-portal/provider-portal.module.ts` | Registers the service. |
| `backend/src/provider-portal/provider-programme-boundary.spec.ts` | 8 new assertions; the write-count test now counts rather than hard-codes. |
| `frontend/src/components/provider/ProviderProgrammes.tsx` | Renders the section and saves it after the programme PATCH. |

## 3. Database changes

**None.** No migration, no new column. The rows are ordinary `ProviderTuition` /
`ProviderScholarship` rows with `programmeId` **and** `nationalityGroupId` set —
a combination the schema and the slice-E CHECK constraint already allow.

**No unique index was added** across `(providerId, programmeId, nationalityGroupId)`,
deliberately: staff and the importer may legitimately hold several rows for one
programme that differ by `level` or `feeYear`, and a unique constraint would make
those unwritable. The service instead narrows on `level: null` — the shape this
screen creates — and takes the most recent if history ever produced more than one.

## 4. Environment variables

None added.

## 5. Third-party services

None added.

## 6. How to test it works

Open a programme → **Edit** → **Pricing by country group** → tick a group → fill a
fee, a scholarship, or both → **Save changes**.

**What was actually run, 17 Aug 2026** — two institutions, over HTTP:

```
30/30 checks passed
  the form reads its groups, current pricing, and the programme's standard fee
    B's group is not offered to A
  a fee and a scholarship set on one group      both PENDING, both active
    group-scoped, not nationality-scoped         nationality = null
    scholarship auto-named                       "South Asia scholarship"
  a group with a scholarship and NO tuition      valid — no tuition row created
  staff approve both                             APPROVED / APPROVED
  re-saving the SAME amounts                     keeps the approval
  CHANGING the fee                               $35,500, back to PENDING
    the untouched scholarship                    keeps its approval
  unchecking the group                           rows still exist, isActive=false
    a student can no longer be quoted from it
  re-ticking an unchanged row                    reactivates WITHOUT re-review
  a student in the group                         $35,500 via GROUP
  a student outside it                           $40,000 (DEFAULT)
  B cannot read or price A's programme           404, 404
  A cannot use B's group                         404, and no row written
  setting and deactivating both audited          4 event types
  test data removed                              0 left
```

**In a real browser**, on the actual Edit Programme form: **16/16** — the Add
form explains that the programme must be saved first, the Edit form lists the
groups with country counts, ticking reveals both optional fields, saving writes
$32,000 / $3,000 as PENDING, reopening shows them again with the review note,
unticking warns that nothing is deleted, and after saving both rows survive with
`isActive: false`.

Suites: backend **113 / 1419**, frontend **6 / 66**.

**The guards were proven able to fail:**

| Reintroduced mistake | Suite |
|---|---|
| the programme looked up without its owner | RED |
| another institution's group silently skipped instead of refused | RED |
| a changed tuition no longer returning to review | RED |
| a hard delete introduced on uncheck | RED |
| the rate limit dropped from the pricing write | RED |
| (restored) | GREEN |

## 7. Known limitations

- **The Add form cannot price.** A programme has no id until it is saved, so the
  section asks the institution to save first and reopen. Holding prices in memory
  and writing them in a second request would mean a rejected price could fail a
  programme that saved perfectly well.
- **Group pricing saves as a second request** after the programme PATCH, for the
  same reason. If the first succeeds and the second fails, the programme is saved
  and the prices are not — the toast reports the failure, but there is no
  transaction spanning both.
- **No per-level pricing here.** Rows are written with `level: null`. A rate that
  varies by level within one programme still needs the spreadsheet path.
- **Percentage scholarships are not offered** — the field writes `FIXED`. The
  importer can still create percentage rows.
- **The scholarship name is derived** (`"<group> scholarship"`) because the brief
  specifies two amount fields. An existing row keeps whatever name it already had.
- **Deactivated rows are invisible to the institution** — the checkbox simply
  shows unticked. They are recoverable by re-ticking, but there is no history view.

## 8. How a future developer would extend this

`set()` walks *every* group the institution owns and compares desired against
actual — that loop is why omission means deactivate. Adding a field means adding
it to the entry DTO, the comparison, and the audit payload together.

**Do not add a unique index** across provider+programme+group without first
migrating the level/feeYear rows the importer may hold.

If per-level pricing is wanted, `SCOPE` in the service is the single place that
assumes `level: null`.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication / role | `JwtAuthGuard`, `RolesGuard`, `@Roles('PROVIDER')` |
| Tenancy — programme | Looked up as `{ id, providerId }`; another institution's programme 404s |
| Tenancy — groups | Every entry's group must be in the caller's own group list, or the whole request is refused rather than the entry skipped |
| Unknown fields | Global `forbidNonWhitelisted`; nested entries validated with `@ValidateNested` |
| Review gate | New pricing lands PENDING; a changed amount returns to PENDING |
| Destruction | No delete path — unchecking sets `isActive: false` |
| Data integrity | Rows written with `nationality: null`, satisfying slice E's XOR CHECK constraint |
| Rate limit | 40 writes/minute per institution |
| Audit | `PROVIDER_PROGRAMME_GROUP_{TUITION,SCHOLARSHIP}_{SET,DEACTIVATED}` with the previous amount and whether the change cost the approval |

## 10. Rollback instructions

Code-only; revert the commit. The rows it wrote are ordinary group-scoped pricing
rows and remain valid — slice E's resolver reads them whether or not this screen
exists. To remove them as well:

```sql
UPDATE provider_tuitions     SET "isActive" = false
  WHERE "programmeId" IS NOT NULL AND "nationalityGroupId" IS NOT NULL;
UPDATE provider_scholarships SET "isActive" = false
  WHERE "programmeId" IS NOT NULL AND "nationalityGroupId" IS NOT NULL;
```

Deactivate rather than delete, for the same reason the feature does.
