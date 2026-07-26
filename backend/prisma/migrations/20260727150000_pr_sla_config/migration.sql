-- PR-SLA — Owner-manageable, institution-type-varying stage deadlines.
--   • cases: stageEnteredAt (when the case entered its current stage) +
--     stageDeadlineOverride (optional manual per-case deadline). Existing rows
--     backfill stageEnteredAt = updatedAt (best available proxy).
--   • sla_configs: one editable row per (institutionType, stage). Seeded with the
--     launch defaults — ADMISSION 25 working days; VISA 30 / INZ_SUBMITTED 2
--     calendar days — identical across University/Polytechnic/College so they can
--     be tuned independently later.

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "stageDeadlineOverride" TIMESTAMP(3),
ADD COLUMN     "stageEnteredAt" TIMESTAMP(3);

-- Backfill existing cases so overdue reflects real last-activity, not creation.
UPDATE "cases" SET "stageEnteredAt" = "updatedAt" WHERE "stageEnteredAt" IS NULL;

-- CreateTable
CREATE TABLE "sla_configs" (
    "id" TEXT NOT NULL,
    "institutionType" "ProviderType" NOT NULL,
    "stage" "CaseStage" NOT NULL,
    "slaDays" INTEGER NOT NULL,
    "isWorkingDays" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "sla_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sla_configs_institutionType_stage_key" ON "sla_configs"("institutionType", "stage");

-- Seed the launch defaults (3 institution types × 3 non-terminal stages).
INSERT INTO "sla_configs" ("id", "institutionType", "stage", "slaDays", "isWorkingDays", "updatedAt") VALUES
  ('sla_uni_adm',  'UNIVERSITY',  'ADMISSION',     25, true,  CURRENT_TIMESTAMP),
  ('sla_uni_visa', 'UNIVERSITY',  'VISA',          30, false, CURRENT_TIMESTAMP),
  ('sla_uni_inz',  'UNIVERSITY',  'INZ_SUBMITTED',  2, false, CURRENT_TIMESTAMP),
  ('sla_pol_adm',  'POLYTECHNIC', 'ADMISSION',     25, true,  CURRENT_TIMESTAMP),
  ('sla_pol_visa', 'POLYTECHNIC', 'VISA',          30, false, CURRENT_TIMESTAMP),
  ('sla_pol_inz',  'POLYTECHNIC', 'INZ_SUBMITTED',  2, false, CURRENT_TIMESTAMP),
  ('sla_col_adm',  'COLLEGE',     'ADMISSION',     25, true,  CURRENT_TIMESTAMP),
  ('sla_col_visa', 'COLLEGE',     'VISA',          30, false, CURRENT_TIMESTAMP),
  ('sla_col_inz',  'COLLEGE',     'INZ_SUBMITTED',  2, false, CURRENT_TIMESTAMP);
