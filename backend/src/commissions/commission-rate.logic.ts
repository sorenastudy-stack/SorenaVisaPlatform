import type { CommissionType } from '@prisma/client';

// PR-ENGLISH-COMMISSION — which rate applies to one programme.
//
// Pure: no DB, no I/O. The caller loads the programme flag and the provider's
// rates; this only decides. Kept separate so the decision can be tested without
// a database and so both commission-creation paths share one answer.
//
// THE RULE, in order:
//   1. The programme is an English-language course AND the institution has an
//      English rate on file  → the English rate.
//   2. Otherwise                                                → the provider's normal rate.
//   3. The provider has no rate on file at all                  → NONE.
//
// "Has an English rate on file" means the VALUE is non-null. Null is not zero:
// a null means no separate English rate was ever agreed, so the normal rate is
// correct; a stored 0 means somebody agreed 0% and we must honour it.

export type RateSource = 'ENGLISH_COURSE' | 'PROVIDER_DEFAULT' | 'NONE';

export interface ProviderRates {
  commissionY1Type: CommissionType;
  commissionY1Value: number;
  commissionY2Type: CommissionType;
  commissionY2Value: number;
  commissionEnglishY1Type: CommissionType | null;
  commissionEnglishY1Value: number | null;
  commissionEnglishY2Type: CommissionType | null;
  commissionEnglishY2Value: number | null;
}

export interface ResolvedRate {
  commissionType: CommissionType | null;
  commissionValue: number | null;
  source: RateSource;
}

/**
 * @param year 1 or 2 — which year's rate is being earned.
 *
 * NOTE ON "NO RATE ANYWHERE". 73 of 96 institutions currently have
 * commissionY1Value at its 0 default, which is indistinguishable from a genuine
 * 0% agreement. This function therefore reports `PROVIDER_DEFAULT` with value 0
 * rather than inventing a number — it never guesses, and the caller decides what
 * to do with a zero. `NONE` is reserved for a provider record that could not be
 * loaded at all.
 */
export function resolveCommissionRate(
  opts: { isEnglishLanguageCourse: boolean; year?: number },
  provider: ProviderRates | null,
): ResolvedRate {
  if (!provider) return { commissionType: null, commissionValue: null, source: 'NONE' };

  const year = opts.year === 2 ? 2 : 1;

  if (opts.isEnglishLanguageCourse) {
    const type = year === 2 ? provider.commissionEnglishY2Type : provider.commissionEnglishY1Type;
    const value = year === 2 ? provider.commissionEnglishY2Value : provider.commissionEnglishY1Value;
    // Value decides. A type with no value is an incomplete record, not a rate.
    if (value !== null && value !== undefined) {
      return { commissionType: type ?? 'PERCENTAGE', commissionValue: value, source: 'ENGLISH_COURSE' };
    }
  }

  return {
    commissionType: year === 2 ? provider.commissionY2Type : provider.commissionY1Type,
    commissionValue: year === 2 ? provider.commissionY2Value : provider.commissionY1Value,
    source: 'PROVIDER_DEFAULT',
  };
}
