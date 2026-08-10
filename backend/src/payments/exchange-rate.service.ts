import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// PR-PHASE40 — the USD→NZD rate used to state GST in NZD on a USD invoice.
//
// Invoices are denominated in USD; NZ GST is assessed and filed in NZD. So the
// rate that bridges the two has to be recorded on the invoice at the moment it
// is raised — reconstructing it later is a guess, and IRD wants the rate at the
// time of supply.
//
// The rate is ENTERED BY A HUMAN, not fetched. No external provider is called
// from this codebase: a Finance Admin sets the rate in Staff → Finance and it
// stands until they set another one. That makes the number on a tax invoice
// something a person chose and can be asked about, rather than whatever a free
// API happened to return that morning — and it removes a third party from the
// path of every invoice.
//
// The table is an append-only ledger. Nothing here ever updates or deletes a
// row.

export const MANUAL_SOURCE = 'manual-entry';
export const BASE_CURRENCY = 'USD';
export const QUOTE_CURRENCY = 'NZD';

/** Guards against a typo putting an absurd rate on a tax invoice. */
const MIN_RATE = 0.01;
const MAX_RATE = 1000;

/**
 * Thrown when the rate table is empty — no rate has EVER been entered.
 *
 * There is deliberately no fallback constant. A guessed rate would put a made-up
 * number on a tax invoice and be indistinguishable, after the fact, from a real
 * one; blocking is recoverable, a wrong filed GST figure is not.
 *
 * In practice this can only happen on day zero of a fresh environment. The fix
 * is to enter one rate in Staff → Finance, and it is needed once.
 */
export class MissingExchangeRateError extends Error {
  constructor(context: string) {
    super(
      `Cannot raise ${context}: no ${BASE_CURRENCY}→${QUOTE_CURRENCY} exchange rate has ever been entered. ` +
      `NZ GST is filed in ${QUOTE_CURRENCY} and this invoice is in ${BASE_CURRENCY}, so a rate is required. ` +
      `A Finance Admin can set it in Staff → Finance → Exchange rate.`,
    );
    this.name = 'MissingExchangeRateError';
  }
}

export interface ResolvedRate {
  rate: number;
  source: string;
  timestamp: Date;
}

export interface RateEntry {
  id: string;
  rate: number;
  rateDate: Date;
  source: string;
  enteredByName: string | null;
  createdAt: Date;
}

export interface CurrentRateView {
  base: string;
  quote: string;
  current: RateEntry | null;
  history: RateEntry[];
}

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Newest-first ordering.
   *
   * rateDate is the primary key of intent — it is the day the rate applies to.
   * createdAt breaks ties, because the ledger allows several entries for one
   * day and the last correction of the morning is the one that counts.
   */
  private static readonly NEWEST_FIRST = [
    { rateDate: 'desc' as const },
    { createdAt: 'desc' as const },
  ];

  private static view(row: any): RateEntry {
    return {
      id: row.id,
      rate: Number(row.rate),
      rateDate: row.rateDate,
      source: row.source,
      enteredByName: row.enteredByName ?? null,
      createdAt: row.createdAt,
    };
  }

  /**
   * What the Finance screen shows: the rate invoices are currently using, plus
   * the trail of what it used to be and who changed it.
   */
  async getCurrentAndHistory(limit = 20): Promise<CurrentRateView> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: { baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_CURRENCY },
      orderBy: ExchangeRateService.NEWEST_FIRST,
      take: limit,
    });
    return {
      base: BASE_CURRENCY,
      quote: QUOTE_CURRENCY,
      current: rows[0] ? ExchangeRateService.view(rows[0]) : null,
      history: rows.map(ExchangeRateService.view),
    };
  }

  /**
   * Record a rate a human typed. Always an INSERT — never an update.
   *
   * Correcting a mistake means entering the right number, which supersedes the
   * wrong one for future invoices while leaving it visible for anything already
   * invoiced against it.
   */
  async recordManualRate(
    rate: number,
    actor: { id?: string | null; name?: string | null },
    now: Date = new Date(),
  ): Promise<RateEntry> {
    if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
      // Rejected rather than clamped: a rate outside this range is a typo, and
      // quietly correcting a typo on a tax record is worse than refusing it.
      throw new BadRequestException(
        `Enter a ${BASE_CURRENCY}→${QUOTE_CURRENCY} rate between ${MIN_RATE} and ${MAX_RATE}.`,
      );
    }

    const rateDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const row = await this.prisma.exchangeRate.create({
      data: {
        baseCurrency: BASE_CURRENCY,
        quoteCurrency: QUOTE_CURRENCY,
        rate,
        rateDate,
        source: MANUAL_SOURCE,
        fetchedAt: now,
        enteredByUserId: actor.id ?? null,
        enteredByName: actor.name ?? null,
      },
    });

    this.logger.log(
      `[FX] ${BASE_CURRENCY}→${QUOTE_CURRENCY} set to ${rate} by ${actor.name ?? actor.id ?? 'unknown'}`,
    );
    return ExchangeRateService.view(row);
  }

  /**
   * The rate to stamp on an invoice: the most recently entered one, WHATEVER
   * its age.
   *
   * Age is never a reason to block or to warn. Under manual entry an old rate
   * is not a symptom of anything failing — it means Finance has not changed it,
   * which is a decision, not an outage. It keeps applying until they do.
   *
   * Throws only when the table has never held a rate at all. That is a
   * day-zero condition, not an operating one.
   */
  async getRateForInvoice(context = 'this invoice'): Promise<ResolvedRate> {
    const latest = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_CURRENCY },
      orderBy: ExchangeRateService.NEWEST_FIRST,
    });

    if (!latest) {
      // Loud, because the alternative — inventing a number — is silent and
      // permanent. The caller turns this into a blocked invoice plus an audit
      // row, so it reaches someone rather than only the log.
      this.logger.error(
        `[FX] BLOCKING ${context}: no ${BASE_CURRENCY}→${QUOTE_CURRENCY} rate has ever been entered. ` +
        `A Finance Admin must set one in Staff → Finance before invoicing.`,
      );
      throw new MissingExchangeRateError(context);
    }

    return {
      rate: Number(latest.rate),
      source: latest.source,
      timestamp: latest.fetchedAt,
    };
  }
}
