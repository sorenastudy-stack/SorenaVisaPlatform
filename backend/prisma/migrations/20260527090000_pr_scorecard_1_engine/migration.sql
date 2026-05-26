-- PR-SCORECARD-1 — Readiness Assessment scoring engine.
--
-- Adds:
--   1. LEAD value to the existing UserRole enum (between SUPPORT and STUDENT
--      — see schema comment for funnel-position rationale)
--   2. Two new enums: ScorecardBand (BAND_1..BAND_6),
--      ScorecardNextAction (NURTURE_ONLY | PAY_GAP_CLOSING_SESSION |
--      BOOK_FREE_15MIN_SESSION | BLOCKED_HARD_STOP)
--   3. scorecard_submissions table with computed-score columns +
--      encrypted answers + 1:0..1 link to leads
--
-- No backfill — pre-PR rows don't exist for the new table.
--
-- Postgres 12+ allows ALTER TYPE ... ADD VALUE inside a transaction
-- as long as the new value isn't *used* in the same transaction.
-- None of our other statements reference LEAD, so the single migration
-- is safe (same pattern as PR-LIA-7's INZ_SUBMITTED add).

-- 1. UserRole.LEAD
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LEAD' BEFORE 'STUDENT';

-- 2. Scorecard enums
CREATE TYPE "ScorecardBand" AS ENUM (
  'BAND_1', 'BAND_2', 'BAND_3', 'BAND_4', 'BAND_5', 'BAND_6'
);

CREATE TYPE "ScorecardNextAction" AS ENUM (
  'NURTURE_ONLY',
  'PAY_GAP_CLOSING_SESSION',
  'BOOK_FREE_15MIN_SESSION',
  'BLOCKED_HARD_STOP'
);

-- 3. scorecard_submissions table
CREATE TABLE "scorecard_submissions" (
  "id"                   TEXT                  NOT NULL,
  "userId"               TEXT                  NOT NULL,
  "answersEncrypted"     BYTEA                 NOT NULL,
  "totalScore"           INTEGER               NOT NULL,
  "category1Score"       INTEGER               NOT NULL,
  "category2Score"       INTEGER               NOT NULL,
  "category3Score"       INTEGER               NOT NULL,
  "category4Score"       INTEGER               NOT NULL,
  "band"                 "ScorecardBand"       NOT NULL,
  "hardStops"            JSONB                 NOT NULL,
  "riskFlags"            TEXT[]                NOT NULL DEFAULT ARRAY[]::TEXT[],
  "executionEligible"    BOOLEAN               NOT NULL,
  "gateResults"          JSONB                 NOT NULL,
  "nextAction"           "ScorecardNextAction" NOT NULL,
  "nextActionTextEn"     TEXT                  NOT NULL,
  "nextActionTextFa"     TEXT                  NOT NULL,
  "submittedAt"          TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leadId"               TEXT,
  "consultationBookedAt" TIMESTAMP(3),
  "ipAddress"            VARCHAR(64),
  "userAgent"            TEXT,

  CONSTRAINT "scorecard_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scorecard_submissions_leadId_key"
  ON "scorecard_submissions"("leadId");
CREATE INDEX "scorecard_submissions_userId_submittedAt_idx"
  ON "scorecard_submissions"("userId", "submittedAt");
CREATE INDEX "scorecard_submissions_band_submittedAt_idx"
  ON "scorecard_submissions"("band", "submittedAt");
CREATE INDEX "scorecard_submissions_executionEligible_idx"
  ON "scorecard_submissions"("executionEligible");

ALTER TABLE "scorecard_submissions"
  ADD CONSTRAINT "scorecard_submissions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scorecard_submissions"
  ADD CONSTRAINT "scorecard_submissions_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
