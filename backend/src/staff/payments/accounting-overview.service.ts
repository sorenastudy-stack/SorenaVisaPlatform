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
// Deliberately NOT here: revenue by month, service mix, GST breakdown, and
// agent payables. The first three need aggregation this codebase does not have
// yet; the fourth has no data model at all (AffiliateAgent carries no money
// fields). Returning zeros for those would let the page draw an empty chart
// that reads as "nothing happened" when the truth is "this is not built yet" —
// so the page is told nothing about them and says so in its own words.

/** Months of case history the students-per-month series covers. */
const STUDENT_MONTHS = 6;

export interface AccountingOverview {
  /** Invoice counts keyed by InvoiceStatus. Absent statuses are simply absent. */
  invoicesByStatus: Record<string, number>;
  /** Payment counts keyed by PaymentVerificationStatus. */
  paymentsByStatus: Record<string, number>;
  /** Payment counts keyed by `paymentType` — the nearest thing to a method. */
  paymentsByType: Record<string, number>;
  /** Newest last, so a chart can render it without reversing. */
  studentsByMonth: Array<{ month: string; count: number }>;
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

    return {
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
