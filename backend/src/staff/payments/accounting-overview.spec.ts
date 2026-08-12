import { PrismaClient } from '@prisma/client';
import { AccountingOverviewService } from './accounting-overview.service';

/**
 * PR-REVENUE-GST-AGGREGATION — money by month, and GST by return period.
 *
 * Against a real database: these are date-window queries and a currency split,
 * and a mock would happily accept a `where` that selects everything or a bucket
 * that silently drops rows. The properties worth pinning are the ones that would
 * misstate a figure rather than crash — a cancelled invoice counted as revenue,
 * two currencies added together, an invoice with no issue date quietly absorbed
 * into a return period it was never assessed in.
 */

jest.setTimeout(90000);

describe('AccountingOverviewService — revenue and GST', () => {
  let prisma: PrismaClient;
  let svc: AccountingOverviewService;

  const made = { invoices: [] as string[], payments: [] as string[], leads: [] as string[], contacts: [] as string[],
    commissions: [] as string[], choices: [] as string[], admissions: [] as string[], cases: [] as string[],
    programmes: [] as string[], providers: [] as string[] };
  let contactId: string;
  let leadId: string;

  let seq = 0;
  const stamp = () => `ag${Date.now()}_${(seq += 1)}`;

  /** August 2026 — inside the Jul–Aug two-monthly period. */
  const NOW = new Date(2026, 7, 20);

  async function mkInvoice(opts: {
    amount: number; currency: string; gst?: number | null;
    createdAt: Date; issuedAt?: Date | null; status?: string;
  }) {
    const s = stamp();
    const inv = await prisma.invoice.create({
      data: {
        contactId, invoiceNumber: `AGG-${s}`, description: 'test',
        amount: opts.amount, currency: opts.currency,
        gstAmount: opts.gst ?? null,
        status: (opts.status ?? 'SENT') as any,
        createdAt: opts.createdAt,
        issuedAt: opts.issuedAt ?? null,
      } as any,
    });
    made.invoices.push(inv.id);
    return inv.id;
  }

  async function mkPayment(amountCents: number, currency: string, createdAt: Date) {
    const s = stamp();
    const p = await prisma.payment.create({
      data: {
        stripePaymentIntentId: `pi_agg_${s}`, leadId, paymentType: 'manual',
        amount: amountCents, currency, status: 'succeeded', createdAt,
      } as any,
    });
    made.payments.push(p.id);
    return p.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    svc = new AccountingOverviewService(prisma as any);

    const s = stamp();
    const c = await prisma.contact.create({ data: { fullName: `Agg ${s}`, email: `agg.${s}@t.local` } });
    made.contacts.push(c.id);
    contactId = c.id;
    const l = await prisma.lead.create({ data: { contactId: c.id, leadStatus: 'NEW' } as any });
    made.leads.push(l.id);
    leadId = l.id;
  }, 90000);

  afterAll(async () => {
    await prisma.agentPayable.deleteMany({ where: { commissionId: { in: made.commissions } } }).catch(() => {});
    await prisma.commission.deleteMany({ where: { id: { in: made.commissions } } }).catch(() => {});
    await prisma.admissionProgrammeChoice.deleteMany({ where: { id: { in: made.choices } } }).catch(() => {});
    await prisma.admissionApplication.deleteMany({ where: { id: { in: made.admissions } } }).catch(() => {});
    await prisma.case.deleteMany({ where: { id: { in: made.cases } } }).catch(() => {});
    await prisma.educationProgramme.deleteMany({ where: { id: { in: made.programmes } } }).catch(() => {});
    await prisma.educationProvider.deleteMany({ where: { id: { in: made.providers } } }).catch(() => {});
    await prisma.invoice.deleteMany({ where: { id: { in: made.invoices } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { id: { in: made.payments } } }).catch(() => {});
    await prisma.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: made.contacts } } }).catch(() => {});
    await prisma.$disconnect();
  });

  /** This suite's own rows, isolated from whatever else the database holds. */
  const mine = (r: any) => r; // buckets are additive; assertions use deltas below

  describe('revenue by month', () => {
    it('returns six months, newest last, with every month present', async () => {
      const r = await svc.overview(NOW);
      expect(r.revenueByMonth).toHaveLength(6);
      expect(r.revenueByMonth[5].month).toBe('2026-08');
      expect(r.revenueByMonth[0].month).toBe('2026-03');
    });

    it('keeps currencies apart instead of adding them together', async () => {
      const before = await svc.overview(NOW);
      const augBefore = before.revenueByMonth[5];
      const usdBefore = augBefore.invoicedByCurrency.USD ?? 0;
      const nzdBefore = augBefore.receivedByCurrency.NZD ?? 0;

      await mkInvoice({ amount: 200, currency: 'USD', createdAt: new Date(2026, 7, 5) });
      await mkPayment(15000, 'nzd', new Date(2026, 7, 6));

      const after = await svc.overview(NOW);
      const aug = after.revenueByMonth[5];
      // 200 dollars → 20000 cents, on the USD side only.
      expect((aug.invoicedByCurrency.USD ?? 0) - usdBefore).toBe(20000);
      expect((aug.receivedByCurrency.NZD ?? 0) - nzdBefore).toBe(15000);
      // The NZD payment must not have landed on the invoiced side, nor the USD
      // invoice on the received side.
      expect(aug.invoicedByCurrency.NZD ?? 0).toBe(augBefore.invoicedByCurrency.NZD ?? 0);
    });

    it('lower-cases currency codes are normalised, so nzd and NZD are one bucket', async () => {
      const before = (await svc.overview(NOW)).revenueByMonth[5].receivedByCurrency.NZD ?? 0;
      await mkPayment(500, 'nzd', new Date(2026, 7, 7));
      await mkPayment(700, 'NZD', new Date(2026, 7, 7));
      const after = (await svc.overview(NOW)).revenueByMonth[5].receivedByCurrency.NZD ?? 0;
      expect(after - before).toBe(1200);
    });

    it('a cancelled invoice is not revenue', async () => {
      const before = (await svc.overview(NOW)).revenueByMonth[5].invoicedByCurrency.USD ?? 0;
      await mkInvoice({ amount: 999, currency: 'USD', createdAt: new Date(2026, 7, 8), status: 'CANCELLED' });
      const after = (await svc.overview(NOW)).revenueByMonth[5].invoicedByCurrency.USD ?? 0;
      expect(after).toBe(before);
    });

    it('rows outside the window do not leak into it', async () => {
      const before = await svc.overview(NOW);
      const total = (m: any) => Object.values(m.invoicedByCurrency as Record<string, number>).reduce((a, b) => a + b, 0);
      const sumBefore = before.revenueByMonth.reduce((n, m) => n + total(m), 0);
      // A year earlier — outside the six-month window entirely.
      await mkInvoice({ amount: 5000, currency: 'USD', createdAt: new Date(2025, 7, 1) });
      const after = await svc.overview(NOW);
      expect(after.revenueByMonth.reduce((n, m) => n + total(m), 0)).toBe(sumBefore);
    });
  });

  describe('GST by period', () => {
    it('derives the two-monthly period August falls in', async () => {
      const r = await svc.overview(NOW);
      expect(r.gstByPeriod.periodStart).toBe('2026-07-01');
      expect(r.gstByPeriod.periodEnd).toBe('2026-08-31');
    });

    it('picks the right period at a boundary', async () => {
      // 1 September starts the next block.
      const sep = await svc.overview(new Date(2026, 8, 1));
      expect(sep.gstByPeriod.periodStart).toBe('2026-09-01');
      expect(sep.gstByPeriod.periodEnd).toBe('2026-10-31');
      // 1 January starts the year's first.
      const jan = await svc.overview(new Date(2026, 0, 1));
      expect(jan.gstByPeriod.periodStart).toBe('2026-01-01');
      expect(jan.gstByPeriod.periodEnd).toBe('2026-02-28');
    });

    it('counts GST for an invoice issued inside the period', async () => {
      const before = await svc.overview(NOW);
      await mkInvoice({
        amount: 200, currency: 'USD', gst: 30,
        createdAt: new Date(2026, 7, 9), issuedAt: new Date(2026, 7, 9),
      });
      const after = await svc.overview(NOW);
      expect(after.gstByPeriod.invoiceCount).toBe(before.gstByPeriod.invoiceCount + 1);
      expect((after.gstByPeriod.gstByCurrency.USD ?? 0) - (before.gstByPeriod.gstByCurrency.USD ?? 0)).toBe(3000);
      expect((after.gstByPeriod.exGstByCurrency.USD ?? 0) - (before.gstByPeriod.exGstByCurrency.USD ?? 0)).toBe(20000);
    });

    it('an invoice issued in a DIFFERENT period is not counted', async () => {
      const before = await svc.overview(NOW);
      await mkInvoice({
        amount: 400, currency: 'USD', gst: 60,
        createdAt: new Date(2026, 5, 2), issuedAt: new Date(2026, 5, 2), // June — May–Jun period
      });
      const after = await svc.overview(NOW);
      expect(after.gstByPeriod.invoiceCount).toBe(before.gstByPeriod.invoiceCount);
    });

    it('an invoice with NO issue date is counted separately, not dropped and not misdated', async () => {
      // The whole reason unassignedCount exists: a zero has to be explainable.
      const before = await svc.overview(NOW);
      await mkInvoice({ amount: 300, currency: 'USD', gst: 45, createdAt: new Date(2026, 7, 10), issuedAt: null });
      const after = await svc.overview(NOW);

      expect(after.gstByPeriod.unassignedCount).toBe(before.gstByPeriod.unassignedCount + 1);
      // and it did NOT quietly join the period
      expect(after.gstByPeriod.invoiceCount).toBe(before.gstByPeriod.invoiceCount);
      expect(after.gstByPeriod.gstByCurrency.USD ?? 0).toBe(before.gstByPeriod.gstByCurrency.USD ?? 0);
    });

    it('an invoice with no GST recorded still counts toward the period, with no GST added', async () => {
      // Pre-GST invoices are real invoices. Excluding them would understate the
      // period's turnover; inventing a GST figure for them would be worse.
      const before = await svc.overview(NOW);
      await mkInvoice({
        amount: 100, currency: 'USD', gst: null,
        createdAt: new Date(2026, 7, 11), issuedAt: new Date(2026, 7, 11),
      });
      const after = await svc.overview(NOW);
      expect(after.gstByPeriod.invoiceCount).toBe(before.gstByPeriod.invoiceCount + 1);
      expect((after.gstByPeriod.exGstByCurrency.USD ?? 0) - (before.gstByPeriod.exGstByCurrency.USD ?? 0)).toBe(10000);
      expect(after.gstByPeriod.gstByCurrency.USD ?? 0).toBe(before.gstByPeriod.gstByCurrency.USD ?? 0);
    });

    it('a cancelled invoice is excluded from the period and from the unassigned count', async () => {
      const before = await svc.overview(NOW);
      await mkInvoice({
        amount: 700, currency: 'USD', gst: 105, status: 'CANCELLED',
        createdAt: new Date(2026, 7, 12), issuedAt: new Date(2026, 7, 12),
      });
      await mkInvoice({
        amount: 700, currency: 'USD', gst: 105, status: 'CANCELLED',
        createdAt: new Date(2026, 7, 12), issuedAt: null,
      });
      const after = await svc.overview(NOW);
      expect(after.gstByPeriod.invoiceCount).toBe(before.gstByPeriod.invoiceCount);
      expect(after.gstByPeriod.unassignedCount).toBe(before.gstByPeriod.unassignedCount);
    });
  });

  describe('provider commission pipeline and ageing', () => {
    /** A commission whose invoice went out `daysAgo`, optionally already paid. */
    async function mkCom(opts: { amount: number|null; invoicedDaysAgo?: number|null; paid?: boolean; status?: string }) {
      const s = stamp();
      const c2 = await prisma.contact.create({ data: { fullName: `PC ${s}`, email: `pc.${s}@t.local` } });
      made.contacts.push(c2.id);
      const l2 = await prisma.lead.create({ data: { contactId: c2.id, leadStatus: 'NEW' } as any });
      made.leads.push(l2.id);
      const k = await prisma.case.create({ data: { leadId: l2.id } });
      made.cases.push(k.id);
      const adm = await prisma.admissionApplication.create({ data: { caseId: k.id, contactId: c2.id } as any });
      made.admissions.push(adm.id);
      const prov = await prisma.educationProvider.create({ data: { name: `PProv ${s}`, providerType: 'UNIVERSITY' } as any });
      made.providers.push(prov.id);
      const prog = await prisma.educationProgramme.create({ data: { providerId: prov.id, name: `PProg ${s}`, level: 'BACHELOR', nzqfLevel: 'LEVEL_7' } as any });
      made.programmes.push(prog.id);
      const ch = await prisma.admissionProgrammeChoice.create({ data: { admissionApplicationId: adm.id, programmeId: prog.id, intakeMonth: 2, intakeYear: 2027, priority: 1 } as any });
      made.choices.push(ch.id);
      const com = await prisma.commission.create({ data: {
        programmeChoiceId: ch.id, providerId: prov.id, programmeId: prog.id, commissionValue: 15,
        actualAmountNZD: opts.amount, currency: 'NZD', status: (opts.status ?? 'ESTIMATED') as any,
        invoiceSentAt: opts.invoicedDaysAgo == null ? null : new Date(NOW.getTime() - opts.invoicedDaysAgo * 86400000),
        paidAt: opts.paid ? new Date(NOW.getTime() - 86400000) : null,
      } as any });
      made.commissions.push(com.id);
      return com.id;
    }

    const bucket = (r: any, name: string) => r.providerCommission.ageing.find((b: any) => b.bucket === name);

    it('a commission is earned, and only invoiced once it has been billed', async () => {
      const before = await svc.overview(NOW);
      await mkCom({ amount: 100, invoicedDaysAgo: null });
      const after = await svc.overview(NOW);
      expect(after.providerCommission.earned.count).toBe(before.providerCommission.earned.count + 1);
      expect(after.providerCommission.invoiced.count).toBe(before.providerCommission.invoiced.count);
      // Never billed, so it cannot be overdue.
      expect(bucket(after,'0-30 days').count).toBe(bucket(before,'0-30 days').count);
    });

    it('the pipeline nests — a received commission is also invoiced and earned', async () => {
      const before = await svc.overview(NOW);
      await mkCom({ amount: 100, invoicedDaysAgo: 10, paid: true, status: 'PAID' });
      const a = await svc.overview(NOW);
      expect(a.providerCommission.earned.count).toBe(before.providerCommission.earned.count + 1);
      expect(a.providerCommission.invoiced.count).toBe(before.providerCommission.invoiced.count + 1);
      expect(a.providerCommission.received.count).toBe(before.providerCommission.received.count + 1);
      // Paid, so it stops ageing.
      expect(bucket(a,'0-30 days').count).toBe(bucket(before,'0-30 days').count);
    });

    it.each([[10,'0-30 days'],[30,'0-30 days'],[31,'31-45 days'],[45,'31-45 days'],[46,'46-60 days'],[60,'46-60 days'],[61,'60+ days'],[400,'60+ days']])(
      'invoiced %i days ago falls in %s', async (days, name) => {
        const before = await svc.overview(NOW);
        await mkCom({ amount: 100, invoicedDaysAgo: days as number, status: 'INVOICED' });
        const after = await svc.overview(NOW);
        expect(bucket(after, name as string).count).toBe(bucket(before, name as string).count + 1);
      });

    it('an unpriced commission is counted separately, not added as zero', async () => {
      const before = await svc.overview(NOW);
      await mkCom({ amount: null, invoicedDaysAgo: 5 });
      const after = await svc.overview(NOW);
      expect(after.providerCommission.unpricedCount).toBe(before.providerCommission.unpricedCount + 1);
      expect(after.providerCommission.earned.count).toBe(before.providerCommission.earned.count);
    });

    it('a cancelled commission is excluded entirely', async () => {
      const before = await svc.overview(NOW);
      await mkCom({ amount: 100, invoicedDaysAgo: 5, status: 'CANCELLED' });
      const after = await svc.overview(NOW);
      expect(after.providerCommission.earned.count).toBe(before.providerCommission.earned.count);
      expect(after.providerCommission.unpricedCount).toBe(before.providerCommission.unpricedCount);
    });
  });
});
