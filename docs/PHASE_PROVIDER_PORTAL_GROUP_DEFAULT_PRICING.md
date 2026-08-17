# Provider Portal — Default pricing at country-group level

**Status:** DONE — 17 August 2026
**Depends on:** Slice E (country groups, the specificity rule) and the
per-programme group pricing screen.

---

## 1. What this phase does

A country group can now carry a **default price** — one tuition fee and one
scholarship that apply across every programme, set once on the group form
instead of programme by programme.

It composes with the per-programme screen **without a single new matching rule**:

| Row | programmeId | specificity | wins when |
|---|---|---|---|
| exact-nationality rate | any | **4** + … | always, over both below |
| programme override (per-programme screen) | set | 2 | that programme |
| **group default (this phase)** | null | 0 | every other programme |

Slice E's resolver already scored these correctly. That was verified live rather
than reasoned about — see §6.

The other half of the work was **removing a duplicate**: the create / re-pend /
deactivate rules now live in one reconciler that both screens call, because two
screens writing the same rows under two copies of the same rules is a drift
waiting to happen.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/provider-portal/group-rate.reconciler.ts` | The rate rules, once, for both screens. |

**Changed**
| File | Change |
|---|---|
| `backend/src/provider-portal/nationality-group.service.ts` | Applies + reports defaults; the two `createGroupRate` endpoints now reconcile instead of blindly inserting. |
| `backend/src/provider-portal/dto/nationality-group.dto.ts` | `defaultTuitionAmount`, `defaultScholarshipAmount`. |
| `backend/src/provider-portal/provider-programme-pricing.service.ts` | Refactored onto the reconciler; its own copy of the rules deleted. |
| `backend/src/provider-portal/provider-programme-boundary.spec.ts` | Assertions follow the rules to the reconciler; one new test that both callers use it. |
| `frontend/src/components/provider/ProviderPricingGroups.tsx` | Two fields on the form, a summary line on the list, and a third rate state. |

## 3. Database changes

**None.** No migration. The rows are `ProviderTuition` / `ProviderScholarship`
with `nationalityGroupId` set and `programmeId: null` — a shape Slice E already
created via "Set a rate"; this gives it a proper home and an edit path.

## 4. Environment variables

None added.

## 5. Third-party services

None added.

## 6. How to test it works

**Country groups** → **New group** (or **Edit**) → fill *Tuition fee* and/or
*Scholarship* under **Default price for this group**.

**What was actually run, 17 Aug 2026** — over HTTP, two institutions:

```
24/24 checks passed
  a group created with a default price          $25,000 / $2,000, both PENDING
    institution-wide (programmeId null), group-scoped (nationality null)
  the list carries it for the summary line
  staff approve both
  re-saving the SAME default                    keeps the approval
  CHANGING it                                   $26,500, back to PENDING
    the untouched scholarship                   keeps its approval
  THE COMPOSITION
    a programme with NO override                $26,500 via GROUP  ← the default
    a programme WITH an override                $31,000            ← the override
    different rows won — no new rule was needed
    a student outside the group                 $40,000 (DEFAULT)
    an EXACT nationality still outranks both    $22,000 via EXACT
  clearing the defaults                         rows survive, isActive=false
    the list reports "No default price set"
  B cannot set a default on A's group           404, nothing written for B
```

**In a real browser**: **14/14** — the form offers both fields with the review
note, saving writes an institution-wide PENDING row, the list shows
`Tuition: $25,000 · Scholarship: $2,000 · with us for review`, reopening returns
the amounts, and clearing them deactivates rather than deletes.

Suites: backend **113 / 1420**, frontend **6 / 66**.

## 7. Known limitations

- **One default per group, unscoped by level.** Rows are written with
  `level: null`. A default that varies by qualification level still needs the
  spreadsheet.
- **Percentage scholarships are not offered here** — the field writes `FIXED`.
- **A cleared default still blocks group deletion.** Deletion is refused while
  *any* row references the group, and a deactivated row still does (the FK is
  `RESTRICT` and does not care about `isActive`). The list now labels those rows
  **Not applied** so the disabled Delete button is explicable — but "clear the
  price, then delete the group" still does not work. Worth revisiting.
- **The older "Set a rate" button overlaps this.** It writes the same row when no
  programme is chosen. It now reconciles rather than inserting, so the two cannot
  produce duplicate provider-wide rates, but two doors to one setting is still
  one door too many.
- **No history.** A deactivated default is recoverable by retyping it; there is
  no view of what it used to be, only the audit trail staff can read.

## 8. How a future developer would extend this

`group-rate.reconciler.ts` is the only place the create / re-pend / deactivate
rules exist. Change them there and both screens follow; add a copy elsewhere and
the boundary spec fails on purpose.

The three-way ranking is entirely `specificity()` in `student-pricing.logic.ts`.
Adding a fourth scope means changing that function and its tier constant — not
this file.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication / role | `JwtAuthGuard`, `RolesGuard`, `@Roles('PROVIDER')` |
| Tenancy | The group is looked up as `{ id, providerId }`; another institution's group 404s and nothing is written |
| Unknown fields | Global `forbidNonWhitelisted` |
| Review gate | A new default lands PENDING; a changed amount returns to PENDING |
| Destruction | Clearing sets `isActive: false`; the reconciler contains no `delete` |
| Data integrity | `nationality: null` on every row, satisfying Slice E's XOR CHECK constraint |
| Rate limit | 40 writes/minute per institution (unchanged) |
| Audit | `PROVIDER_GROUP_{TUITION,SCHOLARSHIP}_{SET,DEACTIVATED}` carrying `scope: INSTITUTION_DEFAULT` vs `PROGRAMME`, plus the previous amount |

## 10. Rollback instructions

Code-only; revert the commit. The rows remain valid — Slice E's resolver reads
them whether or not this screen exists, and they behave exactly as a "Set a rate"
row always did. To retire them as well:

```sql
UPDATE provider_tuitions     SET "isActive" = false
  WHERE "programmeId" IS NULL AND "nationalityGroupId" IS NOT NULL;
UPDATE provider_scholarships SET "isActive" = false
  WHERE "programmeId" IS NULL AND "nationalityGroupId" IS NOT NULL;
```

Note the reverted code would restore the per-programme service's own copy of the
rate rules; the reconciler and its callers move together.
