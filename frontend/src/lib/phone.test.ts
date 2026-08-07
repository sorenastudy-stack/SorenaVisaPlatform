/**
 * PR-COUNTRY-PHONE — the E.164 contract.
 *
 * The whole point of replacing six free-text phone inputs with one component is
 * that the string leaving the form is always well-formed, no matter which of
 * the ~240 countries the user picked or how they typed the number. These tests
 * assert exactly that, across the full catalogue rather than a few samples —
 * a per-country table is precisely where a hand-maintained map rots.
 */

import { describe, it, expect } from 'vitest';
import { composeE164, parseE164, isValidE164, E164_MAX_DIGITS, DIALLABLE_COUNTRIES } from './phone';
import { DIAL_CODES, getDialCode, getSearchableDialCodes } from './country-codes';

describe('composeE164 always produces a valid E.164 string', () => {
  it('holds for EVERY country in the catalogue', () => {
    const bad: string[] = [];
    for (const iso2 of DIALLABLE_COUNTRIES) {
      const out = composeE164(iso2, '021 555 1234');
      if (!isValidE164(out)) bad.push(`${iso2} → ${out}`);
    }
    expect(bad).toEqual([]);
  });

  it('holds for every country across messy real-world input shapes', () => {
    const inputs = ['0215551234', '+64 21 555 1234', '(021) 555-1234', '21.555.1234', '  21 555 1234  '];
    const bad: string[] = [];
    for (const iso2 of DIALLABLE_COUNTRIES) {
      for (const raw of inputs) {
        const out = composeE164(iso2, raw);
        if (out !== '' && !isValidE164(out)) bad.push(`${iso2} "${raw}" → ${out}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('prefixes the selected country’s calling code', () => {
    expect(composeE164('NZ', '21 555 1234')).toBe('+64215551234');
    expect(composeE164('IR', '912 345 6789')).toBe('+989123456789');
    expect(composeE164('GB', '7700 900123')).toBe('+447700900123');
  });

  it('drops the domestic trunk zero, the classic hand-typed mistake', () => {
    // "021…" is how a New Zealander dials at home; in E.164 the +64 replaces it.
    expect(composeE164('NZ', '021 555 1234')).toBe('+64215551234');
    expect(composeE164('IR', '0912 345 6789')).toBe('+989123456789');
    expect(composeE164('NZ', '0021 555 1234')).toBe('+64215551234');
  });

  it('keeps the trunk zero for Italy, where it is part of the number', () => {
    expect(composeE164('IT', '06 1234 5678')).toBe('+390612345678');
  });

  it('never exceeds the 15-digit E.164 ceiling', () => {
    const out = composeE164('NZ', '9'.repeat(40));
    expect(out.replace('+', '')).toHaveLength(E164_MAX_DIGITS);
    expect(isValidE164(out)).toBe(true);
  });

  it('returns empty (not a bare "+64") when there is no number', () => {
    // An untouched optional phone field must stay empty, or every lead would
    // arrive carrying a country code and nothing else.
    expect(composeE164('NZ', '')).toBe('');
    expect(composeE164('NZ', '   ')).toBe('');
    expect(composeE164('NZ', 'abc')).toBe('');
  });

  it('returns empty for an unknown country rather than guessing', () => {
    expect(composeE164('ZZ', '215551234')).toBe('');
    expect(composeE164(null, '215551234')).toBe('');
  });
});

describe('parseE164 hydrates an existing stored number', () => {
  it('round-trips everything composeE164 produces, for every country', () => {
    const bad: string[] = [];
    for (const iso2 of DIALLABLE_COUNTRIES) {
      const composed = composeE164(iso2, '215551234');
      const parsed = parseE164(composed);
      // The country may come back as a different member of a shared calling
      // code (US for +1, GB for +44) — what must hold is that recomposing
      // gives the identical string.
      if (!parsed || composeE164(parsed.iso2, parsed.national) !== composed) {
        bad.push(`${iso2}: ${composed} → ${JSON.stringify(parsed)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('reads the free-text formats the six replaced fields actually contain', () => {
    expect(parseE164('+64 21 555 1234')).toEqual({ iso2: 'NZ', national: '215551234' });
    expect(parseE164('+98-912-345-6789')).toEqual({ iso2: 'IR', national: '9123456789' });
    expect(parseE164('0064 21 555 1234')).toEqual({ iso2: 'NZ', national: '215551234' });
  });

  it('prefers the longest matching calling code', () => {
    // +1264 is Anguilla, not the US (+1) followed by "264…".
    expect(parseE164('+12645551234')?.iso2).toBe('AI');
    expect(parseE164('+12125551234')?.iso2).toBe('US');
  });

  it('returns null when nothing can be identified', () => {
    expect(parseE164('')).toBeNull();
    expect(parseE164(null)).toBeNull();
    expect(parseE164('not a phone')).toBeNull();
  });
});

describe('the dial-code catalogue itself', () => {
  it('covers every country the country dropdown can show', () => {
    // Guards the failure mode where i18n-iso-countries adds a territory and the
    // phone picker silently drops it.
    const missing = getSearchableDialCodes('en').filter((c) => !getDialCode(c.code));
    expect(missing).toEqual([]);
  });

  it('holds only digit strings, with no leading "+" or zero', () => {
    const bad = Object.entries(DIAL_CODES).filter(([, d]) => !/^[1-9]\d{0,3}$/.test(d));
    expect(bad).toEqual([]);
  });

  it('is searchable by calling code as well as by name', () => {
    const cat = getSearchableDialCodes('en');
    expect(cat.find((c) => c.code === 'NZ')!.searchText).toContain('+64');
    expect(cat.filter((c) => c.searchText.includes('+98')).map((c) => c.code)).toContain('IR');
  });
});
