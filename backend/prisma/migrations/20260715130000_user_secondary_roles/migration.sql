-- User.secondaryRoles — secondary roles that WIDEN access only.
--
-- Additive + idempotent: one new column on "users", ADD COLUMN IF NOT EXISTS,
-- NOT NULL with a constant empty-array default so PG 11+ applies it as a fast
-- metadata-only change (no table rewrite) and every existing row gets '{}'.
-- The "UserRole" enum already exists (it's the primary role type), so no
-- CREATE TYPE is needed. No existing column is altered — safe to roll back
-- (drop the column) and safe to re-run.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "secondaryRoles" "UserRole"[] NOT NULL DEFAULT ARRAY[]::"UserRole"[];
