import type PDFKit from 'pdfkit';
import { BRAND, bandColor } from './branding';

// PR-SCORECARD-3 — Reusable PDF drawing helpers.
//
// Both renderers (internal + client) compose layouts out of these
// helpers. They operate on a stateful PDFKit document and use its
// top-down coordinate system (y=0 at the top of the page).
//
// All helpers are pure draw-side: they read `doc.y` to position
// where needed, and update `doc.y` (or call `doc.moveDown(...)`) so
// the caller can chain.

type Doc = PDFKit.PDFDocument;

// ─── Locale / direction style ─────────────────────────────────────
//
// PR-PERSIAN-CLIENT-REPORT — the client report renders in English or Persian;
// the internal report is English-only. Rather than fork the helpers, each one
// takes an optional style whose default is EXACTLY the previous behaviour, so
// every existing caller is unaffected and the English output is unchanged.
//
// `soft` is the quieter, secondary face: Helvetica-Oblique in English, and the
// Vazirmatn LIGHT weight in Persian — Persian script has no italic, and bold
// would turn a soft aside into emphasis.

export interface ReportStyle {
  fonts: { body: string; bold: string; soft: string };
  rtl: boolean;
  locale: 'en' | 'fa';
}

export const DEFAULT_STYLE: ReportStyle = {
  fonts: { body: BRAND.FONTS.BODY, bold: BRAND.FONTS.BOLD, soft: BRAND.FONTS.ITALIC },
  rtl: false,
  locale: 'en',
};

// ── Why there is no U+200E (LRM) here ────────────────────────────────────
//
// LRM was implemented, rendered, and removed on the evidence. pdfkit does no
// bidi, so the expectation was that an embedded Latin run would print reversed
// ("ICEF" as "FECI") unless bracketed in LRM — which is what happens under
// Calibri. Under VAZIRMATN, the font actually shipped, it does not: Latin runs
// lay out left-to-right on their own, and pages rendered with and without LRM
// were pixel-identical. It was carried for a while as "harmless insurance",
// which is exactly the sort of thing that reads as a working safeguard when it
// is inert. It is gone; this comment is the record.
//
// What DOES need handling is the space at a script boundary. See below.

// A space that sits between Arabic-script text and a Latin/digit run is not
// dropped — it is MOVED to the far side of that run when the line is reversed,
// which glues two words together and leaves a double gap elsewhere:
//
//   "تاریخ صدور: 17 اوت 2026"  →  "2026اوت  17صدور: تاریخ"
//                                      ^^ joined      ^^ joined
//
// Doubling the boundary space gives the shuffle one to move and one to leave
// behind, so every word stays separated. Restricted to TRUE boundaries: the
// space inside "Maryam Karimi" is not one, and doubling it visibly widened the
// applicant's own name.
//
// Alternatives tested and rejected, all by rendering and reading the page:
//   • NBSP at boundaries — pins the whole string into one token, which makes it
//     render LEFT-to-right: "FECI", "imiraK mayraM". Much worse.
//   • NBSP on one side only — same collapse.
//   • LRM — no effect either way (above).
// An em-dash between two Persian words is a neutral character and gets the same
// treatment — one of its two spaces is absorbed, leaving "مسیر —جهانی". Padding
// both sides keeps it centred.
//
// NOTE for whoever writes Persian copy next: do NOT use parentheses. pdfkit does
// not mirror paired punctuation for RTL, so "(1 تا 3 سال)" renders with the
// brackets swapped and attached to the wrong words. The two strings that used
// them were rewritten with a comma instead.
// Keyed on ARABIC SCRIPT specifically, not merely "not Latin". The looser form
// also matched the hyphen in "Counsellor - ICEF", padding English text that
// passes through here inside a Persian report (the engine's advice paragraph
// is English even on a Persian page).
// The Arabic character may be followed by punctuation before the space —
// "تاریخ صدور: 17" has a colon in between — so trailing non-Latin punctuation is
// allowed inside the match. "Counsellor - ICEF" still does not match, because
// nothing Arabic precedes its hyphen.
const ARABIC = '\\u0600-\\u06FF\\u200C\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const BOUNDARY_SPACE = new RegExp(`([${ARABIC}][^\\sA-Za-z0-9]*) (?=[A-Za-z0-9])`, 'g');
const DASH_SPACES = / (—|–) /g;

export function padScriptBoundaries(text: string): string {
  if (!text) return text;
  return text.replace(BOUNDARY_SPACE, '$1  ').replace(DASH_SPACES, '  $1  ');
}

/**
 * Prepare a string for RTL rendering: script-boundary padding, plus the
 * trailing-space guard.
 *
 * THE TRAILING SPACE IS NOT COSMETIC. pdfkit trims leading whitespace on a
 * line. fontkit reverses the glyph run for RTL, which moves the string's LAST
 * space into the leading position — where pdfkit then eats it. The result is
 * that exactly one space disappears per run, always between the final two
 * words: "مسیر پیشنهادی شخصی شما" renders as "...شخصی شما" joined into
 * "شماشخصی".
 *
 * Appending one space gives the trim something expendable to remove, and every
 * real space survives. Measured across every alternative:
 *   • all-spaces → NBSP  — keeps the spaces but renders the words LEFT-to-right
 *   • leading space      — trimmed, no effect
 *   • zero-width space   — no effect
 *   • trailing space     — correct spacing AND correct order
 *
 * Because the extra space ends up leading, pdfkit trims it away again and it
 * occupies no width — but `widthOfString` still counts it, so any caller
 * positioning text by measurement must measure `.trimEnd()`. See `measure()`.
 */
export function bidi(text: string, style: ReportStyle): string {
  return style.rtl ? `${padScriptBoundaries(text)} ` : text;
}

/** Width of a bidi()-prepared string, ignoring the trailing-space guard. */
export function measure(doc: Doc, preparedText: string): number {
  return doc.widthOfString(preparedText.trimEnd());
}

// NUMERALS STAY LATIN IN THE PERSIAN REPORT — load-bearing, not a style call.
//
// Measured through this exact pipeline (pdfkit + fontkit + Vazirmatn):
//
//   "تاریخ صدور: ۱۷ اوت ۲۰۲۶"   → renders "۷۱ اوت ۶۲۰۲"   (digits reversed)
//   "تاریخ صدور: 17 اوت 2026"   → renders "17 اوت 2026"   (correct)
//
// fontkit treats Arabic-Indic digits as part of the surrounding Arabic run and
// reverses them with it, while a Latin-script run inside the same string is
// laid out left-to-right on its own. Wrapping the Persian digits in U+200E does
// NOT help — verified rather than assumed: the LRM-wrapped and bare forms
// render identically. So Persian dates are formatted with `-nu-latn` (see
// formatDateOnly) and every score, percentage and page number stays ASCII.
//
// There is deliberately no digit-localising helper here: adding one is the
// obvious "improvement" that would silently break the document.

// ─── Header / footer ──────────────────────────────────────────────

interface HeaderOpts {
  /** When true, the navy band on the cover suppresses the standard
   *  page-top wordmark — used for the cover page only. */
  cover?: boolean;
}

export function drawHeader(doc: Doc, opts: HeaderOpts = {}): void {
  if (opts.cover) return;
  const { width, margins } = doc.page;
  doc.save();
  // Left — wordmark text. No width/align combination (see drawFooter
  // for the rationale — pdfkit's line wrapper auto-creates pages
  // when width + align are passed together).
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10);
  doc.text(BRAND.COMPANY.toUpperCase(), margins.left, margins.top - 32, {
    lineBreak: false,
  });
  // Right — version caption. Measured + placed manually.
  const rightText = 'Lead Scoring Report - v2.0';
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(7.5);
  const w = doc.widthOfString(rightText);
  doc.text(rightText, width - margins.right - w, margins.top - 32, {
    lineBreak: false,
  });
  // Gold rule under the header.
  doc.moveTo(margins.left, margins.top - 18)
     .lineTo(width - margins.right, margins.top - 18)
     .lineWidth(1.4)
     .strokeColor(BRAND.COLORS.GOLD)
     .stroke();
  doc.restore();
}

interface FooterOpts {
  /** "Internal" or "Client" — different footer copy per renderer. */
  variant: 'internal' | 'client';
  /** Current page number (1-indexed). */
  pageNumber: number;
  /** Total pages. */
  pageCount: number;
  /** ISO date string for "Generated on …". */
  generatedAt: string;
  /** Locale/direction. Defaults to the previous English behaviour. */
  style?: ReportStyle;
  /** Localised footer strings. Defaults to the English literals. */
  copy?: {
    left: (slogan: string) => string;
    generated: (date: string) => string;
    page: (n: number, of: number) => string;
  };
}

export function drawFooter(doc: Doc, opts: FooterOpts): void {
  const { width, height, margins } = doc.page;
  const style = opts.style ?? DEFAULT_STYLE;
  const y = height - 30;
  const dateText = formatDateOnly(opts.generatedAt, style.locale);

  // NOTE — pdfkit's text() with width + align auto-creates pages when
  // it suspects the run might overflow, even with lineBreak: false.
  // Footer text is fixed-height single-line copy, so we use the
  // continued-fragment widthOfString approach: measure the width of
  // each segment and place it at the correct x coordinate ourselves.

  doc.save();
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY)
     .font(style.fonts.body).fontSize(7.5);

  const leftText = bidi(
    opts.variant === 'internal'
      ? 'Sorena Visa - www.sorenavisa.com'
      : (opts.copy?.left(BRAND.SLOGAN) ?? `Sorena Visa - ${BRAND.SLOGAN}`),
    style,
  );
  const centerText = bidi(
    opts.variant === 'internal'
      ? `Confidential - Do Not Distribute - Generated ${dateText}`
      : (opts.copy?.generated(dateText) ?? `Generated ${dateText}`),
    style,
  );
  const rightText = bidi(
    opts.copy?.page(opts.pageNumber, opts.pageCount) ?? `Page ${opts.pageNumber} of ${opts.pageCount}`,
    style,
  );

  // Outer two swap ends under RTL; the centre stays centred.
  const outerStart = style.rtl ? rightText : leftText;
  const outerEnd = style.rtl ? leftText : rightText;

  drawSingleLine(doc, outerStart, margins.left, y);

  const centerWidth = measure(doc, centerText);
  drawSingleLine(doc, centerText, (width - centerWidth) / 2, y);

  const endWidth = measure(doc, outerEnd);
  drawSingleLine(doc, outerEnd, width - margins.right - endWidth, y);

  doc.restore();
}

// Place a single-line string at an explicit (x, y) without engaging
// pdfkit's line-wrapping logic. Calling `text(..., { lineBreak: false })`
// without a `width` keeps the wrapper out of the picture entirely.
function drawSingleLine(doc: Doc, text: string, x: number, y: number): void {
  doc.text(text, x, y, { lineBreak: false });
}

// ─── Section headings ─────────────────────────────────────────────

export function drawSectionTitle(
  doc: Doc, text: string, subtitle?: string, style: ReportStyle = DEFAULT_STYLE,
): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  doc.moveDown(0.4);
  const y = doc.y;
  // Navy band with gold accent stripe under it (mirrors the Python
  // `banner(...)` helper).
  doc.save();
  doc.rect(margins.left, y, contentW, 28).fill(BRAND.COLORS.NAVY);
  doc.rect(margins.left, y + 28, contentW, 2).fill(BRAND.COLORS.GOLD);
  // Title — no width/align (pdfkit's line wrapper auto-creates pages when both
  // are present, see drawFooter), so the RTL variant is placed by measuring.
  doc.fillColor('#FFFFFF').font(style.fonts.bold).fontSize(11);
  const title = bidi(text, style);
  const titleX = style.rtl
    ? margins.left + contentW - 12 - measure(doc, title)
    : margins.left + 12;
  doc.text(title, titleX, y + 9, { lineBreak: false });
  if (subtitle) {
    doc.fillColor(BRAND.COLORS.GOLD).font(style.fonts.body).fontSize(8.5);
    const sub = bidi(subtitle, style);
    const subWidth = measure(doc, sub);
    // Title and subtitle sit at opposite ends of the band; under RTL they swap.
    const subX = style.rtl ? margins.left + 12 : margins.left + contentW - 12 - subWidth;
    doc.text(sub, subX, y + 9, { lineBreak: false });
  }
  doc.restore();
  doc.y = y + 30 + 10;
  doc.x = margins.left;
}

export function drawSubhead(doc: Doc, text: string): void {
  const { margins } = doc.page;
  doc.moveDown(0.2);
  const y = doc.y;
  doc.save();
  doc.rect(margins.left, y, 3, 14).fill(BRAND.COLORS.GOLD);
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10.5);
  doc.text(text, margins.left + 10, y, { lineBreak: false });
  doc.restore();
  doc.y = y + 18;
  doc.x = margins.left;
}

// ─── Band badge (large, used on the cover) ────────────────────────

export function drawBandBadge(
  doc: Doc,
  x: number,
  y: number,
  band: string,
  totalScore: number,
  executionEligible: boolean,
  hardStopCount: number,
): void {
  const { width, margins } = doc.page;
  const contentW = width - margins.left - margins.right;
  const cardH = 130;
  // Off-white card with gray border + gold accent strip on top.
  doc.save();
  doc.rect(x, y, contentW, cardH)
     .fillAndStroke(BRAND.COLORS.OFF_WHITE, BRAND.COLORS.PALETTE.GRAYLIGHT);
  doc.rect(x, y, contentW, 3).fill(BRAND.COLORS.GOLD);

  // Big score on the left.
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(56);
  doc.text(String(totalScore), x + 24, y + 30, { lineBreak: false, width: 120 });
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(11);
  doc.text('/ 100', x + 24, y + 96, { lineBreak: false });

  // Band info — colour from the spec scale.
  const bColor = bandColor(band);
  const bandNumber = band.replace('BAND_', '');
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(9);
  doc.text('BAND', x + 170, y + 22, { lineBreak: false });
  doc.fillColor(bColor).font(BRAND.FONTS.BOLD).fontSize(18);
  doc.text(`Band ${bandNumber}`, x + 170, y + 36, { lineBreak: false, width: 200 });

  // Execution eligibility.
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(9);
  doc.text('EXECUTION ELIGIBLE', x + 170, y + 70, { lineBreak: false });
  doc.fillColor(executionEligible ? BRAND.COLORS.SUCCESS : BRAND.COLORS.DANGER)
     .font(BRAND.FONTS.BOLD).fontSize(14);
  doc.text(executionEligible ? 'YES' : 'NO', x + 170, y + 84, { lineBreak: false });

  // Hard-stop count.
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(9);
  doc.text('ACTIVE HARD STOPS', x + 320, y + 70, { lineBreak: false });
  doc.fillColor(hardStopCount > 0 ? BRAND.COLORS.DANGER : BRAND.COLORS.SUCCESS)
     .font(BRAND.FONTS.BOLD).fontSize(14);
  doc.text(String(hardStopCount), x + 320, y + 84, { lineBreak: false });
  doc.restore();
}

// ─── Progress bar ─────────────────────────────────────────────────

export function drawProgressBar(
  doc: Doc,
  label: string,
  score: number,
  maxScore: number,
  warningBelow?: number,
  style: ReportStyle = DEFAULT_STYLE,
): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const warn = warningBelow !== undefined && score < warningBelow;
  const barH = 8;

  doc.save();
  // Label row — the two ends of the row swap under RTL: label reads from the
  // right, score from the left. Manually positioned (see drawFooter for why
  // width+align together is a trap).
  const rowY = doc.y;
  const labelText = bidi(label, style);
  const scoreText = bidi(`${score} / ${maxScore}   (${Math.round(pct)}%)`, style);
  doc.fillColor(BRAND.COLORS.NAVY).font(style.fonts.bold).fontSize(10);
  const lw = measure(doc, labelText);
  doc.text(labelText, style.rtl ? margins.left + contentW - lw : margins.left, rowY, { lineBreak: false });
  doc.fillColor(warn ? BRAND.COLORS.WARNING : BRAND.COLORS.NAVY);
  const sw = measure(doc, scoreText);
  doc.text(scoreText, style.rtl ? margins.left : margins.left + contentW - sw, rowY, { lineBreak: false });
  doc.y = rowY;
  doc.moveDown(0.7);
  // Persian glyphs descend further below the baseline than Helvetica's, so the
  // gap that clears the label in English lets the bar cut through the descenders
  // of "پروفایل و ثبات مهاجرتی". Extra clearance for RTL only — English keeps
  // its exact previous geometry.
  const barY = doc.y + (style.rtl ? 5 : 0);
  // Bar background.
  doc.rect(margins.left, barY, contentW, barH).fill(BRAND.COLORS.PALETTE.GRAYLIGHT);
  // Fill. Under RTL the bar grows from the right-hand end, so it still reads as
  // "filled from the start of the line".
  const fillColor =
    pct >= 60 ? BRAND.COLORS.SUCCESS
      : pct >= 40 ? BRAND.COLORS.WARNING
      : BRAND.COLORS.DANGER;
  const fillW = contentW * (score / Math.max(1, maxScore));
  doc.rect(style.rtl ? margins.left + contentW - fillW : margins.left, barY, fillW, barH).fill(fillColor);
  doc.restore();
  doc.y = barY + barH + 6;
  doc.x = margins.left;
  if (warn) {
    doc.save();
    doc.fillColor(BRAND.COLORS.WARNING).font(style.fonts.soft).fontSize(8.5);
    doc.text(`! Below execution threshold (${warningBelow})`, margins.left, doc.y);
    doc.restore();
    doc.moveDown(0.2);
  }
  doc.moveDown(0.3);
}

// ─── Hard-stop card ───────────────────────────────────────────────

export interface HardStopShape {
  code: string;
  name: string;
  reason: string;
  resolution: string;
}

export function drawHardStopCard(doc: Doc, hs: HardStopShape): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  doc.save();
  // Code chip.
  doc.rect(margins.left, doc.y, 48, 18).fill(BRAND.COLORS.DANGER);
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(10);
  doc.text(hs.code, margins.left + 6, doc.y + 4, { lineBreak: false, width: 44 });
  // Name.
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10.5);
  doc.text(hs.name, margins.left + 56, doc.y + 4, {
    lineBreak: false, width: contentW - 60,
  });
  doc.restore();
  doc.y += 26;
  doc.x = margins.left;
  // Body + resolution.
  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(9.5);
  doc.text(`Reason: ${hs.reason}`, margins.left, doc.y, { width: contentW });
  doc.moveDown(0.2);
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.ITALIC).fontSize(9.5);
  doc.text(`Resolution: ${hs.resolution}`, margins.left, doc.y, { width: contentW });
  doc.moveDown(0.5);
}

// ─── Risk-flag chip (amber bullet, used inline) ──────────────────

export function drawRiskFlagBullet(doc: Doc, flag: string): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  doc.save();
  doc.circle(margins.left + 6, doc.y + 5, 1.8).fill(BRAND.COLORS.WARNING);
  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(10);
  doc.text(flag, margins.left + 16, doc.y, { width: contentW - 20 });
  doc.restore();
  doc.moveDown(0.2);
}

// ─── Single 5-gate row ────────────────────────────────────────────

export interface GateRowShape {
  label: string;
  passed: boolean;
}

export function drawGateRow(doc: Doc, gate: GateRowShape): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  doc.save();
  doc.fillColor(gate.passed ? BRAND.COLORS.SUCCESS : BRAND.COLORS.DANGER)
     .font(BRAND.FONTS.BOLD).fontSize(10);
  doc.text(gate.passed ? 'Y' : 'N', margins.left, doc.y, { lineBreak: false, width: 14 });
  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(9.5);
  doc.text(gate.label, margins.left + 14, doc.y, { width: contentW - 14 });
  doc.restore();
  doc.moveDown(0.2);
}

// ─── Single answer-log row ────────────────────────────────────────

export function drawAnswerRow(
  doc: Doc,
  question: string,
  answer: string,
  points: number,
): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  const startY = doc.y;
  const qWidth = contentW * 0.42;
  doc.save();
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(9);
  doc.text(truncate(question, 60), margins.left, startY, { lineBreak: false });
  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(9);
  doc.text(truncate(answer, 40), margins.left + qWidth + 8, startY, { lineBreak: false });
  const pointsText = `+${points} pts`;
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(9);
  const pw = doc.widthOfString(pointsText);
  doc.text(pointsText, margins.left + contentW - pw, startY, { lineBreak: false });
  doc.restore();
  doc.y = startY + 13;
  doc.x = margins.left;
}

// ─── Key/value row (cover + contact summary) ──────────────────────

export function drawKvRow(
  doc: Doc,
  label: string,
  value: string,
  labelWidth = 200,
): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  const startY = doc.y;
  doc.save();
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(9.5);
  doc.text(label, margins.left, startY, { lineBreak: false, width: labelWidth });
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(9.5);
  doc.text(value || '-', margins.left + labelWidth, startY, {
    lineBreak: false, width: contentW - labelWidth,
  });
  doc.restore();
  doc.y = startY + 14;
  doc.x = margins.left;
}

// ─── Bullet list item ─────────────────────────────────────────────

export function drawBullet(
  doc: Doc, text: string, color = BRAND.COLORS.PALETTE.NAVY_DEEP, style: ReportStyle = DEFAULT_STYLE,
): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  const startY = doc.y;
  doc.save();
  // The dot leads the text, so under RTL it moves to the right-hand edge.
  const dotX = style.rtl ? margins.left + contentW - 8 : margins.left + 8;
  doc.circle(dotX, startY + 5, 1.8).fill(BRAND.COLORS.GOLD);
  doc.fillColor(color).font(style.fonts.body).fontSize(10.5);
  doc.text(bidi(text, style), margins.left + (style.rtl ? 4 : 18), startY, {
    width: contentW - 22, align: style.rtl ? 'right' : 'left',
  });
  doc.restore();
  doc.moveDown(0.3);
}

// ─── Divider ──────────────────────────────────────────────────────

export function drawDivider(doc: Doc): void {
  const { margins, width } = doc.page;
  doc.save();
  doc.moveTo(margins.left, doc.y)
     .lineTo(width - margins.right, doc.y)
     .lineWidth(0.4)
     .strokeColor(BRAND.COLORS.PALETTE.GRAYLIGHT)
     .stroke();
  doc.restore();
  doc.moveDown(0.6);
}

// ─── Cover band (used by both reports' page 1) ───────────────────

export function drawCoverBand(
  doc: Doc,
  opts: {
    sublabel: string;     // small white caption (e.g. "LEAD SCORING REPORT · v2.0")
    headline: string;     // big gold title
    appliedFor: string;   // "For: …" or "Prepared for: …"
    dateText: string;     // formatted "DD Month YYYY"
    height?: number;      // override band height (defaults 200)
  },
  style: ReportStyle = DEFAULT_STYLE,
): void {
  const { width, margins } = doc.page;
  const bandH = opts.height ?? 200;
  // Navy band edge-to-edge with a thin gold rule beneath.
  doc.save();
  doc.rect(0, 0, width, bandH).fill(BRAND.COLORS.NAVY);
  doc.rect(0, bandH, width, 3).fill(BRAND.COLORS.GOLD);

  // Every line in the band is placed by measurement rather than by align, so
  // the RTL variant simply anchors to the right margin instead of the left.
  const put = (text: string, y: number) => {
    const t = bidi(text, style);
    doc.text(t, style.rtl ? width - margins.right - measure(doc, t) : margins.left, y,
      { lineBreak: false });
  };

  // Wordmark (text — embedded brand mark is optional, fallback to
  // the company name in bold white so the PDF renders identically
  // on every environment regardless of file availability).
  doc.fillColor('#FFFFFF').font(style.fonts.bold).fontSize(16);
  put(BRAND.COMPANY.toUpperCase(), 32);
  doc.fillColor('#FFFFFF').font(style.fonts.body).fontSize(9);
  put(opts.sublabel, 56);

  // Big gold headline — wraps, so this one uses align rather than measurement.
  doc.fillColor(BRAND.COLORS.GOLD).font(style.fonts.bold).fontSize(24);
  doc.text(bidi(opts.headline, style), margins.left, 96, {
    width: width - margins.left - margins.right - 20,
    align: style.rtl ? 'right' : 'left',
  });

  // Footer-of-band metadata.
  doc.fillColor('#FFFFFF').font(style.fonts.body).fontSize(10);
  put(opts.appliedFor, bandH - 50);
  doc.fillColor('#FFFFFF').font(style.fonts.body).fontSize(9);
  put(opts.dateText, bandH - 34);
  doc.restore();
  // Position cursor below the band.
  doc.x = margins.left;
  doc.y = bandH + 24;
}

// ─── Misc utilities ───────────────────────────────────────────────

export function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '...';
}

// Persian keeps the GREGORIAN calendar (`u-ca-gregory`) — only the month names
// and digits localise, so "17 August 2026" becomes "۱۷ اوت ۲۰۲۶", never a Jalali
// date. This is the platform-wide locked decision already implemented in
// frontend/src/lib/date.ts: clients cross-reference these dates against their
// passport and INZ documents, which are Gregorian.
//
// A side benefit: because the Persian form contains no Latin characters, it is
// not subject to the run-reversal that LRM exists to fix.
export function formatDateOnly(iso: string, locale: 'en' | 'fa' = 'en'): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale === 'fa' ? 'fa-IR-u-ca-gregory-nu-latn' : 'en-NZ', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-NZ', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Sanitise a name for use in a download filename — first name +
// surname initial, lowercased, ASCII-only. Empty-string fallback to
// "applicant" when the result has no characters left.
export function shortFilenameSlug(fullName: string | null | undefined): string {
  if (!fullName) return 'applicant';
  const ascii = fullName.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const parts = ascii.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'applicant';
  const first = parts[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const last  = parts.length > 1
    ? parts[parts.length - 1][0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
    : '';
  const slug = last ? `${first}-${last}` : first;
  return slug.length > 0 ? slug : 'applicant';
}

// Used to retrofit page-number footers after content has been laid
// out. Caller passes the PDFKit doc that was created with
// `bufferPages: true`, plus the variant + generated-at date.
export function renderFooterOnAllPages(
  doc: Doc,
  variant: 'internal' | 'client',
  generatedAt: string,
  style: ReportStyle = DEFAULT_STYLE,
  copy?: FooterOpts['copy'],
): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, {
      variant,
      pageNumber: i + 1,
      pageCount: range.count,
      generatedAt,
      style,
      copy,
    });
  }
}
