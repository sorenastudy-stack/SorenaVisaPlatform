-- PR-WEBINAR-2 — slug is no longer unique: a recurring weekly series (same
-- slug) now gets one Webinar row per occurrence, so the same registrant can
-- sign up again for a later week instead of being bounced as a duplicate.
-- The per-occurrence dedupe (webinarId, email) is untouched.

-- DropIndex
DROP INDEX "webinars_slug_key";

-- CreateIndex
CREATE INDEX "webinars_slug_idx" ON "webinars"("slug");

-- AlterTable
ALTER TABLE "webinars" ADD COLUMN "recurrenceDays" INTEGER;
