import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExchangeRateService, MANUAL_SOURCE, MissingExchangeRateError,
  BASE_CURRENCY, QUOTE_CURRENCY,
} from './exchange-rate.service';

// PR-PHASE40 — the FX rate stamped on a tax invoice.
//
// The rate is now entered by a Finance Admin, not fetched. So the properties
// that matter are the ones an auditor would ask about: is the rate the one a
// named person entered, does entering a new one supersede the old without
// destroying it, and is an absent rate refused rather than guessed.
//
// There is deliberately no test that anything reaches the network. Nothing in
// this service does.

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  let create: jest.Mock;
  let findFirst: jest.Mock;
  let findMany: jest.Mock;

  const row = (over: Record<string, any> = {}) => ({
    id: 'r1', rate: '1.698185', rateDate: new Date('2026-08-10'),
    source: MANUAL_SOURCE, enteredByName: 'Fatemeh (Finance)',
    createdAt: new Date('2026-08-10T02:00:00Z'),
    fetchedAt: new Date('2026-08-10T02:00:00Z'),
    ...over,
  });

  beforeEach(async () => {
    create = jest.fn().mockImplementation(async (args: any) => row(args.data));
    findFirst = jest.fn();
    findMany = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExchangeRateService,
        { provide: PrismaService, useValue: { exchangeRate: { create, findFirst, findMany } } },
      ],
    }).compile();
    service = moduleRef.get(ExchangeRateService);
    jest.restoreAllMocks();
  });

  describe('recordManualRate', () => {
    it('APPENDS — never updates or upserts an existing row', async () => {
      // The whole point of the ledger. An upsert would overwrite the rate an
      // already-issued invoice was stamped with, making that invoice
      // unreconcilable against the table it came from.
      await service.recordManualRate(1.72, { id: 'u1', name: 'Fatemeh' });
      expect(create).toHaveBeenCalledTimes(1);
      const prisma = (service as any).prisma.exchangeRate;
      expect(prisma.update).toBeUndefined();
      expect(prisma.upsert).toBeUndefined();
    });

    it('records WHO entered it, as a name snapshot plus an id', async () => {
      await service.recordManualRate(1.72, { id: 'u1', name: 'Fatemeh' });
      const data = create.mock.calls[0][0].data;
      expect(data.enteredByUserId).toBe('u1');
      // Snapshot, not a join: deleting the staff account must not blank out an
      // accounting record's author.
      expect(data.enteredByName).toBe('Fatemeh');
      expect(data.source).toBe(MANUAL_SOURCE);
      expect(data.baseCurrency).toBe(BASE_CURRENCY);
      expect(data.quoteCurrency).toBe(QUOTE_CURRENCY);
    });

    it('stores the rate against the DAY, at midnight UTC', async () => {
      await service.recordManualRate(1.72, { id: 'u1', name: 'F' }, new Date('2026-08-10T21:45:00.000Z'));
      expect(create.mock.calls[0][0].data.rateDate.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    });

    it('allows two entries on the SAME day — the later one supersedes', async () => {
      const at = new Date('2026-08-10T09:00:00Z');
      await service.recordManualRate(1.70, { id: 'u1', name: 'F' }, at);
      await service.recordManualRate(1.72, { id: 'u1', name: 'F' }, at);
      // A typo corrected an hour later must leave both rows readable.
      expect(create).toHaveBeenCalledTimes(2);
      const [a, b] = create.mock.calls.map((c) => c[0].data.rateDate.toISOString());
      expect(a).toBe(b);
    });

    it.each([
      ['zero', 0],
      ['negative', -1.7],
      ['a slipped decimal point', 17000],
      ['NaN', Number.NaN],
    ])('refuses %s rather than storing it', async (_label, bad) => {
      // Rejected, not clamped. Quietly "fixing" a typo on a tax record is worse
      // than refusing it, because nobody is told.
      await expect(service.recordManualRate(bad as number, { id: 'u1', name: 'F' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentAndHistory', () => {
    it('returns the newest row as current, and the trail behind it', async () => {
      findMany.mockResolvedValue([
        row({ id: 'new', rate: '1.72', enteredByName: 'Fatemeh' }),
        row({ id: 'old', rate: '1.698185', source: 'open.er-api.com', enteredByName: null }),
      ]);
      const view = await service.getCurrentAndHistory();

      expect(view.current?.id).toBe('new');
      expect(view.current?.rate).toBe(1.72);
      expect(view.history).toHaveLength(2);
      // The seeded row keeps its own origin — it was not entered by hand and
      // must not claim to have been.
      expect(view.history[1].source).toBe('open.er-api.com');
      expect(view.history[1].enteredByName).toBeNull();
    });

    it('reports no current rate rather than throwing when the table is empty', async () => {
      // The Finance screen must still render on day zero — that is exactly when
      // someone needs to go there and enter the first rate.
      const view = await service.getCurrentAndHistory();
      expect(view.current).toBeNull();
      expect(view.history).toEqual([]);
    });
  });

  describe('getRateForInvoice', () => {
    it('uses the most recently entered rate', async () => {
      findFirst.mockResolvedValue(row({ rate: '1.6423', fetchedAt: new Date('2026-08-10T05:30:00Z') }));

      const r = await service.getRateForInvoice();
      expect(r).toEqual({
        rate: 1.6423,
        source: MANUAL_SOURCE,
        timestamp: new Date('2026-08-10T05:30:00Z'),
      });
      // Newest-first, with createdAt breaking same-day ties — otherwise two
      // entries for one day would resolve arbitrarily.
      expect(findFirst.mock.calls[0][0].orderBy).toEqual([
        { rateDate: 'desc' }, { createdAt: 'desc' },
      ]);
    });

    it('BLOCKS when no rate has ever been entered — never invents one', async () => {
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
        .rejects.toThrow(/Staff → Finance/);
    });

    it.each([
      ['yesterday', 1],
      ['a week old', 7],
      ['three months old', 90],
      ['two years old', 730],
    ])('uses a %s rate without blocking OR warning', async (_label, ageDays) => {
      // Under manual entry, age carries no signal. An old rate does not mean
      // anything is broken — it means Finance has not changed it, which is a
      // decision. Warning about it would train people to ignore the log.
      const rateDate = new Date(Date.now() - ageDays * 86_400_000);
      findFirst.mockResolvedValue(row({ rate: '1.60', rateDate, fetchedAt: rateDate }));
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      const r = await service.getRateForInvoice();
      expect(r.rate).toBe(1.6);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
