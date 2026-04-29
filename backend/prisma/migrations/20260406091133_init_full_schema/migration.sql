-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SALES', 'OPERATIONS', 'LIA', 'SUPPORT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'INTAKE_STARTED', 'INTAKE_COMPLETED', 'SCORING_DONE', 'QUALIFIED', 'NURTURE', 'EXECUTING', 'CLOSED_WON', 'CLOSED_LOST', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "ScoreBand" AS ENUM ('LOW', 'MID', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RecommendedRoute" AS ENUM ('CONTENT_NURTURE', 'WEBINAR', 'ROADMAP', 'ADMISSION_CONSULTATION', 'SPECIALIST_CONSULTATION', 'LIA_CONSULTATION', 'EXECUTION_QUEUE');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'BASIC', 'PRO', 'PREMIUM', 'CONTINUITY');

-- CreateEnum
CREATE TYPE "SubscriptionStage" AS ENUM ('STAGE_1', 'STAGE_2', 'STAGE_3');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ConsultationType" AS ENUM ('ADMISSION', 'LIA');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('PENDING', 'BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CaseStage" AS ENUM ('ADMISSION', 'VISA', 'COMPLETED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PREPARATION', 'SUBMITTED', 'OFFER_RECEIVED', 'OFFER_ACCEPTED', 'VISA_SUBMITTED', 'VISA_APPROVED', 'VISA_DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ESTIMATED', 'CONFIRMED', 'INVOICED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('UNIVERSITY', 'POLYTECHNIC', 'COLLEGE', 'SCHOOL');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');

-- CreateEnum
CREATE TYPE "QualificationLevel" AS ENUM ('DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR', 'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD');

-- CreateEnum
CREATE TYPE "NZQFLevel" AS ENUM ('LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('MISSING', 'UPLOADED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('AI', 'OPS', 'LEGAL', 'SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "EventProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('PRIVACY', 'MARKETING');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppConversationStatus" AS ENUM ('NEW', 'ASSIGNED', 'WAITING', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SALES',
    "canEditGlobalData" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NZ',
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_events" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB,
    "page" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquisition_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_captures" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "destination" TEXT NOT NULL DEFAULT 'NZ',
    "studyLevel" TEXT,
    "preferredLanguage" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contactId" TEXT,

    CONSTRAINT "lead_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_source_attributions" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_source_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_handoffs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "nationality" TEXT,
    "countryOfResidence" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "lifecycleStage" TEXT,
    "ownerId" TEXT,
    "partnerId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sourceChannel" TEXT,
    "campaignId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "firstTouchSource" TEXT,
    "lastTouchSource" TEXT,
    "leadStatus" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "disqualificationReason" TEXT,
    "isNurtureCandidate" BOOLEAN NOT NULL DEFAULT false,
    "readinessScore" INTEGER,
    "academicScore" INTEGER,
    "financialScore" INTEGER,
    "englishScore" INTEGER,
    "intentScore" INTEGER,
    "engagementScore" INTEGER,
    "scoreBand" "ScoreBand",
    "riskLevel" "RiskLevel",
    "riskFlags" TEXT[],
    "hardStopFlag" BOOLEAN NOT NULL DEFAULT false,
    "hardStopReason" TEXT,
    "liaEscalationRequired" BOOLEAN NOT NULL DEFAULT false,
    "executionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "recommendedRoute" "RecommendedRoute",
    "monetisationModel" TEXT,
    "countryConfigId" TEXT,
    "aiSummary" TEXT,
    "managerNotes" TEXT,
    "ownerId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_notes_logs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_notes_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_forms" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "highestQualification" TEXT,
    "fieldOfStudy" TEXT,
    "gpa" DOUBLE PRECISION,
    "englishTestType" TEXT,
    "englishOverallScore" DOUBLE PRECISION,
    "englishComponentScores" JSONB,
    "financialLevel" TEXT,
    "estimatedBudgetNZD" DOUBLE PRECISION,
    "visaHistory" TEXT,
    "visaRejectionCount" INTEGER NOT NULL DEFAULT 0,
    "visaRejectionReason" TEXT,
    "workExperienceYears" INTEGER,
    "studyIntent" TEXT,
    "preferredStartDate" TEXT,
    "preferredCountry" TEXT NOT NULL DEFAULT 'NZ',
    "preferredLevel" TEXT,
    "preferredField" TEXT,
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "stage" "SubscriptionStage" NOT NULL DEFAULT 'STAGE_1',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountPaidNZD" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "freeResubmissionEligible" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "ConsultationType" NOT NULL,
    "assignedToId" TEXT,
    "amountNZD" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentId" TEXT,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'PENDING',
    "outcomeNotes" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "stage" "CaseStage" NOT NULL DEFAULT 'ADMISSION',
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerId" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "intakeId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PREPARATION',
    "executionMode" TEXT,
    "liaRequired" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "offerReceivedAt" TIMESTAMP(3),
    "offerAcceptedAt" TIMESTAMP(3),
    "visaSubmittedAt" TIMESTAMP(3),
    "visaDecisionAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_documents" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'MISSING',
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT,
    "docusignEnvelopeId" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "signedFileUrl" TEXT,
    "auditTrailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "commissionYear" INTEGER NOT NULL DEFAULT 1,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commissionValue" DOUBLE PRECISION NOT NULL,
    "estimatedAmountNZD" DOUBLE PRECISION,
    "actualAmountNZD" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "status" "CommissionStatus" NOT NULL DEFAULT 'ESTIMATED',
    "confirmedAt" TIMESTAMP(3),
    "invoiceSentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "renewalReminderDate" TIMESTAMP(3),
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NZ',
    "city" TEXT,
    "websiteUrl" TEXT,
    "status" "ProviderStatus" NOT NULL DEFAULT 'PENDING',
    "agreementUrl" TEXT,
    "agreementStartDate" TIMESTAMP(3),
    "agreementEndDate" TIMESTAMP(3),
    "agreementRenewalDate" TIMESTAMP(3),
    "commissionY1Type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commissionY1Value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionY2Type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commissionY2Value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volumeTarget" DOUBLE PRECISION,
    "bonusType" "CommissionType",
    "bonusValue" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_faculties" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_faculties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_programmes" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "facultyId" TEXT,
    "name" TEXT NOT NULL,
    "level" "QualificationLevel" NOT NULL,
    "nzqfLevel" "NZQFLevel" NOT NULL,
    "durationMonths" INTEGER,
    "tuitionFeeNZD" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "intakeMonths" INTEGER[],
    "aiPopulated" BOOLEAN NOT NULL DEFAULT false,
    "aiLastRunAt" TIMESTAMP(3),
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_requirements" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "minQualificationLevel" TEXT,
    "minGpa" DOUBLE PRECISION,
    "englishTestType" TEXT,
    "englishOverallMin" DOUBLE PRECISION,
    "englishComponentMins" JSONB,
    "workExperienceRequired" BOOLEAN NOT NULL DEFAULT false,
    "portfolioRequired" BOOLEAN NOT NULL DEFAULT false,
    "interviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "documentsRequired" TEXT[],
    "additionalNotes" TEXT,
    "aiPopulated" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programme_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "leadId" TEXT,
    "triggerSource" "EventSource" NOT NULL DEFAULT 'SYSTEM',
    "actorType" TEXT,
    "actorId" TEXT,
    "payloadJson" JSONB,
    "processingStatus" "EventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "status" "WhatsAppConversationStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "content" TEXT,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "status" TEXT,
    "waMessageId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "visitors_fingerprint_key" ON "visitors"("fingerprint");

-- CreateIndex
CREATE INDEX "acquisition_events_visitorId_idx" ON "acquisition_events"("visitorId");

-- CreateIndex
CREATE INDEX "acquisition_events_eventType_idx" ON "acquisition_events"("eventType");

-- CreateIndex
CREATE INDEX "lead_captures_email_idx" ON "lead_captures"("email");

-- CreateIndex
CREATE INDEX "lead_captures_phone_idx" ON "lead_captures"("phone");

-- CreateIndex
CREATE INDEX "lead_captures_status_idx" ON "lead_captures"("status");

-- CreateIndex
CREATE UNIQUE INDEX "lead_source_attributions_leadId_key" ON "lead_source_attributions"("leadId");

-- CreateIndex
CREATE INDEX "consent_records_leadId_idx" ON "consent_records"("leadId");

-- CreateIndex
CREATE INDEX "lead_handoffs_leadId_idx" ON "lead_handoffs"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verifications_leadId_key" ON "email_verifications"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verifications_tokenHash_key" ON "email_verifications"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_email_key" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "leads_contactId_idx" ON "leads"("contactId");

-- CreateIndex
CREATE INDEX "leads_leadStatus_idx" ON "leads"("leadStatus");

-- CreateIndex
CREATE INDEX "leads_scoreBand_idx" ON "leads"("scoreBand");

-- CreateIndex
CREATE INDEX "leads_ownerId_idx" ON "leads"("ownerId");

-- CreateIndex
CREATE INDEX "manager_notes_logs_leadId_idx" ON "manager_notes_logs"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "intake_forms_leadId_key" ON "intake_forms"("leadId");

-- CreateIndex
CREATE INDEX "subscriptions_leadId_idx" ON "subscriptions"("leadId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "consultations_leadId_idx" ON "consultations"("leadId");

-- CreateIndex
CREATE INDEX "consultations_type_idx" ON "consultations"("type");

-- CreateIndex
CREATE INDEX "cases_leadId_idx" ON "cases"("leadId");

-- CreateIndex
CREATE INDEX "cases_stage_idx" ON "cases"("stage");

-- CreateIndex
CREATE INDEX "applications_caseId_idx" ON "applications"("caseId");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "application_documents_applicationId_idx" ON "application_documents"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_caseId_key" ON "contracts"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_applicationId_key" ON "commissions"("applicationId");

-- CreateIndex
CREATE INDEX "commissions_status_idx" ON "commissions"("status");

-- CreateIndex
CREATE INDEX "commissions_providerId_idx" ON "commissions"("providerId");

-- CreateIndex
CREATE INDEX "education_faculties_providerId_idx" ON "education_faculties"("providerId");

-- CreateIndex
CREATE INDEX "education_programmes_providerId_idx" ON "education_programmes"("providerId");

-- CreateIndex
CREATE INDEX "education_programmes_level_idx" ON "education_programmes"("level");

-- CreateIndex
CREATE INDEX "education_programmes_reviewStatus_idx" ON "education_programmes"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "programme_requirements_programmeId_key" ON "programme_requirements"("programmeId");

-- CreateIndex
CREATE INDEX "crm_events_eventType_idx" ON "crm_events"("eventType");

-- CreateIndex
CREATE INDEX "crm_events_leadId_idx" ON "crm_events"("leadId");

-- CreateIndex
CREATE INDEX "crm_events_occurredAt_idx" ON "crm_events"("occurredAt");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_phoneNumber_idx" ON "whatsapp_conversations"("phoneNumber");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_status_idx" ON "whatsapp_conversations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_waMessageId_key" ON "whatsapp_messages"("waMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversationId_idx" ON "whatsapp_messages"("conversationId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_idx" ON "audit_logs"("entityType");

-- CreateIndex
CREATE INDEX "knowledge_chunks_sourceType_idx" ON "knowledge_chunks"("sourceType");

-- AddForeignKey
ALTER TABLE "acquisition_events" ADD CONSTRAINT "acquisition_events_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_captures" ADD CONSTRAINT "lead_captures_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_captures" ADD CONSTRAINT "lead_captures_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_source_attributions" ADD CONSTRAINT "lead_source_attributions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead_captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead_captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_handoffs" ADD CONSTRAINT "lead_handoffs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead_captures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead_captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_notes_logs" ADD CONSTRAINT "manager_notes_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_notes_logs" ADD CONSTRAINT "manager_notes_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education_faculties" ADD CONSTRAINT "education_faculties_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education_programmes" ADD CONSTRAINT "education_programmes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "education_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education_programmes" ADD CONSTRAINT "education_programmes_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "education_faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_requirements" ADD CONSTRAINT "programme_requirements_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "education_programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
