import { renderClientReport, type ClientReportData } from './client-report';
import { REPORT_COPY, resolveReportLocale } from './client-report.copy';
import { padScriptBoundaries, formatDateOnly } from './helpers';
import { CATEGORY_NAMES } from '../scoring/scores';
import { persianFontFilesPresent } from './fonts';

// PR-PERSIAN-CLIENT-REPORT — regression guards for the client report.
//
// These lock the things that were expensive to discover, and each one fails if
// the specific mistake is made again rather than testing the happy path.

const base = (locale?: 'en' | 'fa'): ClientReportData => ({
  applicant: { fullName: 'Maryam Karimi', submittedAt: '2026-08-17T02:30:00.000Z' },
  totalScore: 72,
  band: 'BAND_4',
  bandName: 'Ready to Proceed',
  bandRange: 'Band 4 — 61-75',
  categoryScores: { 1: 15, 2: 26, 3: 19, 4: 12 },
  hasHardStops: false,
  nextActionContent: { leadIn: 'Lead in.', heading: 'Book your consultation', bullets: ['One', 'Two'] },
  nextActionTextEn: 'Book your consultation.',
  shouldShowMalaysiaCallout: true,
  ...(locale ? { locale } : {}),
});

describe('client report — locale selection', () => {
  it('switches to Persian only for fa', () => {
    expect(resolveReportLocale('fa')).toBe('fa');
    expect(resolveReportLocale('FA')).toBe('fa');
    expect(resolveReportLocale(' fa ')).toBe('fa');
    // 'vi' exists in the contact table and must NOT get a Persian report.
    expect(resolveReportLocale('vi')).toBe('en');
    expect(resolveReportLocale('en')).toBe('en');
    expect(resolveReportLocale(null)).toBe('en');
    expect(resolveReportLocale(undefined)).toBe('en');
  });
});

describe('client report — the English document must not drift', () => {
  it('category names still match the scoring engine verbatim', () => {
    // These were inlined from CATEGORY_NAMES when the copy table was created.
    expect(REPORT_COPY.en.categoryNames).toEqual(CATEGORY_NAMES);
  });

  it('keeps the exact English wording that clients already receive', () => {
    const en = REPORT_COPY.en;
    expect(en.coverSublabel).toBe('YOUR PERSONAL PATHWAY RECOMMENDATION');
    expect(en.bandMeaning.BAND_4).toBe('You meet the requirements. Time to choose your destination.');
    expect(en.strengthsNote).toBe(
      'Every area has room to grow. The areas where you scored highest are your launchpad - the areas where you scored lower are the targets for our next conversation.',
    );
    expect(en.about.credential).toBe('Licensed Education Counsellor - ICEF Registered Agent - Auckland, New Zealand');
    expect(en.sections.dualCountry).toBe('TWO DESTINATIONS - YOUR CHOICE');
    expect(en.footer.page(2, 5)).toBe('Page 2 of 5');
  });

  it('embeds no font at all — English stays on the pdfkit base-14', async () => {
    const pdf = (await renderClientReport(base('en'))).toString('latin1');
    expect(pdf).toContain('Helvetica');
    expect(pdf).not.toContain('Vazirmatn');
  });

  it('renders identically whether the locale is omitted or explicitly en', async () => {
    const strip = (b: Buffer) =>
      b.toString('latin1').replace(/\(D:\d{14}Z?\)/g, 'D').replace(/\/ID \[[^\]]*\]/g, 'ID');
    expect(strip(await renderClientReport(base()))).toBe(strip(await renderClientReport(base('en'))));
  });
});

describe('client report — Persian', () => {
  it('ships the three Vazirmatn weights', () => {
    expect(persianFontFilesPresent()).toBe(true);
  });

  it('embeds the font and produces a substantially larger file', async () => {
    const fa = await renderClientReport(base('fa'));
    const en = await renderClientReport(base('en'));
    expect(fa.toString('latin1')).toContain('Vazirmatn');
    expect(fa.length).toBeGreaterThan(en.length);
  });

  // The bug: Arabic-Indic digits are reversed by the RTL layout ("۱۷" → "۷۱")
  // and U+200E does not rescue them. Every numeral must therefore be ASCII.
  it('uses Latin numerals everywhere — Persian digits render reversed', () => {
    const persianDigits = /[\u06F0-\u06F9\u0660-\u0669]/;
    const walk = (v: unknown): string[] =>
      typeof v === 'string' ? [v]
        : typeof v === 'function' ? [String((v as (...a: any[]) => string)('X'))]
        : Array.isArray(v) ? v.flatMap(walk)
        : v && typeof v === 'object' ? Object.values(v).flatMap(walk)
        : [];
    const offenders = walk(REPORT_COPY.fa).filter((s) => persianDigits.test(s));
    expect(offenders).toEqual([]);
  });

  // The bug: pdfkit does not mirror paired punctuation for RTL, so brackets
  // render swapped and attached to the wrong words.
  it('uses no parentheses in Persian copy — they render mirrored', () => {
    const strings = [
      REPORT_COPY.fa.dualCountry.nz.points,
      REPORT_COPY.fa.dualCountry.my.points,
      [REPORT_COPY.fa.pathwayNote.hardStop(), REPORT_COPY.fa.pathwayNote.standard],
      [REPORT_COPY.fa.about.credential, REPORT_COPY.fa.strengthsNote],
    ].flat();
    expect(strings.filter((s) => /[()]/.test(s))).toEqual([]);
  });

  it('keeps dates Gregorian with Latin numerals', () => {
    const fa = formatDateOnly('2026-08-17T02:30:00.000Z', 'fa');
    expect(fa).toMatch(/\d/);                       // Latin digits, not ۱۷
    expect(fa).not.toMatch(/[\u06F0-\u06F9]/);
    // "اوت" is Gregorian August; a Jalali rendering would say "مرداد".
    expect(fa).toContain('اوت');
    expect(fa).toContain('2026');
    expect(formatDateOnly('2026-08-17T02:30:00.000Z', 'en')).toBe('17 August 2026');
  });
});

describe('padScriptBoundaries', () => {
  it('doubles the space at a Persian/Latin boundary', () => {
    expect(padScriptBoundaries('تاریخ صدور: 17 اوت')).toBe('تاریخ صدور:  17 اوت');
  });

  it('leaves the space INSIDE a Latin run alone', () => {
    // Doubling here visibly widened the applicant's own name.
    expect(padScriptBoundaries('برای: Maryam Karimi')).toBe('برای:  Maryam Karimi');
  });

  it('pads an em-dash between Persian words', () => {
    expect(padScriptBoundaries('اعتبار جهانی — مسیر')).toBe('اعتبار جهانی  —  مسیر');
  });

  it('is a no-op for plain English', () => {
    const s = 'Licensed Education Counsellor - ICEF Registered Agent';
    expect(padScriptBoundaries(s)).toBe(s);
  });
});
