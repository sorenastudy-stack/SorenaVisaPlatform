-- PR-SCORECARD-ATTR-1 — raw marketing-campaign UTM attribution + landing
-- page, captured on the Scorecard independently of the existing
-- sv_attribution / trackingLinkId / attributedAgentId short-link mechanism
-- (which is UNCHANGED by this migration — no columns on "leads" or
-- "tracking_links" are touched here).
--
-- All additive. No DROP, no rename, no retype, no NOT NULL on existing
-- columns. Authored by hand (not `migrate dev`) per this repo's documented
-- migration-history drift (docs/known_issues.md, "Prisma migration history
-- is out of sync with the database") — `migrate dev` and `db push` are
-- both unsafe here and must not be used. IF [NOT] EXISTS guards keep this
-- idempotent, matching the pattern established by
-- 20260629000000_pr_booking_1_foundation and every migration since.
--
-- Apply with `prisma db execute --file <this file> --schema prisma/schema.prisma`
-- (never `migrate dev` / `db push`), then register it with
-- `prisma migrate resolve --applied 20260821110000_scorecard_utm_attribution`.
-- See docs/IMPLEMENTATION_HANDOFF_20260821.md §6 for the full safe sequence
-- (backup → validate on an isolated DB → apply → verify → resolve → deploy
-- → smoke test).
--
-- All four columns are nullable, no default, no backfill: existing rows
-- (draft or submitted) simply read back NULL, exactly like every other
-- nullable column added to this table historically. Safe on a live table
-- of any size and instantly reversible (see rollback notes at the bottom).
--
-- Note: "leads"."utmSource" / "utmMedium" / "utmCampaign" already exist in
-- the database (added by an earlier migration, left unpopulated). This
-- migration does not touch them — application code (scorecard.service.ts)
-- starts writing to them as of this PR, but no schema change is needed
-- there.

ALTER TABLE "scorecard_submissions"
  ADD COLUMN IF NOT EXISTS "utmSource"   TEXT,
  ADD COLUMN IF NOT EXISTS "utmMedium"   TEXT,
  ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT,
  ADD COLUMN IF NOT EXISTS "landingPage" TEXT;

-- ─── ROLLBACK (manual — Prisma has no automatic "down" migration) ─────────
-- Safe at any time; these columns are read-only additive data, nothing
-- else in the schema references them (no FKs, no unique constraints).
-- Apply the same way as the forward migration — `prisma db execute --file`,
-- never `migrate dev`/`db push` — after taking a fresh backup:
--
--   ALTER TABLE "scorecard_submissions" DROP COLUMN IF EXISTS "utmSource";
--   ALTER TABLE "scorecard_submissions" DROP COLUMN IF EXISTS "utmMedium";
--   ALTER TABLE "scorecard_submissions" DROP COLUMN IF EXISTS "utmCampaign";
--   ALTER TABLE "scorecard_submissions" DROP COLUMN IF EXISTS "landingPage";
--
-- Then mark this migration as rolled back in Prisma's history:
--   npx prisma migrate resolve --rolled-back 20260821110000_scorecard_utm_attribution
