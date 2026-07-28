// PR-I18N — shared file-size formatting. The NUMBER localises (Persian digits in
// fa, Latin in en — locked decision: Persian digits for counts), but the UNIT
// (B / KB / MB / GB) stays LATIN in both locales, consistent with how we keep
// other acronyms (INZ, PDF, NZD) Latin. Style: "1.5 MB" / "۱٫۵ MB".
//
// One helper so every uploader across the visa + admission forms shows sizes the
// same way, with a single place to change the convention later.

export type ByteLocale = 'en' | 'fa';

export function formatBytes(bytes: number, locale: ByteLocale = 'en'): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = b;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  // Whole bytes show no decimals; KB+ show one decimal unless it rounds clean.
  const maxFractionDigits = i === 0 ? 0 : 1;
  const num = n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-NZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  return `${num} ${units[i]}`;
}
