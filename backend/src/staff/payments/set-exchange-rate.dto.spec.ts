import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SetExchangeRateDto, RATE_MAX_DECIMALS } from './dto/set-exchange-rate.dto';

/**
 * PR-FX-VALIDATION — what the rate form accepts, and what it says when it does not.
 *
 * A Finance Admin entered 1.70327893 and was told "rate must be a number
 * conforming to the specified constraints" — class-validator's default text for
 * maxDecimalPlaces, which names no constraint and does not say what to do. The
 * limit itself was right: `exchange_rates.rate` is Decimal(12,6), so a seventh
 * decimal place is not stored, it is rounded away by Postgres. Accepting it
 * would have meant reporting a save of a number the invoices would not carry.
 *
 * So these tests pin two things together: the boundary stays where the column
 * is, and every rejection says something a person can act on.
 */

function check(rate: unknown) {
  const dto = plainToInstance(SetExchangeRateDto, { rate });
  const errors = validateSync(dto);
  return {
    ok: errors.length === 0,
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('SetExchangeRateDto', () => {
  it('accepts the rate that was rejected in production, at the decimal limit', () => {
    // 1.703279 — the reported 1.70327893 trimmed to what the column stores.
    expect(check(1.703279).ok).toBe(true);
  });

  it('accepts the seeded rate, which sits exactly on the limit', () => {
    // 1.698185 is six places. If the constraint had ever been tightened below
    // six, the row already in the table would have become unenterable.
    expect(check(1.698185).ok).toBe(true);
  });

  it.each([1, 1.7, 1.70, 1.703, 1.7032, 1.70327, 1.703279])(
    'accepts %p — up to six decimal places',
    (v) => expect(check(v).ok).toBe(true),
  );

  it('rejects a seventh decimal place, and says exactly that', () => {
    const r = check(1.7032789);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toBe(
      `Enter a rate with up to ${RATE_MAX_DECIMALS} decimal places (for example 1.703279).`,
    );
    // The message the Finance user actually saw must not come back.
    expect(r.messages.join(' ')).not.toMatch(/conforming to the specified constraints/);
  });

  it('rejects the exact value from the bug report', () => {
    const r = check(1.70327893);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toMatch(/up to 6 decimal places/);
  });

  describe('genuinely invalid input still refused, in plain words', () => {
    it('zero', () => {
      const r = check(0);
      expect(r.ok).toBe(false);
      expect(r.messages.join(' ')).toMatch(/at least 0\.01/);
    });

    it('negative', () => {
      const r = check(-1.5);
      expect(r.ok).toBe(false);
      expect(r.messages.join(' ')).toMatch(/at least 0\.01/);
    });

    it('above the typo guard', () => {
      const r = check(1001);
      expect(r.ok).toBe(false);
      expect(r.messages.join(' ')).toMatch(/1000 or less/);
    });

    it.each([['text', 'abc'], ['empty string', ''], ['null', null], ['undefined', undefined], ['NaN', NaN]])(
      '%s',
      (_label, v) => {
        const r = check(v);
        expect(r.ok).toBe(false);
        expect(r.messages.length).toBeGreaterThan(0);
      },
    );

    it('no rejection message is class-validator boilerplate', () => {
      // The whole point of the fix: whatever the reason, the reader gets a
      // sentence about the rate, not about "constraints".
      for (const v of [0, -1, 1001, 1.7032789, 'abc', '', null]) {
        for (const m of check(v).messages) {
          expect(m).not.toMatch(/conforming to the specified constraints/);
          expect(m).toMatch(/rate/i);
        }
      }
    });
  });
});
