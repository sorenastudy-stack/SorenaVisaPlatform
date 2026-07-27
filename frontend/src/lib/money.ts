// PR-I18N — shared money formatting. Amounts stay in LATIN digits in both English
// and Persian (locked decision: Persian digits for prose/dates, but Latin for
// money, account numbers, client IDs, and reference codes — so financial figures
// copy-paste cleanly and can't be mis-transcribed). Code style: "NZD 1,200.00".
//
// One helper, so every amount across the client portal reads the same and there is
// a single place to change the convention later.

export function formatMoney(amount: number, currency = 'NZD'): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${currency.toUpperCase()} ${n.toLocaleString('en-NZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Convenience for the many APIs that carry integer cents.
export function formatMoneyCents(cents: number, currency = 'NZD'): string {
  return formatMoney((cents ?? 0) / 100, currency);
}
