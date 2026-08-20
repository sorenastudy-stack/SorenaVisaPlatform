-- CreateEnum
CREATE TYPE "WebinarStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "webinars" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "speaker" TEXT,
    "topic" TEXT,
    "joinUrl" TEXT,
    "status" "WebinarStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webinars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_registrations" (
    "id" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "countryOfResidence" TEXT,
    "intendedStudyLevel" TEXT,
    "intake" TEXT,
    "operationalConsent" BOOLEAN NOT NULL DEFAULT true,
    "marketingConsent" BOOLEAN,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "attendedDurationMin" INTEGER,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "landingPage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webinar_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webinars_slug_key" ON "webinars"("slug");

-- CreateIndex
CREATE INDEX "webinars_startsAt_idx" ON "webinars"("startsAt");

-- CreateIndex
CREATE INDEX "webinar_registrations_leadId_idx" ON "webinar_registrations"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_registrations_webinarId_email_key" ON "webinar_registrations"("webinarId", "email");

-- AddForeignKey
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "webinars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
