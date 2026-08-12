import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// PR-ACCOUNTING-DASHBOARD — the aggregates behind the accountant's front page.
//
// One endpoint rather than five. The page needs four counts and a small series;
// splitting that across `/invoices?group=status`, `/payments/queue` and the rest
// would be five round trips and five gates to keep in agreement, for data that
// is always read together on one screen.
//
// It returns COUNTS AND FACTS ONLY — no colours, no labels, no empty-state
// copy. Which bucket is grey and which is coral is a decision about meaning
// that belongs with the design tokens, not in a service.
//
// Deliberately NOT here: service mix and agent payables.
//
// Service mix has no fee-type column to group by. `Payment.paymentType` records
// HOW money arrived (manual / consultation), not WHAT was sold, and the fee type
// survives only in the Stripe metadata blob — on 1 of 9 production payments.
// Manual payments never captured it at all, so it cannot be recovered
// retrospectively. That needs a column and a capture point, not a query.
//
// Agent payables have no data model: AffiliateAgent carries no rate, balance or
// payout. Returning zeros for either would let the page draw an empty chart that
// reads as "nothing happened" when the truth is "this is not built yet", so the
// page is told nothing about them and says so in its own words.

/** Months of case history the students-per-month series covers. */
const STUDENT_MONTHS = 6;

/** Months of revenue history returned. */
const REVENUE_MONTHS = 6;

/**
 * Length of a GST return period, in months.
 *
 * Two-monthly, the common New Zealand cycle, aligned to the calendar year:
 * Jan–Feb, Mar–Apr, May–Jun, and so on. Derived rather than stored — there is
 * no period table, and until a filed period needs locking there is nothing a
 * table would add that arithmetic does not.
 *
 * A constant rather than a literal because the cycle is a property of the
 * business, not of this file: an entity filing six-monthly changes this to 6
 * and everything downstream follows.
 */
const GST_PERIOD_MONTHS = 2;

export interface AccountingOverview {
  /** Invoice counts keyed by InvoiceStatus. Absent statuses are simply absent. */
  invoicesByStatus: Record<string, number>;
  /** Payment counts keyed by PaymentVerificationStatus. */
  paymentsByStatus: Record<string, number>;
  /** Payment counts keyed by `paymentType` — the nearest thing to a method. */
  paymentsByType: Record<string, number>;
  /** Newest last, so a chart can render it without reversing. */
  studentsByMonth: Array<{ month: string; count: number }>;
  /**
   * Money by month, kept apart by currency.
   *
   * `invoiced` is what was billed; `received` is what actually arrived. They are
   * different questions and the page asks both, so both are returned rather than
   * one being chosen here.
   *
   * NOT blended into a single figure. Invoices are USD, payments are NZD, and
   * combining them needs the rate each invoice was locked to — which is null on
   * every invoice raised before that stamping existed. A blended total would
   * either re-rate history at today's rate, silently changing figures already
   * reported, or quietly drop the rows it cannot convert. Per-currency is the
   * only version that can be traced back to what happened.
   *
   * Amounts are MINOR UNITS (cents) throughout, matching Payment.amount.
   */
  revenueByMonth: Array<{
    month: string;
    invoicedByCurrency: Record<string, number>;
    receivedByCurrency: Record<string, number>;
  }>;

  /**
   * The current GST return period.
   *
   * Filtered on `issuedAt` — when the invoice was issued, which is the date a
   * return is assessed on. Invoices with no issue date are counted separately
   * rather than dropped or dated by something else: `unassignedCount` is what
   * keeps "why is this zero" answerable.
   */
  gstByPeriod: {
    periodStart: string;
    periodEnd: string;
    invoiceCount: number;
    gstByCurrency: Record<string, number>;
    exGstByCurrency: Record<string, number>;
    unassignedCount: number;
  };

  /** Payments a person still has to look at. */
  pendingPaymentCount: number;
  /**
   * How many invoices carry the rate they were issued at.
   *
   * Drives the FX note. Zero is a real and meaningful answer — it means no
   * historical figure would move if the rate changed today — so the page can
   * say that rather than print a number that was true of imagined data.
   */
  invoicesWithLockedRate: number;
  totalInvoices: number;
}

@Injectable()
export class AccountingOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  private static tally<T extends string>(rows: Array<Record<string, any>>, key: T): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r[key])] = r._count ?? 0;
    return out;
  }

  private static monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * A calendar date, from the LOCAL parts of a local date.
   *
   * Not toISOString(). The period boundaries are built as local midnight, and
   * in New Zealand local midnight is the previous day in UTC — so a period
   * starting 1 July reported itself as starting 30 June, and an invoice issued
   * on the first of a period would be filed against the one before it. A return
   * period is a calendar fact, not an instant, so it is formatted as one.
   */
  private static dateOnly(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private static add(into: Record<string, number>, currency: string, minorUnits: number) {
    const k = currency.toUpperCase();
    into[k] = (into[k] ?? 0) + minorUnits;
  }

  /**
   * Invoiced and received, by month and currency.
   *
   * Invoices are dated by `createdAt` here, NOT `issuedAt`. Every invoice has a
   * created date; `issuedAt` is null on everything raised before it started
   * being written, and a revenue series that silently omitted those would
   * understate months that really did have invoices in them. The GST period
   * below is stricter on purpose — a tax return and a revenue trend do not carry
   * the same obligation about which date is correct.
   */
  private async revenueByMonth(now: Date) {
    const from = new Date(now.getFullYear(), now.getMonth() - (REVENUE_MONTHS - 1), 1);

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        // A cancelled invoice was never revenue. Everything else — draft, sent,
        // paid, overdue — was billed and belongs in "invoiced".
        where: { createdAt: { gte: from }, status: { not: 'CANCELLED' } },
        select: { amount: true, currency: true, createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: { gte: from } },
        select: { amount: true, currency: true, createdAt: true },
      }),
    ]);

    const buckets = new Map<string, { invoicedByCurrency: Record<string, number>; receivedByCurrency: Record<string, number> }>();
    for (let i = REVENUE_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(AccountingOverviewService.monthKey(d), { invoicedByCurrency: {}, receivedByCurrency: {} });
    }

    for (const inv of invoices) {
      const b = buckets.get(AccountingOverviewService.monthKey(inv.createdAt));
      if (!b) continue;
      // Invoice.amount is Decimal dollars; Payment.amount is integer cents. One
      // unit for both, so a caller never has to ask which it is holding.
      AccountingOverviewService.add(b.invoicedByCurrency, inv.currency, Math.round(Number(inv.amount) * 100));
    }
    for (const pay of payments) {
      const b = buckets.get(AccountingOverviewService.monthKey(pay.createdAt));
      if (!b) continue;
      AccountingOverviewService.add(b.receivedByCurrency, pay.currency, pay.amount);
    }

    return [...buckets.entries()].map(([month, v]) => ({ month, ...v }));
  }

  /**
   * GST for the return period `now` falls in.
   *
   * Periods are calendar-aligned blocks of GST_PERIOD_MONTHS, so August 2026
   * sits in Jul–Aug. Only invoices with an `issuedAt` inside the window count;
   * the rest are reported as `unassignedCount` so a zero can be explained rather
   * than merely observed.
   */
  private async gstForPeriod(now: Date) {
    const startMonth = Math.floor(now.getMonth() / GST_PERIOD_MONTHS) * GST_PERIOD_MONTHS;
    const periodStart = new Date(now.getFullYear(), startMonth, 1);
    const periodEnd = new Date(now.getFullYear(), startMonth + GST_PERIOD_MONTHS, 1);

    const [inPeriod, unassignedCount] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          issuedAt: { gte: periodStart, lt: periodEnd },
          status: { not: 'CANCELLED' },
        },
        select: { amount: true, gstAmount: true, currency: true },
      }),
      // Issued at some unknown time. Not in this period, not in any other —
      // counted so the number is visible rather than quietly missing.
      this.prisma.invoice.count({ where: { issuedAt: null, status: { not: 'CANCELLED' } } }),
    ]);

    const gstByCurrency: Record<string, number> = {};
    const exGstByCurrency: Record<string, number> = {};
    for (const inv of inPeriod) {
      AccountingOverviewService.add(exGstByCurrency, inv.currency, Math.round(Number(inv.amount) * 100));
      if (inv.gstAmount != null) {
        AccountingOverviewService.add(gstByCurrency, inv.currency, Math.round(Number(inv.gstAmount) * 100));
      }
    }

    return {
      periodStart: AccountingOverviewService.dateOnly(periodStart),
      // Inclusive last day, which is how a return period is written down. Built
      // by stepping back a day from the exclusive end in LOCAL terms, so a
      // daylight-saving transition inside the period cannot move it.
      periodEnd: AccountingOverviewService.dateOnly(
        new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 0),
      ),
      invoiceCount: inPeriod.length,
      gstByCurrency,
      exGstByCurrency,
      unassignedCount,
    };
  }

  async overview(now = new Date()): Promise<AccountingOverview> {
    const since = new Date(now.getFullYear(), now.getMonth() - (STUDENT_MONTHS - 1), 1);

    const [invoices, payStatus, payType, pendingPaymentCount, cases, lockedRate, totalInvoices] =
      await Promise.all([
        this.prisma.invoice.groupBy({ by: ['status'], _count: true }),
        this.prisma.payment.groupBy({ by: ['verificationStatus'], _count: true }),
        this.prisma.payment.groupBy({ by: ['paymentType'], _count: true }),
        this.prisma.payment.count({ where: { verificationStatus: 'PENDING' } }),
        this.prisma.case.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
        this.prisma.invoice.count({ where: { exchangeRateUsed: { not: null } } }),
        this.prisma.invoice.count(),
      ]);

    // Every month in the window, including the quiet ones — a gap in a series
    // reads as missing data, where a zero reads as a month with no enrolments.
    const buckets = new Map<string, number>();
    for (let i = STUDENT_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
    }
    for (const c of cases) {
      const key = `${c.createdAt.getFullYear()}-${String(c.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const revenueByMonth = await this.revenueByMonth(now);
    const gstByPeriod = await this.gstForPeriod(now);

    return {
      revenueByMonth,
      gstByPeriod,
      invoicesByStatus: AccountingOverviewService.tally(invoices, 'status'),
      paymentsByStatus: AccountingOverviewService.tally(payStatus, 'verificationStatus'),
      paymentsByType: AccountingOverviewService.tally(payType, 'paymentType'),
      studentsByMonth: [...buckets.entries()].map(([month, count]) => ({ month, count })),
      pendingPaymentCount,
      invoicesWithLockedRate: lockedRate,
      totalInvoices,
    };
  }
}
