-- PR-OPTION-C step 1 — schema prep for passwordless invite-only auth
-- (Google OAuth + magic link). No code paths are wired yet; this is a
-- pure schema landing so the wiring PR has columns to populate.
--
-- 1. users.passwordHash becomes nullable — Google / magic-link users
--    won't have one. Existing rows keep their bcrypt hash; the
--    login service must guard against null before calling
--    bcrypt.compare in a follow-up PR.
-- 2. users.googleId — Google "sub" claim from OAuth ID-token, unique.
--    Null until the user links Google.
-- 3. magic_link_tokens — server-side hash of one-time links the
--    backend mails out via Resend. consumedAt enforces one-time use;
--    expiresAt enforces TTL. Cascades on user delete.

-- 1. ─── users.passwordHash → nullable ────────────────────────────────
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- 2. ─── users.googleId (unique, nullable) ────────────────────────────
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- 3. ─── magic_link_tokens table ──────────────────────────────────────
CREATE TABLE "magic_link_tokens" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "tokenHash"   TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "consumedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "magic_link_tokens_userId_idx" ON "magic_link_tokens"("userId");

ALTER TABLE "magic_link_tokens"
  ADD CONSTRAINT "magic_link_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
