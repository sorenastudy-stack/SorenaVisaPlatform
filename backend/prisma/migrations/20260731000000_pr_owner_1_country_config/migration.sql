-- CreateEnum
CREATE TYPE "AIGuidanceLevel" AS ENUM ('STRICT', 'MODERATE', 'LOW');

-- CreateEnum
CREATE TYPE "AIAgentType" AS ENUM ('USER_GUIDANCE', 'COUNTRY_COMPARE', 'QUALIFICATION_SUPPORT', 'RECOMMENDATION_EXPLAIN', 'CASE_ASSISTANT', 'SOP_GENERATION', 'CV_GENERATION', 'AI_COMPANION', 'AUTOMATION_TRIGGER');

-- CreateEnum
CREATE TYPE "PromptVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'DEPLOYED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PromptType" AS ENUM ('SYSTEM', 'COUNTRY', 'DOMAIN', 'TASK', 'ESCALATION');

-- CreateTable
CREATE TABLE "country_execution_configs" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "slotCount" INTEGER NOT NULL DEFAULT 5,
    "slotRules" JSONB NOT NULL,
    "institutionTypeWeighting" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_execution_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_ai_configs" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "guidanceLevel" "AIGuidanceLevel" NOT NULL DEFAULT 'MODERATE',
    "sopGateEnforcement" BOOLEAN NOT NULL DEFAULT true,
    "activePromptVersionId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_ai_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_configs" (
    "id" TEXT NOT NULL,
    "countryAIConfigId" TEXT NOT NULL,
    "agentType" "AIAgentType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxOptionsShown" INTEGER,
    "promptVersionId" TEXT,
    "settingsJson" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "promptType" "PromptType" NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PromptVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "deployedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_execution_configs_countryCode_key" ON "country_execution_configs"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "country_ai_configs_countryCode_key" ON "country_ai_configs"("countryCode");

-- CreateIndex
CREATE INDEX "ai_agent_configs_countryAIConfigId_idx" ON "ai_agent_configs"("countryAIConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_configs_countryAIConfigId_agentType_key" ON "ai_agent_configs"("countryAIConfigId", "agentType");

-- CreateIndex
CREATE INDEX "prompt_versions_promptType_status_idx" ON "prompt_versions"("promptType", "status");

-- AddForeignKey
ALTER TABLE "country_ai_configs" ADD CONSTRAINT "country_ai_configs_activePromptVersionId_fkey" FOREIGN KEY ("activePromptVersionId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_countryAIConfigId_fkey" FOREIGN KEY ("countryAIConfigId") REFERENCES "country_ai_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

