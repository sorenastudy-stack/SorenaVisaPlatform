-- PR-SCORECARD-2 polish (post-e57a769) — structured next-action content.
--
-- The previous shape stored next-action copy as flat English/Persian
-- strings (nextActionTextEn / nextActionTextFa). On hard-stop cases
-- these read as cramped run-on paragraphs. This migration adds a
-- nullable JSON column `nextActionContent` carrying:
--   { heading: string, bullets: string[], leadIn?: string }
-- which the results page renders as a proper bulleted list.
--
-- Nullable + no backfill: legacy rows simply have NULL here and the
-- frontend falls back to splitting nextActionTextEn at the heading.
-- New submissions populate this column from the engine's routing
-- output (see backend/src/scorecard/scoring/routing.ts).

ALTER TABLE "scorecard_submissions"
  ADD COLUMN "nextActionContent" JSONB;
