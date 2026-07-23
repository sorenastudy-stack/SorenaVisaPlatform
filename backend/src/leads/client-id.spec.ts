/**
 * PR-CLIENT-ID — unit tests for the network-free parts of client-id generation:
 * country-name → alpha-2 resolution and the {COUNTRY}-{YEAR}-{NNNNNN} format.
 * The atomic counter (nextClientNumber) is proven separately against the DB.
 */

import { resolveCountryCode, formatClientId } from './client-id';

describe('resolveCountryCode', () => {
  it('maps free-text country names to alpha-2', () => {
    expect(resolveCountryCode({ countryOfResidence: 'New Zealand' })).toBe('NZ');
    expect(resolveCountryCode({ countryOfResidence: 'Iran' })).toBe('IR');
    expect(resolveCountryCode({ countryOfResidence: 'Australia' })).toBe('AU');
    expect(resolveCountryCode({ countryOfResidence: 'Canada' })).toBe('CA');
  });

  it('remaps United Kingdom → UK (not GB) per spec', () => {
    expect(resolveCountryCode({ countryOfResidence: 'United Kingdom' })).toBe('UK');
  });

  it('is case/space tolerant', () => {
    expect(resolveCountryCode({ countryOfResidence: '  new zealand ' })).toBe('NZ');
  });

  it('falls back to targetCountry, then countryRaw, in priority order', () => {
    expect(resolveCountryCode({ targetCountry: 'NEW_ZEALAND' })).toBe('NZ');
    expect(resolveCountryCode({ targetCountry: 'MALAYSIA' })).toBe('MY');
    // countryOfResidence wins over targetCountry
    expect(resolveCountryCode({ countryOfResidence: 'Australia', targetCountry: 'NEW_ZEALAND' })).toBe('AU');
    // countryRaw is last
    expect(resolveCountryCode({ countryRaw: 'Iran' })).toBe('IR');
  });

  it('returns null for empty / unmappable input (caller uses XX fallback)', () => {
    expect(resolveCountryCode({})).toBeNull();
    expect(resolveCountryCode({ countryOfResidence: '' })).toBeNull();
    expect(resolveCountryCode({ countryOfResidence: 'chili' })).toBeNull(); // typo → unmappable
    expect(resolveCountryCode({ countryOfResidence: 'Narnia' })).toBeNull();
  });
});

describe('formatClientId', () => {
  it('zero-pads the number to 6 digits', () => {
    expect(formatClientId('NZ', 2026, 1)).toBe('NZ-2026-000001');
    expect(formatClientId('AU', 2026, 42)).toBe('AU-2026-000042');
    expect(formatClientId('IR', 2027, 123456)).toBe('IR-2027-123456');
  });

  it('does not truncate a number beyond 6 digits', () => {
    expect(formatClientId('NZ', 2026, 1000000)).toBe('NZ-2026-1000000');
  });
});
