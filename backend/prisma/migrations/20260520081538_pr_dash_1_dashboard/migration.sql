-- PR-DASH-1 — Client dashboard shell.
--
-- Adds three things:
--   * VisaCaseStatus enum — the 7-step workflow the student sees on
--     the dashboard. Distinct from the CRM-side CaseStage enum on the
--     existing `cases` table; the two coexist by design.
--   * visa_cases table — one row per visa_applications row (UNIQUE
--     constraint on visaApplicationId). Tracks status + who changed
--     it + who's assigned. Cascades from the visa application AND
--     from the client User; the assigned consultant is a nullable
--     FK that does not cascade (a deleted consultant leaves the case
--     un-assigned, not deleted).
--   * assessment_reports table — Friday AI scoring bot writeback
--     target. One row per User (UNIQUE clientId). All payload fields
--     nullable so an empty row can be created at first dashboard
--     load and filled in when the bot reports. summaryNarrative is
--     PII (free-text AI commentary) and stored encrypted via
--     CryptoService.
--
-- Also adds a nullable `eventType` column to audit_logs so future
-- mutation paths can write a structured event type that the dashboard
-- activity feed maps directly to an i18n key. Existing rows are NULL
-- — the dashboard service derives the event type from the existing
-- `action` string for backward compatibility.
--
-- Hand-written, applied via `prisma migrate deploy` — same convention
-- as PR-VISA1..VISA14 to avoid `migrate dev` picking up unrelated
-- drift on working production constraints.

ALTER TABLE "audit_logs"
  ADD COLUMN "eventType" TEXT;

CREATE TYPE "VisaCaseStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED_FOR_REVIEW',
  'REVIEWED',
  'READY_FOR_INZ',
  'INZ_SUBMITTED',
  'APPROVED',
  'DECLINED'
);

CREATE TABLE "visa_cases" (
  "id"                    TEXT NOT NULL,
  "visaApplicationId"     TEXT NOT NULL,
  "clientId"              TEXT NOT NULL,
  "assignedConsultantId"  TEXT,
  "status"                "VisaCaseStatus" NOT NULL DEFAULT 'DRAFT',
  "statusChangedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "statusChangedBy"       TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visa_cases_visaApplicationId_key"
  ON "visa_cases"("visaApplicationId");

CREATE INDEX "visa_cases_clientId_idx" ON "visa_cases"("clientId");
CREATE INDEX "visa_cases_assignedConsultantId_idx"
  ON "visa_cases"("assignedConsultantId");
CREATE INDEX "visa_cases_status_idx" ON "visa_cases"("status");

ALTER TABLE "visa_cases"
  ADD CONSTRAINT "visa_cases_visaApplicationId_fkey"
  FOREIGN KEY ("visaApplicationId")
  REFERENCES "visa_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_cases"
  ADD CONSTRAINT "visa_cases_clientId_fkey"
  FOREIGN KEY ("clientId")
  REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_cases"
  ADD CONSTRAINT "visa_cases_assignedConsultantId_fkey"
  FOREIGN KEY ("assignedConsultantId")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "assessment_reports" (
  "id"                          TEXT NOT NULL,
  "clientId"                    TEXT NOT NULL,
  "score"                       INTEGER,
  "band"                        INTEGER,
  "route"                       TEXT,
  "summaryNarrativeEncrypted"   BYTEA,
  "aiRecommendations"           JSONB,
  "sourceSubmissionId"          TEXT,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_reports_clientId_key"
  ON "assessment_reports"("clientId");

ALTER TABLE "assessment_reports"
  ADD CONSTRAINT "assessment_reports_clientId_fkey"
  FOREIGN KEY ("clientId")
  REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
