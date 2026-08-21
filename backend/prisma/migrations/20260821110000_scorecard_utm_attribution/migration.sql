-- PR-SCORECARD-ATTR-1 — raw marketing-campaign UTM attribution + landing
-- page, captured on the Scorecard independently of the existing
-- sv_attribution / trackingLinkId / attributedAgentId short-link mechanism
-- (which is UNCHANGED by this migration — no columns on "leads" or
-- "tracking_links" are touched here).
--
-- All four columns are purely additive and nullable: existing rows
-- (draft or submitted) simply read back NULL, exactly like every other
-- nullable column added to this table historically. No backfill needed,
-- no default value, no NOT NULL constraint — safe on a live table of any
-- size and instantly reversible (see rollback notes at the bottom).
--
-- Note: "leads"."utmSource" / "utmMedium" / "utmCampaign" already exist in
-- the database (added by an earlier migration, left unpopulated). This
-- migration does not touch them — application code (scorecard.service.ts)
-- starts writing to them as of this PR, but no schema change is needed
-- there.

ALTER TABLE "scorecard_submissions" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "scorecard_submissions" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "scorecard_submissions" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "scorecard_submissions" ADD COLUMN "landingPage" TEXT;

-- ─── ROLLBACK (manual — Prisma has no automatic "down" migration) ─────────
-- Safe at any time; these columns are read-only additive data, nothing
-- else in the schema references them (no FKs, no unique constraints):
--
--   ALTER TABLE "scorecard_submissions" DROP COLUMN "utmSource";
--   ALTER TABLE "scorecard_submissions" DROP COLUMN "utmMedium";
--   ALTER TABLE "scorecard_submissions" DROP COLUMN "utmCampaign";
--   ALTER TABLE "scorecard_submissions" DROP COLUMN "landingPage";
--
-- Then mark this migration as rolled back in Prisma's history:
--   npx prisma migrate resolve --rolled-back 20260821110000_scorecard_utm_attribution
