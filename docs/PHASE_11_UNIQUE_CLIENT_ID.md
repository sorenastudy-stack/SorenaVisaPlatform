# Phase 11 — Unique Client ID

End-of-phase handover for giving every lead a permanent, human-readable client
identifier. Built, tested, migrated, and backfilled on production.

**Date:** 2026-07-23
**Commits (this phase):**
- `0085ee4` — feat(leads): permanent human-readable Client ID per lead ({COUNTRY}-{YEAR}-{NNNNNN})
- `11f1d84` — change(leads): Client ID fallback prefix XX → TEST for country-less leads

---

## 1. What this phase does

Every `Lead` now gets a permanent, human-readable **Client ID** at creation, in the
format **`{COUNTRY}-{YEAR}-{NUMBER}`** (e.g. `NZ-2026-000001`):

- **COUNTRY** — the 2-letter code resolved from the lead's country signals
  (residence → target country → raw Wix country), remapping GB → **UK** per spec.
- **YEAR** — the 4-digit creation year.
- **NUMBER** — a 6-digit, zero-padded, **single global** sequence per year (shared
  across all countries) that resets to 1 on 1 January.

The number comes from an **atomic per-year counter row** (`client_id_counters`),
never `COUNT(*)+1`, so concurrent lead creation can't collide. The id is purely
additive: it does **not** replace the internal cuid `id` (all relations still key
on that). It's surfaced in the staff Leads list, lead detail, and case header for
support/searchability. Leads with no resolvable country get a **`TEST`** prefix so
they're obvious at a glance. All 6 lead-creation entry points were wired, and the
existing production leads were backfilled.

## 2. Files created or changed

Pulled from `git diff --stat f22e0fc..11f1d84`. **16 files, +256 / −3.**

**Created**
- `backend/src/leads/client-id.ts` — the dependency-free core: `resolveCountryCode`,
  `formatClientId`, the atomic `nextClientNumber` (`INSERT … ON CONFLICT DO UPDATE …
  RETURNING`), and `generateClientId` (resolve country → contact fallback → atomic
  number). Shared by every runtime path and the backfill. `0085ee4`; `TEST` fallback
  in `11f1d84`.
- `backend/src/leads/client-id.spec.ts` — unit tests for country resolution
  (names → alpha-2, UK remap, case/space tolerance, priority order) and the
  `{COUNTRY}-{YEAR}-{NNNNNN}` format/padding. `0085ee4`.
- `backend/prisma/migrations/20260723120000_add_client_id/migration.sql` — the
  `Lead.clientId` column + unique index + `client_id_counters` table. `0085ee4`.

**Changed — schema**
- `backend/prisma/schema.prisma` — added `Lead.clientId String? @unique` and the
  `ClientIdCounter` model (`@@map("client_id_counters")`). `0085ee4`.

**Changed — the 6 lead-creation entry points** (each calls `generateClientId`, inside
the same transaction as the lead insert where one exists, so a failure rolls back
together and leaves no counter gap):
- `backend/src/leads/leads.service.ts` — direct lead creation. `0085ee4`.
- `backend/src/booking/booking.service.ts` — lead created via the booking flow. `0085ee4`.
- `backend/src/public/public.service.ts` — public form submission. `0085ee4`.
- `backend/src/scorecard/scorecard.service.ts` — scorecard submission. `0085ee4`.
- `backend/src/webhooks/wix/wix-webhooks.service.ts` — Wix lead capture. `0085ee4`.
- `backend/src/whatsapp/whatsapp.service.ts` — WhatsApp lead capture. `0085ee4`.

**Changed — display/passthrough (read-only, not creation)**
- `backend/src/leads/staff-leads.service.ts` — selects + returns `clientId` in the
  staff leads list + detail. `0085ee4`.
- `backend/src/staff/cases/staff-cases.service.ts` — surfaces the lead's `clientId`
  on the case. `0085ee4`.
- `frontend/src/app/staff/leads/page.tsx`, `frontend/src/app/staff/leads/[id]/page.tsx`,
  `frontend/src/components/staff/cases/detail/CaseHeader.tsx`,
  `frontend/src/components/staff/cases/detail/types.ts` — render the Client ID. `0085ee4`.

The atomic counter (the race-safety guarantee):

```ts
// INSERT … ON CONFLICT DO UPDATE … RETURNING locks the counter row for the
// statement, so two concurrent callers serialize and get distinct values.
const rows = await db.$queryRaw<Array<{ lastNumber: number }>>(Prisma.sql`
  INSERT INTO "client_id_counters" ("year", "lastNumber")
  VALUES (${year}, 1)
  ON CONFLICT ("year")
  DO UPDATE SET "lastNumber" = "client_id_counters"."lastNumber" + 1
  RETURNING "lastNumber"
`);
```

## 3. Database tables / columns added

- **`Lead.clientId String? @unique`** — the human-readable id. Nullable (safe on the
  live table; brand-new leads always get one, and existing rows were backfilled) with
  a unique index. The relational cuid `id` is untouched.
- **`client_id_counters`** — the atomic sequence source. One row per year:
  `year INTEGER PRIMARY KEY`, `lastNumber INTEGER NOT NULL DEFAULT 0`.
- **Migration:** `20260723120000_add_client_id` (2026-07-23). Applied to production
  via `prisma migrate deploy`.

```sql
ALTER TABLE "leads" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "leads_clientId_key" ON "leads"("clientId");
CREATE TABLE "client_id_counters" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "client_id_counters_pkey" PRIMARY KEY ("year")
);
```

**Backfill (one-off, production):** the existing leads were assigned Client IDs in a
one-off run reusing the exact `generateClientId` logic (same country resolution +
atomic counter), ordered by creation date so historical leads number in creation
order. **The `leads` table was backed up before the backfill.** The backfill was an
operational script run against production, **not** a committed repo artifact — do not
look for it in `backend/scripts`.

## 4. Environment variables added (names only)

**None.** Client ID generation is self-contained (DB + the `i18n-iso-countries`
library already in the dependency tree). No configuration is required.

## 5. Third-party services connected

**None.** No external service. Country-name → ISO alpha-2 resolution uses the
**`i18n-iso-countries`** npm library (bundled, offline), not a network lookup.

## 6. How to test it works

**A. New lead gets an ID (each entry point)**
1. Create a lead through an entry point (quickest: staff **Create lead**, or submit
   the public scorecard / booking form with a throwaway email).
2. Confirm the lead now shows a **Client ID** in the staff Leads list / detail in the
   form `{COUNTRY}-2026-{NNNNNN}` (e.g. `NZ-2026-000123`).
3. Set the lead's country to one that resolves (e.g. "New Zealand" → `NZ`,
   "United Kingdom" → `UK`); with no resolvable country the prefix is **`TEST`**.

**B. Sequence is global-per-year and gap-free**
1. Create two leads back-to-back (any countries). Confirm the numeric suffix
   **increments by exactly 1** across them regardless of country (single global
   counter), and is zero-padded to 6 digits.

**C. Race safety**
1. (Optional) Fire several concurrent lead creations; confirm **no duplicate**
   `clientId` and **no gap** in the sequence — the unique index + atomic counter
   guarantee this.

**D. Case surfacing**
1. Convert a lead with a Client ID to a case; confirm the **case header** shows the
   same Client ID (carried from the lead).

**Automated checks already green:** `client-id.spec` — country resolution
(names → alpha-2, UK remap, case/space tolerance, residence → target → raw priority,
null/unmappable → fallback) and the format/zero-pad rules.

## 7. Known limitations

- **`clientId` is nullable.** A brand-new lead always gets one, and production was
  backfilled, but the column allows null; a future lead-creation path that forgets to
  call `generateClientId` would leave it null rather than fail. Wire any new entry
  point through `generateClientId` (see §8).
- **`TEST` prefix for country-less leads.** These are valid ids but flagged as
  test/incomplete-country by the prefix; if the country is later filled in, the id is
  **not** retroactively re-prefixed (ids are permanent by design).
- **Counter is per-calendar-year, resets at 1 on 1 January.** Two different years can
  reuse the same 6-digit number (disambiguated by the `{YEAR}` segment), so never
  parse a Client ID by fixed width — split on `-`.
- **`i18n-iso-countries` coverage is name-based.** Misspelled or non-standard country
  names don't resolve and fall through to `TEST`.

## 8. How a future developer would extend this

- **Wire a new lead-creation entry point:** import `generateClientId` from
  `backend/src/leads/client-id.ts` and call it with a transaction client
  (`generateClientId(tx, { contactId, countryOfResidence?, targetCountry?, countryRaw? })`)
  in the **same transaction** as the lead insert, then set `clientId` on the lead.
- **Change the format:** `formatClientId` (padding/segments) and `generateClientId`
  (assembly) in `client-id.ts` — but note existing ids are permanent, so a format
  change only affects new leads.
- **Add/adjust country mapping:** `nameToAlpha2` / `targetToAlpha2` / the priority in
  `resolveCountryCode` in `client-id.ts`. The GB → UK remap and the study-destination
  enum mapping live there.
- **Change the fallback prefix:** the `UNKNOWN_COUNTRY` constant in `client-id.ts`
  (currently `'TEST'`).
- **Never parse a Client ID positionally** — always `split('-')`; the country segment
  is not guaranteed to be exactly 2 chars in future.

## 9. Security layers applied

- **Race safety by construction** — the atomic `INSERT … ON CONFLICT DO UPDATE …
  RETURNING` counter serializes concurrent callers, and the **unique index** on
  `Lead.clientId` is the hard backstop against duplicates even under a bug.
- **Transaction-scoped generation** — where the lead insert runs in a transaction,
  the id + counter increment share it, so a failed insert rolls back the counter too
  (no leaked/gap numbers).
- **No PII in the id** — the Client ID encodes only country + year + a sequence
  number; it exposes nothing about the person and is safe to show in staff UIs and
  use in support conversations.
- **Backfill was backed up first** — the `leads` table was snapshotted before the
  one-off production backfill, per the money/bulk-data change policy.

## 10. Rollback instructions

The migration is **additive and nullable**, so the safest rollback is code-only:

1. **Revert the code:** `git revert 11f1d84 0085ee4`. New leads then stop receiving a
   Client ID (the column stays and simply goes null on new rows); nothing else breaks
   because no relation depends on `clientId`.
2. **Leave the schema in place.** The `clientId` column, its unique index, and
   `client_id_counters` are harmless if unused — **do not** drop them if any lead
   already has an id you want to keep, and dropping is unnecessary for a functional
   rollback.
3. If a full schema teardown is ever truly required (not recommended), drop the unique
   index, then `Lead.clientId`, then the `client_id_counters` table — after confirming
   nothing reads the column. Back up `leads` first.
