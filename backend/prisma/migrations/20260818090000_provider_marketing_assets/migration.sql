-- CreateTable
CREATE TABLE "provider_marketing_assets" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "label" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_marketing_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_marketing_assets_r2Key_key" ON "provider_marketing_assets"("r2Key");

-- CreateIndex
CREATE INDEX "provider_marketing_assets_providerId_idx" ON "provider_marketing_assets"("providerId");

-- CreateIndex
CREATE INDEX "provider_marketing_assets_reviewStatus_idx" ON "provider_marketing_assets"("reviewStatus");

-- AddForeignKey
ALTER TABLE "provider_marketing_assets" ADD CONSTRAINT "provider_marketing_assets_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_marketing_assets" ADD CONSTRAINT "provider_marketing_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

