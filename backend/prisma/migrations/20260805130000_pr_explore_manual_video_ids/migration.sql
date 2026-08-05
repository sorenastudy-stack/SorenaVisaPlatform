-- PR-EXPLORE — staff/Owner manual override for the programme detail page's
-- "Related videos" block. When non-empty these replace the ContentMatchingAgent's
-- picks entirely (never merged).
--
-- Only manualVideoIds here: coverImageUrl ships in the preceding migration
-- (20260805120000_pr_explore_programme_cover_image) and is already applied. The
-- generated diff re-proposed it because HEAD does not yet contain that schema edit.
--
-- Additive: new column with a default, no existing rows rewritten.
ALTER TABLE "education_programmes" ADD COLUMN "manualVideoIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
