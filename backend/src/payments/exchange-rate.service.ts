import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-PHASE40 — the USD→NZD rate used to state GST in NZD on a USD invoice.
//
// Invoices are denominated in USD; NZ GST is assessed and filed in NZD. So the
// rate that bridges the two has to be recorded on the invoice at the moment it
// is raised — reconstructing it later from a rate table is a guess, and IRD
// wants the rate at the time of supply.
//
// ONE RATE PER DAY, cached. Not a live call per invoice: two invoices raised
// minutes apart must not carry different rates, and a provider outage must not
// be able to stop a client paying.

export const RATE_SOURCE = 'exchangerate.host';
export const BASE_CURRENCY = 'USD';
export const QUOTE_CURRENCY = 'NZD';

/**
 * Thrown when the rate table is empty — no daily fetch has EVER succeeded.
 *
 * There is deliberately no fallback constant. A guessed rate would put a made-up
 * number on a tax invoice and be indistinguishable, after the fact, from a real
 * one; blocking is recoverable, a wrong filed GST figure is not.
 *
 * In practice this can only happen on day zero of a fresh environment, before
 * the 05:30 job has run once. The fix is to seed one rate manually, and it is
 * needed once.
 */
export class MissingExchangeRateError extends Error {
  constructor(context: string) {
    super(
      `Cannot raise ${context}: no ${BASE_CURRENCY}→${QUOTE_CURRENCY} exchange rate has ever been stored. ` +
      `NZ GST is filed in ${QUOTE_CURRENCY} and this invoice is in ${BASE_CURRENCY}, so a rate is required. ` +
      `Seed one row in exchange_rates (or run the daily job once) before invoicing.`,
    );
    this.name = 'MissingExchangeRateError';
  }
}

export interface ResolvedRate {
  rate: number;
  source: string;
  timestamp: Date;
}

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Midnight UTC of the given day — the key rates are stored against. */
  private static dayOf(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /**
   * Fetch today's rate and store it. Idempotent — re-running on the same day
   * updates that day's row rather than adding a second one, so a retry after a
   * transient failure cannot leave two rates for one date.
   *
   * Returns null on failure rather than throwing: a missed fetch must never
   * take down the scheduler, and the previous day's rate remains usable.
   */
  async fetchAndStoreDailyRate(now: Date = new Date()): Promise<number | null> {
    const url = `https://api.exchangerate.host/latest?base=${BASE_CURRENCY}&symbols=${QUOTE_CURRENCY}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body: any = await res.json();
      const rate = Number(body?.rates?.[QUOTE_CURRENCY]);
      // A provider can answer 200 with a malformed or absent rate; treating
      // that as success would write a 0 or NaN into a tax record.
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`no usable ${QUOTE_CURRENCY} rate in response`);
      }

      const rateDate = ExchangeRateService.dayOf(now);
      await this.prisma.exchangeRate.upsert({
        where: {
          baseCurrency_quoteCurrency_rateDate: {
            baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_CURRENCY, rateDate,
          },
        },
        update: { rate, source: RATE_SOURCE, fetchedAt: now },
        create: {
          baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_CURRENCY,
          rate, rateDate, source: RATE_SOURCE, fetchedAt: now,
        },
      });

      this.logger.log(`[FX] ${BASE_CURRENCY}→${QUOTE_CURRENCY} ${rate} stored for ${rateDate.toISOString().slice(0, 10)}`);
      return rate;
    } catch (err: any) {
      this.logger.error(`[FX] Failed to fetch ${BASE_CURRENCY}→${QUOTE_CURRENCY}: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * The rate to stamp on an invoice: the most recent stored one, WHATEVER its
   * age.
   *
   * Deliberately "most recent" rather than "today's". A weekend, a public
   * holiday or a run of failed fetches must not stop invoicing — last week's
   * published rate is a defensible, auditable basis, and it is a real rate that
   * really was published.
   *
   * Throws only when the table has never held a rate at all. That is a
   * day-zero condition, not an operating one.
   */
  async getRateForInvoice(context = 'this invoice'): Promise<ResolvedRate> {
    const latest = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_CURRENCY },
      orderBy: { rateDate: 'desc' },
    });

    if (!latest) {
      // Loud, because the alternative — inventing a number — is silent and
      // permanent. The caller turns this into a blocked invoice plus an audit
      // row, so it reaches someone rather than only the log.
      this.logger.error(
        `[FX] BLOCKING ${context}: no ${BASE_CURRENCY}→${QUOTE_CURRENCY} rate has ever been stored. ` +
        `The daily job has not yet succeeded. Seed one rate to unblock invoicing.`,
      );
      throw new MissingExchangeRateError(context);
    }

    const ageDays = Math.floor(
      (Date.now() - new Date(latest.rateDate).getTime()) / 86_400_000,
    );
    if (ageDays > 7) {
      // Still used — a real old rate beats a guess — but worth noticing, since
      // it means the daily job has been failing for over a week.
      this.logger.warn(
        `[FX] Using a ${ageDays}-day-old ${BASE_CURRENCY}→${QUOTE_CURRENCY} rate for ${context}. ` +
        `The daily fetch appears to be failing.`,
      );
    }

    return {
      rate: Number(latest.rate),
      source: latest.source,
      timestamp: latest.fetchedAt,
    };
  }
}
