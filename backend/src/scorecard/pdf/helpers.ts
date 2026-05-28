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
  const rightText = 'Lead Scoring Report · v2.0';
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
}

export function drawFooter(doc: Doc, opts: FooterOpts): void {
  const { width, height, margins } = doc.page;
  const y = height - 30;
  const dateText = formatDateOnly(opts.generatedAt);

  // NOTE — pdfkit's text() with width + align auto-creates pages when
  // it suspects the run might overflow, even with lineBreak: false.
  // Footer text is fixed-height single-line copy, so we use the
  // continued-fragment widthOfString approach: measure the width of
  // each segment and place it at the correct x coordinate ourselves.

  doc.save();
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY)
     .font(BRAND.FONTS.BODY).fontSize(7.5);

  const leftText  = opts.variant === 'internal'
    ? 'Sorena Visa · www.sorenavisa.com'
    : `Sorena Visa · ${BRAND.SLOGAN}`;
  const centerText = opts.variant === 'internal'
    ? `Confidential — Do Not Distribute · Generated ${dateText}`
    : `Generated ${dateText}`;
  const rightText = `Page ${opts.pageNumber} of ${opts.pageCount}`;

  // Left.
  drawSingleLine(doc, leftText, margins.left, y);

  // Center.
  const centerWidth = doc.widthOfString(centerText);
  drawSingleLine(doc, centerText, (width - centerWidth) / 2, y);

  // Right.
  const rightWidth = doc.widthOfString(rightText);
  drawSingleLine(doc, rightText, width - margins.right - rightWidth, y);

  doc.restore();
}

// Place a single-line string at an explicit (x, y) without engaging
// pdfkit's line-wrapping logic. Calling `text(..., { lineBreak: false })`
// without a `width` keeps the wrapper out of the picture entirely.
function drawSingleLine(doc: Doc, text: string, x: number, y: number): void {
  doc.text(text, x, y, { lineBreak: false });
}

// ─── Section headings ─────────────────────────────────────────────

export function drawSectionTitle(doc: Doc, text: string, subtitle?: string): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  doc.moveDown(0.4);
  const y = doc.y;
  // Navy band with gold accent stripe under it (mirrors the Python
  // `banner(...)` helper).
  doc.save();
  doc.rect(margins.left, y, contentW, 28).fill(BRAND.COLORS.NAVY);
  doc.rect(margins.left, y + 28, contentW, 2).fill(BRAND.COLORS.GOLD);
  // Title — left aligned, no width/align (pdfkit's line wrapper
  // auto-creates pages when both are present, see drawFooter).
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(11);
  doc.text(text, margins.left + 12, y + 9, { lineBreak: false });
  if (subtitle) {
    doc.fillColor(BRAND.COLORS.GOLD).font(BRAND.FONTS.BODY).fontSize(8.5);
    const subWidth = doc.widthOfString(subtitle);
    doc.text(subtitle, margins.left + contentW - 12 - subWidth, y + 9, {
      lineBreak: false,
    });
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
): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const warn = warningBelow !== undefined && score < warningBelow;
  const barH = 8;

  doc.save();
  // Label row — left + right side, manually positioned (see
  // drawFooter for why width+align together is a trap).
  const rowY = doc.y;
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10);
  doc.text(label, margins.left, rowY, { lineBreak: false });
  const scoreText = `${score} / ${maxScore}   (${Math.round(pct)}%)`;
  doc.fillColor(warn ? BRAND.COLORS.WARNING : BRAND.COLORS.NAVY);
  const sw = doc.widthOfString(scoreText);
  doc.text(scoreText, margins.left + contentW - sw, rowY, { lineBreak: false });
  doc.y = rowY;
  doc.moveDown(0.7);
  const barY = doc.y;
  // Bar background.
  doc.rect(margins.left, barY, contentW, barH).fill(BRAND.COLORS.PALETTE.GRAYLIGHT);
  // Fill.
  const fillColor =
    pct >= 60 ? BRAND.COLORS.SUCCESS
      : pct >= 40 ? BRAND.COLORS.WARNING
      : BRAND.COLORS.DANGER;
  doc.rect(margins.left, barY, contentW * (score / Math.max(1, maxScore)), barH).fill(fillColor);
  doc.restore();
  doc.y = barY + barH + 6;
  doc.x = margins.left;
  if (warn) {
    doc.save();
    doc.fillColor(BRAND.COLORS.WARNING).font(BRAND.FONTS.ITALIC).fontSize(8.5);
    doc.text(`⚠ Below execution threshold (${warningBelow})`, margins.left, doc.y);
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
  doc.text(gate.passed ? '✓' : '✗', margins.left, doc.y, { lineBreak: false, width: 12 });
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
  doc.text(value || '—', margins.left + labelWidth, startY, {
    lineBreak: false, width: contentW - labelWidth,
  });
  doc.restore();
  doc.y = startY + 14;
  doc.x = margins.left;
}

// ─── Bullet list item ─────────────────────────────────────────────

export function drawBullet(doc: Doc, text: string, color = BRAND.COLORS.PALETTE.NAVY_DEEP): void {
  const { margins, width } = doc.page;
  const contentW = width - margins.left - margins.right;
  const startY = doc.y;
  doc.save();
  doc.circle(margins.left + 8, startY + 5, 1.8).fill(BRAND.COLORS.GOLD);
  doc.fillColor(color).font(BRAND.FONTS.BODY).fontSize(10.5);
  doc.text(text, margins.left + 18, startY, { width: contentW - 22, align: 'left' });
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
): void {
  const { width, margins } = doc.page;
  const bandH = opts.height ?? 200;
  // Navy band edge-to-edge with a thin gold rule beneath.
  doc.save();
  doc.rect(0, 0, width, bandH).fill(BRAND.COLORS.NAVY);
  doc.rect(0, bandH, width, 3).fill(BRAND.COLORS.GOLD);

  // Wordmark (text — embedded brand mark is optional, fallback to
  // the company name in bold white so the PDF renders identically
  // on every environment regardless of file availability).
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(16);
  doc.text(BRAND.COMPANY.toUpperCase(), margins.left, 32, { lineBreak: false });
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BODY).fontSize(9);
  doc.text(opts.sublabel, margins.left, 56, { lineBreak: false });

  // Big gold headline.
  doc.fillColor(BRAND.COLORS.GOLD).font(BRAND.FONTS.BOLD).fontSize(24);
  doc.text(opts.headline, margins.left, 96, {
    width: width - margins.left - margins.right - 20,
    align: 'left',
  });

  // Footer-of-band metadata.
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BODY).fontSize(10);
  doc.text(opts.appliedFor, margins.left, bandH - 50, { lineBreak: false });
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BODY).fontSize(9);
  doc.text(opts.dateText, margins.left, bandH - 34, { lineBreak: false });
  doc.restore();
  // Position cursor below the band.
  doc.x = margins.left;
  doc.y = bandH + 24;
}

// ─── Misc utilities ───────────────────────────────────────────────

export function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-NZ', {
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
): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, {
      variant,
      pageNumber: i + 1,
      pageCount: range.count,
      generatedAt,
    });
  }
}
