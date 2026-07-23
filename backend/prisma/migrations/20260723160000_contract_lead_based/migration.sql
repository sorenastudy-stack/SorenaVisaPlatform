-- PR-CONTRACT-LEAD (Phase B) — allow a Contract to be raised Lead-based, before
-- a Case exists. The Case is auto-created when the CLIENT (first signer) completes
-- their signature, and caseId is backfilled onto the Contract at that moment.
--
-- SAFETY: every change is additive or a constraint-relaxation. Existing contracts
-- ALL have caseId set (it was NOT NULL until now), so:
--   • dropping NOT NULL on caseId cannot affect any existing row (all are non-null),
--   • the existing unique index "contracts_caseId_key" stays and keeps enforcing
--     one-contract-per-case (Postgres allows many NULLs, which is exactly the
--     lead-based window we want),
--   • leadId is a new nullable column — legacy rows leave it NULL and keep
--     resolving their lead through the case, unchanged.

-- 1. caseId becomes nullable (the lead-based window has no case yet).
ALTER TABLE "contracts" ALTER COLUMN "caseId" DROP NOT NULL;

-- 2. New nullable lead link + its FK (SET NULL on lead delete — never cascade a
--    contract away). Matches the Prisma `lead Lead? @relation` on Contract.
ALTER TABLE "contracts" ADD COLUMN "leadId" TEXT;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Plain lookup index on leadId (matches Prisma @@index([leadId])).
CREATE INDEX "contracts_leadId_idx" ON "contracts"("leadId");

-- 4. PARTIAL UNIQUE INDEX — "one LIVE lead-based contract per lead". Enforced only
--    while caseId IS NULL (the pre-case window). Once the case exists and caseId is
--    backfilled, the row leaves this index, so a lead can later hold exactly one
--    case-based contract (guarded separately by contracts_caseId_key). Partial
--    indexes are not expressible in the Prisma schema, so this lives ONLY here —
--    do not expect `prisma db pull` to reproduce it; keep it in migrations.
CREATE UNIQUE INDEX "contracts_leadId_active_key"
  ON "contracts"("leadId")
  WHERE "caseId" IS NULL;
