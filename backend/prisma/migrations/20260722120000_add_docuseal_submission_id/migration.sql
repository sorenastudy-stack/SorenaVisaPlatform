-- PR-DOCUSEAL — external submission id for the DocuSeal contract provider.
-- Additive + nullable + no backfill → safe on a live table, instantly reversible
-- (DROP COLUMN). Distinct from docusignEnvelopeId so the DocuSign flow stays
-- intact for rollback. Populated at DocuSeal send; the webhook keys on it.
ALTER TABLE "contracts" ADD COLUMN "docusealSubmissionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "contracts_docusealSubmissionId_key" ON "contracts"("docusealSubmissionId");
