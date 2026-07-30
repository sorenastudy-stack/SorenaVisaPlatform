-- CreateEnum
CREATE TYPE "RecommendationListStatus" AS ENUM ('GENERATED', 'VIEWED', 'CONFIRMED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RecommendationCriteriaSource" AS ENUM ('SCORECARD', 'ASSESSMENT');

-- CreateTable
CREATE TABLE "recommendation_lists" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" "RecommendationListStatus" NOT NULL DEFAULT 'GENERATED',
    "criteriaSource" "RecommendationCriteriaSource" NOT NULL,
    "criteriaJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_items" (
    "id" TEXT NOT NULL,
    "recommendationListId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "fitScore" DOUBLE PRECISION NOT NULL,
    "institutionType" "InstitutionType",
    "whyJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendation_lists_caseId_idx" ON "recommendation_lists"("caseId");

-- CreateIndex
CREATE INDEX "recommendation_lists_caseId_status_idx" ON "recommendation_lists"("caseId", "status");

-- CreateIndex
CREATE INDEX "recommendation_items_recommendationListId_idx" ON "recommendation_items"("recommendationListId");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_items_recommendationListId_programmeId_key" ON "recommendation_items"("recommendationListId", "programmeId");

-- AddForeignKey
ALTER TABLE "recommendation_lists" ADD CONSTRAINT "recommendation_lists_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_recommendationListId_fkey" FOREIGN KEY ("recommendationListId") REFERENCES "recommendation_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

