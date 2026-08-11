import { PrismaClient } from '@prisma/client';
import { ExchangeRateService, MANUAL_SOURCE, BASE_CURRENCY, QUOTE_CURRENCY } from './exchange-rate.service';

/**
 * PR-PHASE40 — exchange_rates against a REAL database.
 *
 * The unit spec next door mocks Prisma, which means it passes whether or not
 * the table exists or has the shape the service assumes. That is not
 * hypothetical: the table was missing from a developer database for a day while
 * the whole suite stayed green.
 *
 * These three facts can only be proved against real Postgres:
 *   1. the table exists and accepts what the service writes;
 *   2. two rates for the SAME day both survive — the unique index that used to
 *      forbid that is gone, and if it ever comes back an upsert-shaped bug
 *      would silently destroy issued invoices' stamped rate;
 *   3. the newest-first ordering resolves same-day entries to the last one.
 */

jest.setTimeout(60000);

describe('exchange_rates is an append-only ledger (real DB)', () => {
  let prisma: PrismaClient;
  let service: ExchangeRateService;
  const written: string[] = [];

  // A quote currency no other test or seed uses, so these rows cannot collide
  // with — or be mistaken for — the real USD→NZD ledger.
  const QUOTE_TEST = 'XTS';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new ExchangeRateService(prisma as any);
  });

  afterAll(async () => {
    if (written.length) await prisma.exchangeRate.deleteMany({ where: { id: { in: written } } });
    await prisma.$disconnect();
  });

  async function append(rate: number, name: string, day: Date) {
    const r = await prisma.exchangeRate.create({
      data: {
        baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_TEST,
        rate, rateDate: day, source: MANUAL_SOURCE,
        enteredByUserId: 'test-user', enteredByName: name,
      },
    });
    written.push(r.id);
    return r;
  }

  it('accepts the columns the service writes, including who entered it', async () => {
    const r = await append(1.7, 'Fatemeh (Finance)', new Date(Date.UTC(2026, 7, 10)));
    expect(Number(r.rate)).toBe(1.7);
    expect(r.enteredByName).toBe('Fatemeh (Finance)');
    expect(r.source).toBe(MANUAL_SOURCE);
  });

  it('keeps BOTH rates when two are entered for the same day', async () => {
    const day = new Date(Date.UTC(2026, 7, 11));
    const first = await append(1.7, 'Fatemeh', day);
    const second = await append(1.72, 'Fatemeh', day);

    const both = await prisma.exchangeRate.findMany({
      where: { quoteCurrency: QUOTE_TEST, rateDate: day },
    });
    // If a unique index on (base, quote, rateDate) is ever reintroduced, the
    // second create throws here rather than quietly overwriting the first.
    expect(both).toHaveLength(2);
    expect(both.map((r) => r.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('resolves same-day entries to the LAST one entered', async () => {
    const day = new Date(Date.UTC(2026, 7, 12));
    await append(1.5, 'Typo', day);
    // createdAt has millisecond precision, and two inserts can land inside the
    // same millisecond — which made this assertion flaky, not the ordering
    // wrong. A real correction is a human returning to the screen, so the gap
    // is realistic; without it the test was asserting something the timestamp
    // cannot express.
    await new Promise((r) => setTimeout(r, 5));
    await append(1.75, 'Corrected', day);

    const latest = await prisma.exchangeRate.findFirst({
      where: { baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_TEST },
      orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }],
    });
    expect(Number(latest!.rate)).toBe(1.75);
    expect(latest!.enteredByName).toBe('Corrected');
  });

  it('getRateForInvoice reads the real table for the live currency pair', async () => {
    // Not asserting a value — the live ledger is environment-dependent. What is
    // asserted is that the query the invoice path runs is one this database can
    // actually answer.
    const live = await prisma.exchangeRate.findFirst({
      where: { baseCurrency: BASE_CURRENCY, quoteCurrency: QUOTE_CURRENCY },
      orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (!live) {
      await expect(service.getRateForInvoice('a test invoice')).rejects.toThrow(/has ever been entered/);
    } else {
      await expect(service.getRateForInvoice('a test invoice')).resolves.toMatchObject({
        rate: Number(live.rate),
      });
    }
  });
});
