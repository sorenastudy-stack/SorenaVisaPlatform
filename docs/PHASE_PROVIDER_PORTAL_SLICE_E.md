# Provider Portal — Slice E: Grouped-Nationality Pricing

**Status:** DONE — 17 August 2026
**Depends on:** Slices A–D.
**Followed by:** Slice F — analytics panel.

---

## 1. What this phase does

An institution can group countries that share a fee — "South Asia" — and set one
rate for the whole group instead of one row per country.

The CRUD around it is ordinary. The part that matters is one rule:

> **An exact nationality always outranks a group. Full stop.**

A provider who writes a South Asia rate and then a separate Indian rate has said
something specific about India, and no amount of extra specificity on the group
row — programme, level, a newer fee year — may overrule it. That is a different
number quoted to a real person, so it is enforced by a specificity tier that
exceeds everything below it combined, and proven by breaking it.

Scholarships work the other way, and deliberately: they SUM. See §7.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/prisma/migrations/20260817163000_provider_portal_slice_e/` | The model, the columns, and two CHECK constraints. |
| `backend/src/provider-portal/nationality-group.controller.ts` | Group CRUD + grouped-rate creation. |
| `backend/src/provider-portal/nationality-group.service.ts` | Scoping, normalisation, the delete rule. |
| `backend/src/provider-portal/dto/nationality-group.dto.ts` | Three DTOs; none accepts a `providerId`. |
| `backend/src/providers/pricing-rows.mapper.ts` | The one place a DB row becomes a logic row. |
| `backend/src/providers/nationality-group-pricing.logic.spec.ts` | 19 tests, mostly about which row wins. |
| `frontend/src/app/provider/pricing/page.tsx` + `components/provider/ProviderPricingGroups.tsx` | The screen. |

**Changed**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | `NationalityGroup`; `nationality` nullable + `nationalityGroupId` on both pricing models. |
| `backend/src/providers/student-pricing.logic.ts` | `nationalityMatch()`, `EXACT_NATIONALITY_TIER`, `matchedVia`. |
| `backend/src/providers/scholarship-total.logic.ts` | Group matching; the summing rule restated. |
| `backend/src/explore/explore.service.ts` | Loads the group; `as any` removed at three call sites. |
| `backend/src/matching/matching.service.ts` | The **SQL** nationality filter now names groups. |
| `backend/src/providers/providers.service.ts` | The review queue shows which group a rate covers. |
| `frontend/src/components/provider/ProviderShell.tsx` | Third nav destination. |

## 3. Database changes

Migration `20260817163000_provider_portal_slice_e`:

- **`nationality_groups`** — `id`, `providerId`, `name`, `nationalities String[]`,
  timestamps. Unique on `(providerId, name)`. `String[]` matches how nationality
  is already stored on the rate rows; a join table would add a hop for a list
  that is only ever read whole.
- **`provider_tuitions` / `provider_scholarships`** — `nationality` becomes
  NULLABLE, `nationalityGroupId` added, FK **`ON DELETE RESTRICT`**.
- **Two CHECK constraints**, written by hand because Prisma cannot express them:

```sql
CHECK (("nationality" IS NULL) <> ("nationalityGroupId" IS NULL))
```

That is XOR. Neither set would be a rate that applies to nobody — which the
resolver would skip on its way to the flat fee, quoting a student a different
number with nothing looking wrong. Both set would be a rate whose meaning depends
on which field the reader checks first, and the two answers are different amounts
of money.

**No backfill.** Counts confirmed first: tuition **0 dev / 0 prod**, scholarships
**297 dev / 0 prod**. Every existing row has a nationality and no group, which
already satisfies the constraint.

## 4. Environment variables

None added.

## 5. Third-party services

None added.

## 6. How to test it works

Open **Country groups** in the institution portal, create a group, press **Set a
rate**.

**What was actually run, 17 Aug 2026** — two institutions, over HTTP:

```
29/29 checks passed
  create a group                             codes upper-cased, de-duplicated: IN,IR,PK
    a group is NOT itself review-gated
  duplicate name refused (409) / no countries refused (400)
  a tuition rate attached to a group         PENDING
  a scholarship attached to a group          PENDING
    the row names the group and NOT a nationality (the XOR)
  deleting a group that still has rates      409 — "still used by 1 fee and 1 scholarship"
  a group with no rates CAN be deleted       200
  EXACT BEATS GROUP even when the group row is more specific and newer
                                             won=exact, $30,000, via EXACT
  a student covered only by the group        $25,000 via GROUP
  a student in neither                       $40,000 (DEFAULT)
  B sees none of A's groups; cannot edit/delete them (404 ×2)
  B cannot attach a rate to A's group (404), no row created for B
  a body claiming a providerId               400
  the review queue names the group           "South Asia (3 countries)", not a blank
  group and rate actions audited             4 event types
  test institutions, groups, rates and logins removed   0 left
```

The database-level guarantees were probed directly: a row with **neither** and a
row with **both** are each rejected by the CHECK constraint, a group-only row is
accepted, and deleting a referenced group is refused by the FK.

**In a real browser**: **15/15** — creating a group resolves `ir, PK, in, ZZZ` to
India/Iran/Pakistan with the invalid code dropped, stores `IN,IR,PK`, and says
**nothing** about review; pressing **Set a rate** does state the gate and names
the count ("apply to all 3 countries"); the rate lands PENDING and lists as *With
us for review*; the Delete button is disabled with an explanation while a rate
uses the group.

Suites: backend **112 / 1401**, frontend **5 / 53**.

**The specificity rule was broken on purpose and watched to fail**:

| Reintroduced mistake | Suite |
|---|---|
| the exact-nationality tier removed entirely (0) | RED |
| the tier set to **3** — enough to *tie* a programme+level group row, not to beat it | RED |
| specificity ignoring how the row matched | RED |
| `tuitionMatches` no longer checking group membership | RED |
| the scholarship matcher blind to groups | RED |
| (restored) | GREEN |

## 7. Known limitations

- **⚠ Scholarships SUM; they do not outrank.** An institution with a "South Asia
  — $2,000" award *and* an "India — $3,000" award gives an Indian student
  **$5,000**. That follows the Owner's standing rule (a student holds several
  awards from different funding sources at once) rather than contradicting it,
  and a group award is a distinct source. **But an institution that migrates a
  country into a group and forgets to delete the old row has doubled an award by
  accident.** The per-line breakdown names both, and staff see the same breakdown
  at review time, so it is visible rather than buried in a total. If the Owner
  wants exact-suppresses-group here too, `nationalityMatch` in
  `scholarship-total.logic.ts` is the one function to change.
- **Groups are per-institution.** There is no shared "EU" every provider can use;
  two institutions defining South Asia differently is allowed, and correct — the
  fee is theirs.
- **A rate can be moved to a group only by creating a new one.** There is no
  "convert these twelve rows into a group" action.
- **Editing a group's country list is not reviewed**, though it changes who every
  attached rate applies to. The audit records the before and after lists, but a
  group edit does not return attached rates to PENDING. Worth revisiting if
  groups get large.
- **Grouped rates cannot be edited or deleted from the portal** — only created.
  Editing existing rate rows is not in any slice yet.

## 8. How a future developer would extend this

`nationalityMatch()` exists in both logic files and is the only place that
decides whether a row reaches a student. Change it there, not in the callers.

**`EXACT_NATIONALITY_TIER` must exceed the sum of every other specificity term.**
If a term is added below it, raise it — the spec asserts the *relationship*, not
the number, so it will fail rather than silently mis-price.

Any new query that feeds the resolver must use `PRICING_GROUP_INCLUDE` and the
mappers. That file exists because three call sites passed Prisma rows in with
`as any`, which would have compiled fine while every grouped rate matched nobody.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication / role | `JwtAuthGuard`, `RolesGuard`, `@Roles('PROVIDER')` |
| Tenancy | Every group lookup scoped by `{ id, providerId }`; attaching a rate re-checks that both the group **and** the programme belong to the caller |
| Unknown fields | Global `forbidNonWhitelisted` — a body carrying `providerId` is a 400 |
| Data integrity | Two CHECK constraints (XOR) and an FK `RESTRICT`, at the database, not only in the service |
| Review gate | Grouped rates land PENDING like every other rate; groups themselves carry no money and are not gated |
| Input normalisation | Country codes upper-cased, trimmed, de-duplicated and length-checked before storage |
| Currency | NZD only on grouped rates — the resolver has no FX table and would otherwise skip the row |
| Rate limit | 40 writes/minute per institution |
| Audit | `PROVIDER_NATIONALITY_GROUP_{CREATED,UPDATED,DELETED}`, `PROVIDER_GROUP_{TUITION,SCHOLARSHIP}_CREATED`; the update records both country lists |

## 10. Rollback instructions

The migration is additive apart from one widening (`nationality` NOT NULL →
NULL), so a code revert alone leaves the database consistent and every existing
row readable.

To reverse fully:

```sql
DELETE FROM provider_tuitions      WHERE "nationalityGroupId" IS NOT NULL;
DELETE FROM provider_scholarships  WHERE "nationalityGroupId" IS NOT NULL;
ALTER TABLE provider_tuitions      DROP CONSTRAINT provider_tuitions_nationality_xor_group;
ALTER TABLE provider_scholarships  DROP CONSTRAINT provider_scholarships_nationality_xor_group;
DROP TABLE nationality_groups CASCADE;
ALTER TABLE provider_tuitions      ALTER COLUMN "nationality" SET NOT NULL;
ALTER TABLE provider_scholarships  ALTER COLUMN "nationality" SET NOT NULL;
```

Delete the grouped rows **before** restoring NOT NULL — they have a NULL
nationality by design and would otherwise block it.
