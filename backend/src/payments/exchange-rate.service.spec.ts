import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExchangeRateService, RATE_SOURCE, MissingExchangeRateError,
  BASE_CURRENCY, QUOTE_CURRENCY,
} from './exchange-rate.service';

// PR-PHASE40 — the FX rate stamped on a tax invoice.
//
// The properties that matter are the ones an auditor would ask about: is the
// rate the one published for the day (not a live per-invoice call), does a
// provider failure degrade gracefully rather than blocking invoicing, and is a
// fallback distinguishable from a real rate.

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  let upsert: jest.Mock;
  let findFirst: jest.Mock;

  beforeEach(async () => {
    upsert = jest.fn().mockResolvedValue({});
    findFirst = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExchangeRateService,
        { provide: PrismaService, useValue: { exchangeRate: { upsert, findFirst } } },
      ],
    }).compile();
    service = moduleRef.get(ExchangeRateService);
    jest.restoreAllMocks();
  });

  describe('fetchAndStoreDailyRate', () => {
    it('stores the rate against the DAY, not the fetch moment', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({ rates: { NZD: 1.6423 } }),
      }) as any;

      const at = new Date('2026-08-10T21:45:00.000Z');
      await service.fetchAndStoreDailyRate(at);

      const args = upsert.mock.calls[0][0];
      expect(args.create.rate).toBe(1.6423);
      expect(args.create.source).toBe(RATE_SOURCE);
      expect(args.create.baseCurrency).toBe(BASE_CURRENCY);
      expect(args.create.quoteCurrency).toBe(QUOTE_CURRENCY);
      // Midnight UTC of that date — so two fetches on the same day collide on
      // the unique key rather than creating two rates for one date.
      expect(args.create.rateDate.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    });

    it('is idempotent — a same-day re-run upserts rather than inserting again', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, json: async () => ({ rates: { NZD: 1.7 } }),
      }) as any;
      await service.fetchAndStoreDailyRate(new Date('2026-08-10T05:30:00Z'));
      await service.fetchAndStoreDailyRate(new Date('2026-08-10T18:00:00Z'));

      expect(upsert).toHaveBeenCalledTimes(2);
      const [a, b] = upsert.mock.calls.map((c) => c[0].where.baseCurrency_quoteCurrency_rateDate.rateDate.toISOString());
      expect(a).toBe(b);   // same key → the second updates the first
    });

    it.each([
      ['a non-200 response', { ok: false, status: 503, json: async () => ({}) }],
      ['200 with no rate',   { ok: true, json: async () => ({ rates: {} }) }],
      ['200 with a zero rate', { ok: true, json: async () => ({ rates: { NZD: 0 } }) }],
      ['200 with nonsense',  { ok: true, json: async () => ({ rates: { NZD: 'abc' } }) }],
    ])('writes nothing and returns null on %s', async (_label, response) => {
      global.fetch = jest.fn().mockResolvedValue(response) as any;
      // A 200 carrying a malformed rate is the dangerous case: treated as
      // success it would write 0 or NaN into a tax record.
      await expect(service.fetchAndStoreDailyRate()).resolves.toBeNull();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('never throws out of the scheduler when the network fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as any;
      await expect(service.fetchAndStoreDailyRate()).resolves.toBeNull();
    });
  });

  describe('getRateForInvoice', () => {
    it('uses the most recent STORED rate — no live call per invoice', async () => {
      global.fetch = jest.fn() as any;
      findFirst.mockResolvedValue({
        rate: '1.6423', source: RATE_SOURCE, fetchedAt: new Date('2026-08-10T05:30:00Z'),
      });

      const r = await service.getRateForInvoice();
      expect(r).toEqual({
        rate: 1.6423,
        source: RATE_SOURCE,
        timestamp: new Date('2026-08-10T05:30:00Z'),
      });
      // Two invoices minutes apart must carry the same rate.
      expect(global.fetch).not.toHaveBeenCalled();
      expect(findFirst.mock.calls[0][0].orderBy).toEqual({ rateDate: 'desc' });
    });

    it('BLOCKS when no rate has ever been stored — never invents one', async () => {
      // The only case this can happen is day zero of a fresh environment. A
      // guessed rate would land on a tax invoice indistinguishable from a real
      // one; blocking is recoverable, a wrong filed GST figure is not.
      findFirst.mockResolvedValue(null);
      const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await expect(service.getRateForInvoice('invoice INV-1'))
        .rejects.toBeInstanceOf(MissingExchangeRateError);

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('BLOCKING');
      expect(error.mock.calls[0][0]).toContain('invoice INV-1');
    });

    it('names the fix in the error, so whoever hits it knows what to do', async () => {
      findFirst.mockResolvedValue(null);
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await expect(service.getRateForInvoice('the engagement invoice'))
        .rejects.toThrow(/Seed one row in exchange_rates|run the daily job once/);
    });

    it.each([
      ['yesterday', 1],
      ['a week old', 7],
      ['three months old', 90],
    ])('uses a %s stored rate rather than blocking', async (_label, ageDays) => {
      // Age is never a reason to block. A weekend, a holiday, or a long run of
      // failed fetches must not stop invoicing — an old rate is a real rate
      // that really was published.
      const rateDate = new Date(Date.now() - ageDays * 86_400_000);
      findFirst.mockResolvedValue({
        rate: '1.60', source: RATE_SOURCE, rateDate, fetchedAt: rateDate,
      });
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      const r = await service.getRateForInvoice();
      expect(r.rate).toBe(1.6);
      expect(r.source).toBe(RATE_SOURCE);
    });

    it('warns when the rate it used is more than a week old', async () => {
      const rateDate = new Date(Date.now() - 30 * 86_400_000);
      findFirst.mockResolvedValue({
        rate: '1.60', source: RATE_SOURCE, rateDate, fetchedAt: rateDate,
      });
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      await service.getRateForInvoice();
      // Still used — but a month-old rate means the daily job has been failing,
      // and that should not pass unnoticed.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/30-day-old/);
    });

    it('does not warn about a fresh rate', async () => {
      findFirst.mockResolvedValue({
        rate: '1.64', source: RATE_SOURCE, rateDate: new Date(), fetchedAt: new Date(),
      });
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      await service.getRateForInvoice();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
