-- PR-BOOKING-ADMIN-A — adviser booking configuration on User.
--
-- All additive, idempotent. No new tables, no enum changes. Applied to
-- LOCAL only via `prisma db execute` + `migrate resolve --applied`
-- (the repo's migration history can't shadow-replay — see
-- docs/known_issues.md). Adding NOT NULL columns WITH a default is safe
-- for existing rows: they backfill to the default.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "languages"            TEXT[]               NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "timezone"             TEXT                 NOT NULL DEFAULT 'Pacific/Auckland',
  ADD COLUMN IF NOT EXISTS "bookableSessionTypes" "ConsultationType"[] NOT NULL DEFAULT ARRAY[]::"ConsultationType"[],
  ADD COLUMN IF NOT EXISTS "bookingActive"        BOOLEAN              NOT NULL DEFAULT true;
