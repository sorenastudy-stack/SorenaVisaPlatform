-- Lead.targetCountry — the destination country the visitor picked on /start
-- (NEW_ZEALAND | MALAYSIA). One assessment serves both.
--
-- Additive + idempotent, same discipline as reconcile_prod_drift.sql /
-- password_setup_tokens:
--   * a guarded CREATE TYPE (no ALTER TYPE ADD VALUE — the enum is created with
--     both values at once, so none of the transaction/autocommit care that
--     value-adds need applies here),
--   * ADD COLUMN IF NOT EXISTS, NULLABLE with no default — existing leads keep
--     NULL and are unaffected.
-- Safe to apply deliberately to prod and safe to re-run.

-- CreateEnum (guarded — CREATE TYPE has no IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE "TargetCountry" AS ENUM ('NEW_ZEALAND', 'MALAYSIA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddColumn
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "targetCountry" "TargetCountry";
