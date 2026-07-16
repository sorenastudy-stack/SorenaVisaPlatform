-- Phase E — sessions are priced in USD; wallets follow.
--
-- 1. New wallets default to USD.
-- 2. Existing EMPTY NZD wallets are migrated to USD. Guarded on balanceCents=0
--    so a funded wallet is never silently re-denominated. Verified before the
--    prod apply: 0 funded wallets, 0 wallet_transaction rows.
-- Idempotent + additive; safe to re-run.
ALTER TABLE "wallet" ALTER COLUMN "currency" SET DEFAULT 'USD';
UPDATE "wallet" SET "currency" = 'USD' WHERE "balanceCents" = 0 AND "currency" = 'NZD';
