-- Client onboarding — password_setup_tokens table.
--
-- Cloned from magic_link_tokens. Holds first-time "create your password"
-- tokens issued ONLY to brand-new passwordless LEADs from the public
-- scorecard. Additive + idempotent (CREATE TABLE / INDEX IF NOT EXISTS +
-- guarded FK) so it is safe to apply deliberately to prod and safe to re-run
-- — consistent with reconcile_prod_drift.sql. No existing table is touched.

-- CreateTable
CREATE TABLE IF NOT EXISTS "password_setup_tokens" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "email"      TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "password_setup_tokens_tokenHash_key" ON "password_setup_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "password_setup_tokens_tokenHash_idx" ON "password_setup_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "password_setup_tokens_userId_idx" ON "password_setup_tokens"("userId");

-- AddForeignKey (guarded — safe to re-run)
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_setup_tokens_userId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE$sql$;
  END IF;
END $do$;
