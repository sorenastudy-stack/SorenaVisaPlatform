-- AlterTable
ALTER TABLE "recommendation_lists" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "priority_slots" (
    "id" TEXT NOT NULL,
    "recommendationListId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "programmeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "priority_slots_recommendationListId_idx" ON "priority_slots"("recommendationListId");

-- CreateIndex
CREATE UNIQUE INDEX "priority_slots_recommendationListId_position_key" ON "priority_slots"("recommendationListId", "position");

-- AddForeignKey
ALTER TABLE "priority_slots" ADD CONSTRAINT "priority_slots_recommendationListId_fkey" FOREIGN KEY ("recommendationListId") REFERENCES "recommendation_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_slots" ADD CONSTRAINT "priority_slots_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

