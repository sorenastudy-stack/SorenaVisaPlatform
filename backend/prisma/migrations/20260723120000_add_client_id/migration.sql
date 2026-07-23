-- PR-CLIENT-ID — human-readable Lead.clientId ({COUNTRY}-{YEAR}-{NNNNNN}) + its
-- atomic per-year global counter. Additive + nullable → safe on a live table;
-- the cuid `id` (relational key) is untouched. Backfilled separately.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_clientId_key" ON "leads"("clientId");

-- CreateTable
CREATE TABLE "client_id_counters" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "client_id_counters_pkey" PRIMARY KEY ("year")
);
