-- DropForeignKey
ALTER TABLE "priority_slots" DROP CONSTRAINT "priority_slots_recommendationListId_fkey";

-- DropForeignKey
ALTER TABLE "priority_slots" DROP CONSTRAINT "priority_slots_programmeId_fkey";

-- AlterTable
ALTER TABLE "recommendation_lists" DROP COLUMN "confirmedAt";

-- DropTable
DROP TABLE "priority_slots";

