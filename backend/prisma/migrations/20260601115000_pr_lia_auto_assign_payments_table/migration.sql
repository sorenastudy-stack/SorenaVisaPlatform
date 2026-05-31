-- PR-LIA-AUTO-ASSIGN Phase 6 (Option A): replace the dead invoice-line
-- Payment model with a Stripe-webhook-event Payment model.
--
-- The original Payment model (from 20260430_add_student_portal_models)
-- was scaffolding for an invoice-line-payment / accounts-receivable
-- feature that was never wired up beyond a single SELECT path in
-- StudentsService.getInvoices. Verification before this migration
-- confirmed:
--   * 0 rows in `payments`
--   * 0 rows in `invoices`
--   * The only Prisma caller (StudentsService.getInvoices) is updated
--     in this PR to drop the include block; its controller endpoint
--     remains live but the frontend page is still "Coming soon".
--   * 0 imports of the PaymentMethod / InvoicePaymentStatus enums
--     anywhere in backend/src.
--
-- The replacement Payment model is keyed on `stripePaymentIntentId`
-- (@unique → idempotency on Stripe webhook retries). It carries the
-- discriminator (`paymentType`), the durable trace of which lead and
-- (optionally) case the charge belonged to, and a JSON snapshot of
-- the Stripe metadata blob so the AR domain (when it ships) can
-- re-link payments to invoices without going back to Stripe.
--
-- AR domain rebuild path: when the student invoice-receipts page
-- ships, either grow this model with an optional `invoiceId` column,
-- or introduce a new `InvoicePayment` join table that reconciles
-- Stripe events to invoice line items. Decision deferred until the
-- product surface is concrete.

-- Drop the old payments table + dependent constraints. CASCADE is
-- safe here because (a) the table is empty and (b) the only FK into
-- it was the Invoice.payments back-reference, which we deleted in
-- the schema. CASCADE will silently no-op on missing dependents.
DROP TABLE IF EXISTS "payments" CASCADE;

-- Drop the enums that only the old model referenced. IF EXISTS keeps
-- the migration idempotent against partial-rollback scenarios.
DROP TYPE IF EXISTS "PaymentMethod";
DROP TYPE IF EXISTS "InvoicePaymentStatus";

-- New Payment model — see backend/prisma/schema.prisma for the
-- doc-block explaining each column. Indexed on leadId and caseId to
-- match the two common reverse-lookup paths (admin "show me this
-- lead's payments" / case-detail "show me this case's payments").
CREATE TABLE "payments" (
  "id"                    TEXT      NOT NULL,
  "stripePaymentIntentId" TEXT      NOT NULL,
  "leadId"                TEXT      NOT NULL,
  "caseId"                TEXT,
  "paymentType"           TEXT      NOT NULL,
  "amount"                INTEGER   NOT NULL,
  "currency"              TEXT      NOT NULL DEFAULT 'nzd',
  "status"                TEXT      NOT NULL,
  "metadata"              JSONB,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key"
  ON "payments" ("stripePaymentIntentId");

CREATE INDEX "payments_leadId_idx" ON "payments" ("leadId");
CREATE INDEX "payments_caseId_idx" ON "payments" ("caseId");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
