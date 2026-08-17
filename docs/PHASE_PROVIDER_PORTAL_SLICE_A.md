# Phase — Provider Portal, Slice A: foundation and review gate

**Date:** 17 August 2026
**Status:** built and verified
**Scope:** slice A of three. **No login, no provider controller, no provider DTO, no importer
wrapper, no provider UI** — those are slices B and C.

## 1. What this phase does

Two things, both foundations.

**It closes the review gap on pricing.** `EducationProgramme` has had a review gate since the
catalogue importer existed: `reviewStatus` APPROVED + `isActive` + provider ACTIVE, which is
why 261 of 1,129 production programmes are visible. `ProviderTuition` and `ProviderScholarship`
had only `isActive` — a switch the uploader controls, not a second pair of eyes. A spreadsheet
could put a price in front of a client in one step. Both tables now carry `reviewStatus`,
defaulting to PENDING, and the student-facing reads require APPROVED.

**It adds the field slice B will resolve identity from.** `EducationProvider.userId`, unique
and nullable, plus `PROVIDER` on `UserRole`. Nothing reads either yet.

## 2. Files created or changed

**Created**
- `backend/prisma/migrations/…_provider_portal_slice_a/migration.sql`
- `docs/PHASE_PROVIDER_PORTAL_SLICE_A.md`

**Changed**
- `backend/prisma/schema.prisma` — `PROVIDER` role, `EducationProvider.userId` + relation,
  `reviewStatus` on both pricing tables
- `backend/src/explore/explore.service.ts` — `STUDENT_VISIBLE_PRICING`, applied to four reads
- `backend/src/matching/matching.service.ts` — the same constant on its scholarship read
- `backend/src/providers/providers.service.ts` — pending pricing in the review queue,
  `setPricingReview()` + four wrappers
- `backend/src/providers/providers.controller.ts` — four approve/reject routes

## 3. Database changes

```
ALTER TYPE  "UserRole" ADD VALUE 'PROVIDER';
ALTER TABLE "education_providers"    ADD COLUMN "userId" TEXT;          -- unique, FK, SET NULL
ALTER TABLE "provider_scholarships"  ADD COLUMN "reviewStatus" ... DEFAULT 'PENDING';
ALTER TABLE "provider_tuitions"      ADD COLUMN "reviewStatus" ... DEFAULT 'PENDING';
UPDATE      "provider_scholarships"  SET "reviewStatus" = 'APPROVED';   -- backfill
```

**The scholarship backfill is deliberate and the tuition non-backfill more so.**

Existing scholarship rows predate the gate; they were entered by staff under the old standard
where `isActive` was the only switch, so they are already approved in every sense except a
column that did not exist. Leaving them PENDING would have blanked live pricing. The unqualified
`UPDATE` is safe *because* it runs once, atomically, in the migration that adds the column: "every
row now" and "every row predating the gate" are the same set.

**Tuition was deliberately not backfilled.** Both environments hold **zero** tuition rows, so
there is nothing to grandfather — and if this migration is ever replayed against a database that
does have tuition, the safe default is the one that hides a price, not the one that publishes it
unreviewed.

Counts at authoring time: dev 297 scholarships (198 active), 0 tuition. Production 0 and 0.

## 4. Environment variables

**None.**

## 5. Third-party services

**None.**

## 6. How to test it works

### The visibility proof

Captured before the migration, re-checked after, against dev:

| | before | after |
|---|---|---|
| programmes visible | 158 | **158** |
| scholarships visible | 198 | **198** |
| tuition visible | 0 | **0** |

Nothing disappeared. Rather than rely on totals matching — which two offsetting errors could
also produce — the complete form of the proof is that **no row can disappear**:

```
scholarships: 0 row(s) would disappear, 198 remain visible
tuition:      0 row(s) would disappear,   0 remain visible
```

That query asks for rows that were visible before (`isActive`) and are not APPROVED now. An
empty set means the added condition excluded nothing.

Production: 0 rows either side, and the same query runs clean.

### The workflow, end to end over HTTP — 19/19

1. A new tuition row and a new scholarship row both default to **PENDING** — created directly
   as staff, with no provider involved, which is the point: one standard, not two tiers.
2. Both are **invisible** to students while pending.
3. Both appear in `GET /providers/review-queue` **with the figures a reviewer needs** —
   institution name, nationality, amount and currency, not just an id.
4. An **ADMIN** attempting to approve gets **403**; an unauthenticated caller gets **401**.
5. The **Owner** approves; the row becomes visible.
6. Approving does **not** flip `isActive`.
7. The decision is recorded as `PROVIDER_TUITION_APPROVED` with the actor and the figures.
8. Rejecting hides it again.

Probe rows deleted, deletion asserted. 1294 tests / 108 suites.

## 7. Known limitations

**This is a real workflow change and it is not reversible by accident.** Staff can no longer
make a price live in one upload step. Every row from the existing Excel importer — the one that
loaded all 1,129 production programmes — now lands PENDING and needs approval. That was the
explicit instruction and it is the right call for competitively sensitive data, but the first
person to upload a pricing sheet after this will find it does not appear.

**Approval is per row.** A spreadsheet of 200 tuition rows produces 200 pending rows and no bulk
action. That is fine at today's volume (zero rows) and will not be at real volume; a bulk
approve belongs with the importer wrapper in slice C, where the batch is a known unit.

**No provider can do anything yet.** The role exists, the column exists, and nothing reads
either. `EducationProvider.userId` is null on all 96 production institutions.

**`isActive` and `reviewStatus` now both exist and mean different things** — "this rate is
current" versus "somebody checked it". They are deliberately not coupled, so approving never
republishes a retired rate. A future reader may find this redundant; it is not.

## 8. How a future developer would extend this

**Slice B resolves the provider from `EducationProvider.userId` via the JWT, in a guard, in its
own controller.** Not from a URL parameter, not from a body. `ProvidersController` has no
ownership check on `:id` anywhere — `req.user` appears 17 times and every one is attribution —
so adding `PROVIDER` to its `@Roles` would be a direct cross-tenant leak. The agent portal
already solved this shape: `resolveAgentAccess` + a guard.

**Never expose `UpdateProviderDto` to a provider.** It carries eight commission fields plus
`volumeTarget` and `bonusValue` — an institution editing its own commission terms with Sorena.

**Add pricing reads through `STUDENT_VISIBLE_PRICING`, never inline.** It is exported from
`explore.service.ts` and used by `matching.service.ts` for the same reason `STUDENT_VISIBLE` is
a single constant: the two can then only drift deliberately.

## 9. Security layers applied

**Access control, server-side, on every new route.** Approve/reject are `PROVIDER_ADMIN`
(OWNER/SUPER_ADMIN) — the tier that already owns commercial terms, since a price is a commercial
fact rather than catalogue curation. Proven with a real ADMIN token (403) and unauthenticated
(401), not assumed from the decorator.

**Audit on every decision.** Each approve/reject emits an event carrying the provider, the
nationality, the amount, the currency, the previous status and the actor — enough to answer
"who made this price visible, and what was it" months later.

**Fail-closed default.** `PENDING` is the column default, so a row created by any path — the
importer, a script, a future provider login, a direct insert — is invisible until reviewed.
Nothing has to remember to gate it.

**Blast radius of the migration.** Additive except the scholarship backfill, which only ever
widens visibility (PENDING → APPROVED) and cannot hide anything. `userId` is `SET NULL` on
delete, so removing a user can never cascade into deleting an institution and its catalogue.

**Not applied here:** rate limiting and Owner-approval-gated provisioning belong to slice B,
which introduces the login and the external-facing endpoints. There is no new external surface
in this slice.

## 10. Rollback instructions

Revert the commit and the schema returns to its previous shape, but **the columns remain** —
reverting code does not drop them. Behaviour reverts fully: the pricing reads stop filtering on
`reviewStatus`, so every `isActive` row is visible again exactly as before, which is the
pre-migration state.

To remove the columns as well, generate a down-migration with `prisma migrate diff` against the
reverted schema. There is no data to preserve in `userId` (null everywhere) and the scholarship
`reviewStatus` values are all APPROVED, which is what the code assumed before the column existed.
