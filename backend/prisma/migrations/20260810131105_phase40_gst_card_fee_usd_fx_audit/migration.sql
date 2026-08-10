-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "cardFeeAmount" DECIMAL(10,2),
ADD COLUMN     "exchangeRateSource" TEXT,
ADD COLUMN     "exchangeRateTimestamp" TIMESTAMP(3),
ADD COLUMN     "exchangeRateUsed" DECIMAL(12,6),
ADD COLUMN     "gstAmount" DECIMAL(10,2),
ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cardFeeCents" INTEGER,
ADD COLUMN     "gstCents" INTEGER,
ALTER COLUMN "currency" SET DEFAULT 'usd';

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "rateDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rates_baseCurrency_quoteCurrency_rateDate_idx" ON "exchange_rates"("baseCurrency", "quoteCurrency", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_baseCurrency_quoteCurrency_rateDate_key" ON "exchange_rates"("baseCurrency", "quoteCurrency", "rateDate");

