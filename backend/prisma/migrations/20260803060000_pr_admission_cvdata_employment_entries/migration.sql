-- CreateTable
CREATE TABLE "admission_employment_entries" (
    "id" TEXT NOT NULL,
    "admissionApplicationId" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "countryOfWork" TEXT,
    "organisationField" TEXT,
    "dutiesText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_employment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admission_employment_entries_admissionApplicationId_idx" ON "admission_employment_entries"("admissionApplicationId");

-- AddForeignKey
ALTER TABLE "admission_employment_entries" ADD CONSTRAINT "admission_employment_entries_admissionApplicationId_fkey" FOREIGN KEY ("admissionApplicationId") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

