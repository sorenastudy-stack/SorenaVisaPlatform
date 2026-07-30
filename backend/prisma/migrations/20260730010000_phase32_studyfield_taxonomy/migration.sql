-- AlterTable
ALTER TABLE "education_providers" ADD COLUMN     "aboutUrl" TEXT,
ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "rankingScore" DOUBLE PRECISION,
ADD COLUMN     "rankingSource" TEXT,
ADD COLUMN     "rankingTier" TEXT;

-- AlterTable
ALTER TABLE "education_programmes" ADD COLUMN     "careerOutcomes" TEXT[],
ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "descriptionFa" TEXT,
ADD COLUMN     "highlights" TEXT[];

-- CreateTable
CREATE TABLE "study_field_categories" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "alwaysSelectable" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_field_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_fields" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "backgroundWeight" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "explainerVideoId" TEXT,
    "evergreenVideoIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_field_relations" (
    "id" TEXT NOT NULL,
    "sourceFieldId" TEXT NOT NULL,
    "targetFieldId" TEXT NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "study_field_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_study_fields" (
    "programmeId" TEXT NOT NULL,
    "studyFieldId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "programme_study_fields_pkey" PRIMARY KEY ("programmeId","studyFieldId")
);

-- CreateIndex
CREATE UNIQUE INDEX "study_field_categories_key_key" ON "study_field_categories"("key");

-- CreateIndex
CREATE UNIQUE INDEX "study_fields_key_key" ON "study_fields"("key");

-- CreateIndex
CREATE INDEX "study_fields_categoryId_idx" ON "study_fields"("categoryId");

-- CreateIndex
CREATE INDEX "study_field_relations_sourceFieldId_idx" ON "study_field_relations"("sourceFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "study_field_relations_sourceFieldId_targetFieldId_key" ON "study_field_relations"("sourceFieldId", "targetFieldId");

-- CreateIndex
CREATE INDEX "programme_study_fields_studyFieldId_idx" ON "programme_study_fields"("studyFieldId");

-- AddForeignKey
ALTER TABLE "study_fields" ADD CONSTRAINT "study_fields_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "study_field_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_field_relations" ADD CONSTRAINT "study_field_relations_sourceFieldId_fkey" FOREIGN KEY ("sourceFieldId") REFERENCES "study_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_field_relations" ADD CONSTRAINT "study_field_relations_targetFieldId_fkey" FOREIGN KEY ("targetFieldId") REFERENCES "study_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_study_fields" ADD CONSTRAINT "programme_study_fields_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_study_fields" ADD CONSTRAINT "programme_study_fields_studyFieldId_fkey" FOREIGN KEY ("studyFieldId") REFERENCES "study_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

