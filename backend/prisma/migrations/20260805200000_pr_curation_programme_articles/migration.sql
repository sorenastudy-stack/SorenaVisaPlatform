-- PR-IMPORT — programme articles (title + URL reading list) and the institution's own
-- Subject Area label carried verbatim from its source workbook.
--
-- Purely additive: one new table, one nullable column.
--
-- NOTE: an earlier draft of this migration also created a shared 33-bucket
-- `subject_areas` / `provider_subject_areas` taxonomy. That approach was withdrawn
-- before it ever reached production — programme subject areas come from each
-- institution's own source data, not a cross-institution mapping.

-- CreateTable
CREATE TABLE "programme_articles" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "programme_articles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "programme_articles_programmeId_idx" ON "programme_articles"("programmeId");

-- AlterTable
ALTER TABLE "education_programmes" ADD COLUMN "subjectAreaRaw" TEXT;

-- AddForeignKey
ALTER TABLE "programme_articles" ADD CONSTRAINT "programme_articles_programmeId_fkey"
    FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
