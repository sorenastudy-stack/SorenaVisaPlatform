-- PR-LIA-AUTO-ASSIGN, Phase 5b — ContractStatus enum/string mismatch fix.
--
-- The DocuSign webhook previously wrote raw lowercase envelope statuses
-- ('created' / 'sent' / 'delivered' / 'completed' / 'declined' / 'voided')
-- into the `contracts.status` column whose Prisma type is the uppercase
-- ContractStatus enum (DRAFT | SENT | VIEWED | SIGNED | DECLINED | EXPIRED).
-- The mismatch was never exercised in prod (0 signed contracts in the DB
-- at the time of this PR), but the migration normalises any pre-existing
-- lowercase rows so the column is internally consistent. The code path is
-- now safe via the new docusignToContractStatus() mapper in
-- backend/src/contracts/contract-status.ts.
--
-- The UPDATE statements are idempotent: each cast-to-text comparison
-- only matches the wrong-case value, never the correct enum value, so
-- re-running this migration is a no-op once the column is clean.

UPDATE "contracts" SET status = 'DRAFT'    WHERE status::text IN ('created', 'draft');
UPDATE "contracts" SET status = 'SENT'     WHERE status::text = 'sent';
UPDATE "contracts" SET status = 'VIEWED'   WHERE status::text IN ('delivered', 'viewed');
UPDATE "contracts" SET status = 'SIGNED'   WHERE status::text = 'completed';
UPDATE "contracts" SET status = 'DECLINED' WHERE status::text = 'declined';
UPDATE "contracts" SET status = 'EXPIRED'  WHERE status::text IN ('voided', 'expired');
