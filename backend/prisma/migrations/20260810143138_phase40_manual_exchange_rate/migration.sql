-- DropIndex
DROP INDEX "exchange_rates_baseCurrency_quoteCurrency_rateDate_key";

-- AlterTable
ALTER TABLE "exchange_rates" ADD COLUMN     "enteredByName" TEXT,
ADD COLUMN     "enteredByUserId" TEXT;

