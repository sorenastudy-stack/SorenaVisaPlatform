import PDFDocument from 'pdfkit';
import type { NextActionContent } from '../scoring/routing';
import { BRAND } from './branding';
import {
  drawSectionTitle, drawProgressBar, drawBullet,
  drawCoverBand, formatDateOnly, renderFooterOnAllPages,
  bidi, measure, type ReportStyle,
} from './helpers';
// Single source of truth — the canonical engine maxima (drift fix). The NAMES
// now come from the copy table so they can be translated; the English side of
// that table is identical to CATEGORY_NAMES and a test asserts it stays so.
import { CATEGORY_MAX } from '../scoring/scores';
import { REPORT_COPY, type ReportLocale } from './client-report.copy';
import { registerPersianFonts, VAZIR } from './fonts';

// PR-SCORECARD-3 — Client-facing scorecard PDF.
//
// Ported from Sorena_Scoring_Reference/client_report.py to PDFKit.
// Warm, non-mechanical tone. NO hard-stop codes, NO gate logic,
// NO point values, NO risk-flag labels. The reader sees their
// score, their band's plain-language meaning, their personalised
// next-action paragraph + bullets, and the "About Sorena Visa"
// closing.
//
// The cover headline / body / next-action bullets are derived from
// the structured `nextActionContent` written at submit time, with
// a per-band fallback for legacy rows.
//
// PR-PERSIAN-CLIENT-REPORT — the document now renders in English or Persian,
// chosen from Contact.preferredLanguage. Every literal moved to
// client-report.copy.ts; the English half is a verbatim lift, so an English
// report is byte-for-byte what it was before. Persian additionally:
//   • embeds Vazirmatn (see fonts.ts — Helvetica has no Persian glyphs),
//   • right-aligns and mirrors the row furniture via ReportStyle,
//   • uses the LIGHT weight where English uses italic (Persian has no italic),
//   • wraps Latin runs in U+200E so acronyms don't print reversed.

export interface ClientReportData {
  applicant: {
    fullName: string;
    submittedAt: string;
  };
  totalScore: number;
  band: string;           // "BAND_3" etc.
  bandName: string;       // human-readable
  bandRange: string;      // e.g. "Band 3 — 41-60"
  categoryScores: Record<number, number>;
  hasHardStops: boolean;
  nextActionContent: NextActionContent | null;
  nextActionTextEn: string;
  shouldShowMalaysiaCallout: boolean;
  /** Defaults to English, so every existing caller is unchanged. */
  locale?: ReportLocale;
}

type BandKey = 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6' | 'DEFAULT';

/** Band key for the copy tables, collapsing hard stops to their own entry. */
function bandKey(band: string, hasHardStops: boolean): BandKey | 'HARD_STOP' {
  if (hasHardStops) return 'HARD_STOP';
  const known: BandKey[] = ['BAND_1', 'BAND_2', 'BAND_3', 'BAND_4', 'BAND_5', 'BAND_6'];
  return (known as string[]).includes(band) ? (band as BandKey) : 'DEFAULT';
}

export async function renderClientReport(data: ClientReportData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const locale: ReportLocale = data.locale ?? 'en';
    const t = REPORT_COPY[locale];
    const rtl = locale === 'fa';

    const doc = new PDFDocument({
      size: BRAND.PAGE.SIZE,
      margins: {
        top: BRAND.PAGE.MARGIN,
        bottom: BRAND.PAGE.MARGIN + 8,
        left: BRAND.PAGE.MARGIN,
        right: BRAND.PAGE.MARGIN,
      },
      bufferPages: true,
      info: {
        Title:    `Your Sorena Pathway — ${data.applicant.fullName}`,
        Author:   'Sorena Visa',
        Subject:  'Your Readiness Assessment',
        Creator:  'Sorena Visa Platform',
        Producer: 'Sorena Visa Platform · pdfkit',
      },
    });

    // Fonts are registered ONLY for Persian: an English render never touches
    // pdfkit's font table and so is unchanged byte-for-byte.
    if (rtl) registerPersianFonts(doc);
    const style: ReportStyle = {
      fonts: rtl
        ? { body: VAZIR.BODY, bold: VAZIR.BOLD, soft: VAZIR.LIGHT }
        : { body: BRAND.FONTS.BODY, bold: BRAND.FONTS.BOLD, soft: BRAND.FONTS.ITALIC },
      rtl,
      locale,
    };
    const align = rtl ? 'right' : 'left';
    const B = (s: string) => bidi(s, style);

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const firstName = (data.applicant.fullName || '').trim().split(/\s+/)[0] || 'there';
    const key = bandKey(data.band, data.hasHardStops);

    // ─── PAGE 1 — Cover + warm greeting + score badge ─────────────
    const headline = key === 'DEFAULT'
      ? (locale === 'fa' ? `سلام ${firstName}` : `Hello ${firstName}`)
      : t.coverHeadline[key];

    drawCoverBand(doc, {
      sublabel:   t.coverSublabel,
      headline,
      appliedFor: t.preparedFor(data.applicant.fullName || (locale === 'fa' ? 'شما' : 'You')),
      dateText:   formatDateOnly(data.applicant.submittedAt, locale),
      height:     220,
    }, style);

    // Score badge — simpler than internal: no hard-stop count, no
    // execution flag mechanics. Just "Your score" + band + slogan.
    const margins = doc.page.margins;
    const width = doc.page.width;
    const contentW = width - margins.left - margins.right;
    const cardY = doc.y;
    const cardH = 110;

    doc.save();
    doc.rect(margins.left, cardY, contentW, cardH)
       .fillAndStroke(BRAND.COLORS.OFF_WHITE, BRAND.COLORS.PALETTE.GRAYLIGHT);
    doc.rect(margins.left, cardY, contentW, 3).fill(BRAND.COLORS.GOLD);

    // The card has two zones — the score on the leading edge, the band detail
    // beside it. Under RTL both move to the mirrored side.
    const scoreX = rtl ? margins.left + contentW - 24 - 90 : margins.left + 24;
    const detailX = rtl ? margins.left + 24 : margins.left + 160;
    const detailW = contentW - 170;

    // Big score.
    doc.fillColor(BRAND.COLORS.NAVY).font(style.fonts.bold).fontSize(48);
    doc.text(B(String(data.totalScore)), scoreX, cardY + 24, { lineBreak: false });
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.body).fontSize(10);
    doc.text(B(t.outOf), scoreX, cardY + 78, { lineBreak: false });

    // Band line + plain-language summary.
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.body).fontSize(9);
    doc.text(B(t.bandLabel), detailX, cardY + 24, { lineBreak: false });
    doc.fillColor(BRAND.COLORS.NAVY).font(style.fonts.bold).fontSize(14);
    doc.text(B(data.bandName), detailX, cardY + 38, {
      lineBreak: false, width: detailW,
    });
    // English italic ⇒ Persian LIGHT (passage 1 of 4).
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.soft).fontSize(9.5);
    doc.text(B(t.bandMeaning[key]), detailX, cardY + 60, {
      width: detailW, align,
    });
    doc.restore();
    doc.x = margins.left;
    doc.y = cardY + cardH + 20;

    // ─── PAGE 2 — Warm message + your strengths ──────────────────
    doc.addPage();
    drawSectionTitle(doc, t.sections.readiness[0], t.sections.readiness[1], style);

    // Greeting paragraph.
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(style.fonts.body).fontSize(11);
    doc.text(B(t.intro[key](firstName)), margins.left, doc.y, {
      width: contentW, align, lineGap: 3,
    });
    doc.moveDown(0.8);

    drawSectionTitle(doc, t.sections.strengths[0], t.sections.strengths[1], style);
    for (const c of [1, 2, 3, 4] as const) {
      const sc = data.categoryScores[c] ?? 0;
      drawProgressBar(doc, t.categoryNames[c], sc, CATEGORY_MAX[c], undefined, style);
    }
    doc.moveDown(0.6);
    // English italic ⇒ Persian LIGHT (passage 2 of 4).
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.soft).fontSize(9.5);
    doc.text(B(t.strengthsNote), margins.left, doc.y, { width: contentW, lineGap: 2, align });

    // ─── PAGE 3 — Your next steps ────────────────────────────────
    doc.addPage();
    drawSectionTitle(doc, t.sections.nextSteps, undefined, style);

    // Heading + lead-in + bullets, ported from nextActionContent.
    //
    // NOTE — this block is the scoring engine's own advice text, which exists
    // only in English (inventory item 2, deferred). A Persian report therefore
    // carries English here. It is still wrapped in bidi() so it reads
    // left-to-right rather than reversed inside the RTL page.
    const nc = data.nextActionContent;
    if (nc) {
      if (nc.leadIn) {
        doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.body).fontSize(10.5);
        doc.text(B(nc.leadIn), margins.left, doc.y, { width: contentW, lineGap: 2, align });
        doc.moveDown(0.5);
      }
      doc.fillColor(BRAND.COLORS.NAVY).font(style.fonts.bold).fontSize(12);
      doc.text(B(nc.heading), margins.left, doc.y, { width: contentW, align });
      doc.moveDown(0.4);
      for (const b of nc.bullets) drawBullet(doc, b, BRAND.COLORS.PALETTE.NAVY_DEEP, style);
    } else {
      // Legacy: nextActionContent is null. Fall back to the flat
      // English text written by the engine.
      doc.fillColor(BRAND.COLORS.NAVY).font(style.fonts.bold).fontSize(11.5);
      doc.text(B(data.nextActionTextEn), margins.left, doc.y, { width: contentW, align });
    }

    doc.moveDown(0.8);

    // Pathway notes by scenario.
    drawPathwayNotes(doc, data, t, style);

    // Dual-country callout (Bands 4-6, NOT showing hard stops).
    if (data.shouldShowMalaysiaCallout && !data.hasHardStops) {
      doc.addPage();
      drawDualCountryPage(doc, t, style);
    }

    // ─── Final page — About Sorena Visa ──────────────────────────
    doc.addPage();
    drawSectionTitle(doc, t.sections.about, undefined, style);
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(style.fonts.body).fontSize(11);
    doc.text(B(t.about.p1), margins.left, doc.y, { width: contentW, lineGap: 3, align });
    doc.moveDown(0.8);
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(style.fonts.body).fontSize(11);
    doc.text(B(t.about.p2), margins.left, doc.y, { width: contentW, lineGap: 3, align });
    doc.moveDown(1.0);

    // Closing.
    doc.save();
    const ruleStart = rtl ? margins.left + contentW : margins.left;
    const ruleEnd = rtl ? margins.left + contentW - 60 : margins.left + 60;
    doc.moveTo(ruleStart, doc.y).lineTo(ruleEnd, doc.y)
       .lineWidth(0.8).strokeColor(BRAND.COLORS.GOLD).stroke();
    doc.restore();
    doc.moveDown(0.6);
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.body).fontSize(10.5);
    doc.text(B(t.about.closing), margins.left, doc.y, { width: contentW, lineGap: 2, align });
    doc.moveDown(0.8);
    doc.fillColor(BRAND.COLORS.NAVY).font(style.fonts.bold).fontSize(11);
    doc.text(B(t.about.team), margins.left, doc.y, { width: contentW, align });
    doc.moveDown(0.2);
    // English italic ⇒ Persian LIGHT (passage 3 of 4). "ICEF" here is exactly
    // the kind of Latin run that reverses without the LRM wrap.
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(style.fonts.soft).fontSize(9.5);
    doc.text(B(t.about.credential), margins.left, doc.y, { width: contentW, align });

    // ─── Footers on every page ────────────────────────────────────
    renderFooterOnAllPages(doc, 'client', data.applicant.submittedAt, style, t.footer);
    doc.end();
  });
}

// ─── Copy helpers ────────────────────────────────────────────────

type Copy = typeof REPORT_COPY['en'];

function drawPathwayNotes(
  doc: PDFKit.PDFDocument, data: ClientReportData, t: Copy, style: ReportStyle,
): void {
  const margins = doc.page.margins;
  const width = doc.page.width;
  const contentW = width - margins.left - margins.right;

  let note: string;
  if (data.hasHardStops) {
    note = t.pathwayNote.hardStop();
  } else if (data.band === 'BAND_1' || data.band === 'BAND_2') {
    note = t.pathwayNote.foundation;
  } else if (data.band === 'BAND_3') {
    note = t.pathwayNote.gapClosing;
  } else {
    note = t.pathwayNote.standard;
  }
  doc.save();
  // Persian runs longer than the English it replaces, and these callouts were
  // fixed-height. Measured under RTL only — and the font is selected inside the
  // branch too, because doing it unconditionally emits an extra PDF operator and
  // the English report is asserted byte-for-byte.
  let noteH = 70;
  if (style.rtl) {
    doc.font(style.fonts.body).fontSize(10);
    noteH = Math.max(70, 12 + doc.heightOfString(bidi(note, style), { width: contentW - 24, lineGap: 2 }) + 12);
  }
  const noteTop = doc.y;
  doc.rect(margins.left, noteTop, contentW, noteH).fill(BRAND.COLORS.OFF_WHITE);
  // The gold spine sits on the leading edge of the callout.
  doc.rect(style.rtl ? margins.left + contentW - 3 : margins.left, noteTop, 3, noteH).fill(BRAND.COLORS.GOLD);
  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(style.fonts.body).fontSize(10);
  doc.text(bidi(note, style), margins.left + 12, noteTop + 12, {
    width: contentW - 24, height: noteH - 10, lineGap: 2, align: style.rtl ? 'right' : 'left',
  });
  doc.restore();
  doc.y = noteTop + noteH + 10;
  doc.x = margins.left;
}

function drawDualCountryPage(doc: PDFKit.PDFDocument, t: Copy, style: ReportStyle): void {
  const margins = doc.page.margins;
  const width = doc.page.width;
  const contentW = width - margins.left - margins.right;
  const align = style.rtl ? 'right' : 'left';

  drawSectionTitle(doc, t.sections.dualCountry, undefined, style);

  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(style.fonts.body).fontSize(11);
  doc.text(bidi(t.dualCountry.intro, style), margins.left, doc.y, {
    width: contentW, lineGap: 3, align,
  });
  doc.moveDown(0.8);

  // Two columns. Reading order is leading-edge first, so the columns swap
  // under RTL and New Zealand stays the one the reader meets first.
  const colW = (contentW - 16) / 2;
  const colH = 165;
  const startY = doc.y;
  const nearX = style.rtl ? margins.left + colW + 16 : margins.left;
  const farX = style.rtl ? margins.left : margins.left + colW + 16;
  drawCountryColumn(doc, nearX, startY, colW, colH, t.dualCountry.nz, style);
  drawCountryColumn(doc, farX, startY, colW, colH, t.dualCountry.my, style);
  doc.y = startY + colH + 16;
  doc.x = margins.left;

  // Philosophy callout. Same fixed-height problem as the pathway note — the
  // Persian body overflowed the navy panel — so it is measured under RTL only.
  const callY = doc.y;
  let callH = 90;
  if (style.rtl) {
    doc.font(style.fonts.body).fontSize(9.5);
    callH = Math.max(90, 50 + doc.heightOfString(bidi(t.dualCountry.philosophyBody, style), { width: contentW - 32, lineGap: 2 }) + 14);
  }
  doc.save();
  doc.rect(margins.left, callY, contentW, callH).fill(BRAND.COLORS.NAVY);
  doc.rect(margins.left, callY, contentW, 3).fill(BRAND.COLORS.GOLD);
  const put = (text: string, y: number, size: number, color: string, font: string) => {
    doc.fillColor(color).font(font).fontSize(size);
    const s = bidi(text, style);
    const x = style.rtl
      ? margins.left + contentW - 16 - measure(doc, s)
      : margins.left + 16;
    doc.text(s, x, y, { lineBreak: false, width: contentW - 32 });
  };
  put(t.dualCountry.philosophyLabel, callY + 12, 10.5, BRAND.COLORS.GOLD, style.fonts.bold);
  put(t.dualCountry.philosophyHeadline, callY + 30, 13, '#FFFFFF', style.fonts.bold);
  doc.fillColor('#FFFFFF').font(style.fonts.body).fontSize(9.5);
  doc.text(bidi(t.dualCountry.philosophyBody, style), margins.left + 16, callY + 50,
    { width: contentW - 32, lineGap: 2, align });
  doc.restore();
  doc.x = margins.left;
  doc.y = callY + callH + 14;
}

function drawCountryColumn(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  c: { name: string; sub: string; points: string[] },
  style: ReportStyle,
): void {
  doc.save();
  doc.rect(x, y, w, h).fillAndStroke(BRAND.COLORS.OFF_WHITE, BRAND.COLORS.PALETTE.GRAYLIGHT);
  doc.rect(x, y, w, 3).fill(BRAND.COLORS.GOLD);
  const put = (text: string, ty: number, size: number, color: string, font: string) => {
    doc.fillColor(color).font(font).fontSize(size);
    const s = bidi(text, style);
    const tx = style.rtl ? x + w - 14 - measure(doc, s) : x + 14;
    doc.text(s, tx, ty, { lineBreak: false, width: w - 28 });
  };
  put(c.name, y + 14, 13, BRAND.COLORS.NAVY, style.fonts.bold);
  // English italic ⇒ Persian LIGHT (passage 4 of 4).
  put(c.sub, y + 32, 9, BRAND.COLORS.PALETTE.WARMGRAY, style.fonts.soft);
  let yy = y + 52;
  for (const pt of c.points) {
    const dotX = style.rtl ? x + w - 20 : x + 20;
    doc.fillColor(BRAND.COLORS.GOLD).circle(dotX, yy + 4, 1.4).fill();
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(style.fonts.body).fontSize(9.5);
    const s = bidi(pt, style);
    const tx = style.rtl ? x + w - 28 - measure(doc, s) : x + 28;
    doc.text(s, tx, yy, { lineBreak: false, width: w - 36 });
    yy += 18;
  }
  doc.restore();
}
