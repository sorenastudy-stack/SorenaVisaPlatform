import { resolveCommissionRate, type ProviderRates } from './commission-rate.logic';

// PR-ENGLISH-COMMISSION — the rate decision. The point of these is the
// NEGATIVE cases: a non-English programme, and an institution with no English
// rate, must resolve exactly as they did before this feature existed.

const provider = (over: Partial<ProviderRates> = {}): ProviderRates => ({
  commissionY1Type: 'PERCENTAGE',
  commissionY1Value: 15,
  commissionY2Type: 'PERCENTAGE',
  commissionY2Value: 10,
  commissionEnglishY1Type: null,
  commissionEnglishY1Value: null,
  commissionEnglishY2Type: null,
  commissionEnglishY2Value: null,
  ...over,
});

describe('resolveCommissionRate', () => {
  describe('nothing changes for programmes this feature does not touch', () => {
    it('a non-English programme uses the provider rate', () => {
      expect(resolveCommissionRate({ isEnglishLanguageCourse: false }, provider()))
        .toEqual({ commissionType: 'PERCENTAGE', commissionValue: 15, source: 'PROVIDER_DEFAULT' });
    });

    it('a non-English programme ignores an English rate even when one exists', () => {
      const p = provider({ commissionEnglishY1Type: 'PERCENTAGE', commissionEnglishY1Value: 25 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: false }, p).commissionValue).toBe(15);
    });

    it('an ENGLISH programme at an institution with no English rate uses the provider rate', () => {
      // This is the common case today: 0 of 96 institutions have an English rate.
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true }, provider()))
        .toEqual({ commissionType: 'PERCENTAGE', commissionValue: 15, source: 'PROVIDER_DEFAULT' });
    });

    it('a provider left at the 0 default still reports 0 — it does not invent a rate', () => {
      // 73 of 96 institutions are in this state. Reporting 0 is honest; guessing
      // a "sensible" number would silently fabricate money owed.
      const p = provider({ commissionY1Value: 0 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: false }, p))
        .toEqual({ commissionType: 'PERCENTAGE', commissionValue: 0, source: 'PROVIDER_DEFAULT' });
    });
  });

  describe('the English override', () => {
    it('an English programme uses the English rate when one is set', () => {
      const p = provider({ commissionEnglishY1Type: 'PERCENTAGE', commissionEnglishY1Value: 25 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true }, p))
        .toEqual({ commissionType: 'PERCENTAGE', commissionValue: 25, source: 'ENGLISH_COURSE' });
    });

    it('honours an agreed English rate of ZERO', () => {
      // The reason the column is nullable: 0 is a real agreement, null is "none".
      const p = provider({ commissionEnglishY1Type: 'PERCENTAGE', commissionEnglishY1Value: 0 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true }, p))
        .toEqual({ commissionType: 'PERCENTAGE', commissionValue: 0, source: 'ENGLISH_COURSE' });
    });

    it('supports a FIXED English rate against a PERCENTAGE normal rate', () => {
      const p = provider({ commissionEnglishY1Type: 'FIXED', commissionEnglishY1Value: 1200 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true }, p))
        .toEqual({ commissionType: 'FIXED', commissionValue: 1200, source: 'ENGLISH_COURSE' });
    });

    it('ignores a type with no value — an incomplete record is not a rate', () => {
      const p = provider({ commissionEnglishY1Type: 'FIXED', commissionEnglishY1Value: null });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true }, p).source).toBe('PROVIDER_DEFAULT');
    });
  });

  describe('year 2', () => {
    it('uses the year-2 provider rate', () => {
      expect(resolveCommissionRate({ isEnglishLanguageCourse: false, year: 2 }, provider()).commissionValue).toBe(10);
    });

    it('uses the year-2 English rate for an English programme', () => {
      const p = provider({ commissionEnglishY2Type: 'PERCENTAGE', commissionEnglishY2Value: 20 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true, year: 2 }, p))
        .toEqual({ commissionType: 'PERCENTAGE', commissionValue: 20, source: 'ENGLISH_COURSE' });
    });

    it('falls back per-year independently: Y1 English set, Y2 not', () => {
      const p = provider({ commissionEnglishY1Type: 'PERCENTAGE', commissionEnglishY1Value: 25 });
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true, year: 1 }, p).source).toBe('ENGLISH_COURSE');
      expect(resolveCommissionRate({ isEnglishLanguageCourse: true, year: 2 }, p).source).toBe('PROVIDER_DEFAULT');
    });

    it('treats any year other than 2 as year 1', () => {
      expect(resolveCommissionRate({ isEnglishLanguageCourse: false, year: 99 }, provider()).commissionValue).toBe(15);
    });
  });

  it('reports NONE when the institution could not be loaded', () => {
    expect(resolveCommissionRate({ isEnglishLanguageCourse: true }, null))
      .toEqual({ commissionType: null, commissionValue: null, source: 'NONE' });
  });
});
