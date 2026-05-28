import PDFDocument from 'pdfkit';
import type { ScoreResult } from '../scoring/engine';
import type { NextActionContent } from '../scoring/routing';
import { BRAND } from './branding';
import {
  drawHeader, drawSectionTitle, drawSubhead, drawBandBadge,
  drawProgressBar, drawHardStopCard, drawRiskFlagBullet, drawGateRow,
  drawAnswerRow, drawKvRow, drawDivider, drawCoverBand,
  formatDateTime, formatDateOnly, renderFooterOnAllPages, truncate,
} from './helpers';

// PR-SCORECARD-3 — Internal staff-facing scorecard PDF.
//
// Ported from Sorena_Scoring_Reference/score_pdf.py (ReportLab) to
// PDFKit. Layout intent preserved: cover page with big score badge,
// category breakdown, hard stops, risk flags, 5-gate execution
// check, full answer log (category-grouped), contact summary.
//
// Confidentiality footer on every page; the page footer is laid
// down after content via `bufferPages` so "Page X of Y" reflects
// the real total.

// Categories (mirrors the scoring engine).
const CATEGORY_NAMES: Record<number, string> = {
  1: 'Motivation, Demographics & Stability',
  2: 'Academic & English Profile',
  3: 'Financial Capacity & Settlement',
  4: 'Documentation & Compliance',
};
const CATEGORY_MAX: Record<number, number> = { 1: 25, 2: 35, 3: 25, 4: 15 };

// Question labels (ported verbatim from score_pdf.py question_labels dict).
const QUESTION_LABELS: Record<string, string> = {
  q01_motivation: 'Q1. Migration motivation',
  q02_migrate_before_family: 'Q2. Migrate before family',
  q03_age: 'Q3. Age',
  q05_military: 'Q5. Military service',
  q06_marital: 'Q6. Marital status',
  q07_marriage_years: 'Q7. Years since marriage/divorce',
  q08_children: 'Q8. Number of children',
  q09_partner_age: 'Q9. Partner\'s age',
  q10_partner_edu: 'Q10. Partner\'s education',
  q11_partner_english: 'Q11. Partner\'s English',
  q12_other_citizenship: 'Q12. Other citizenship',
  q13_travel_history: 'Q13. Travel history',
  q14_visa_countries_type: 'Q14. Visa countries visited',
  q15_highest_qual: 'Q15. Highest qualification',
  q16_field_main: 'Q16. Main field of study',
  q17_gpa: 'Q17. GPA',
  q18_years_since: 'Q18. Years since graduation',
  q19_docs_translated: 'Q19. Translated docs',
  q20_publications: 'Q20. Publications',
  q21_english_cert: 'Q21. English certificate',
  q22_english_score: 'Q22. English score',
  q24_studied_english: 'Q24. Previously studied in English',
  q26_field_change: 'Q26. Field change',
  q27_study_goal: 'Q27. Study goal',
  q28_work_after_grad: 'Q28. Work after grad',
  q29_years_work: 'Q29. Years of work',
  q30_work_relevance: 'Q30. Work relevance',
  q31_occupation: 'Q31. Occupation category',
  q33_funds: 'Q33. Available funds',
  q34_funds_source: 'Q34. Funds source',
  q35_overseas_bank: 'Q35. Overseas bank',
  q36_financial_docs: 'Q36. Financial docs',
  q37_overseas_contacts: 'Q37. Overseas contacts',
  q38_settlement_support: 'Q38. Settlement support',
  q39_passport: 'Q39. Valid passport',
  q40_docs_ready: 'Q40. Docs ready',
  q41_apply_timeline: 'Q41. Apply timeline',
  q44_refusal: 'Q44. Visa refusal Y/N',
  q45_refusal_count: 'Q45. Refusal count',
  q46_refusal_recency: 'Q46. Refusal recency',
  q47_medical: 'Q47. Medical',
  q48_police_clearance: 'Q48. Police clearance',
  q49_breach: 'Q49. Visa breach',
  q50_other_identity: 'Q50. Other identity',
  q51_self_submitted: 'Q51. Self-submitted before',
  q52_other_agent: 'Q52. Worked with other agent',
};

// Category membership — copied from the engine's FIELD_CATEGORIES so
// we don't have to import the private map.
const FIELD_CATEGORIES: Record<string, number> = {
  q01_motivation: 1, q02_migrate_before_family: 1, q03_age: 1, q05_military: 1,
  q06_marital: 1, q07_marriage_years: 1, q08_children: 1, q09_partner_age: 1,
  q10_partner_edu: 1, q11_partner_english: 1, q12_other_citizenship: 1,
  q13_travel_history: 1, q14_visa_countries_type: 1,
  q15_highest_qual: 2, q16_field_main: 2, q17_gpa: 2, q18_years_since: 2,
  q19_docs_translated: 2, q20_publications: 2, q21_english_cert: 2,
  q22_english_score: 2, q24_studied_english: 2, q26_field_change: 2,
  q27_study_goal: 2, q28_work_after_grad: 2, q29_years_work: 2,
  q30_work_relevance: 2, q31_occupation: 2,
  q33_funds: 3, q34_funds_source: 3, q35_overseas_bank: 3, q36_financial_docs: 3,
  q37_overseas_contacts: 3, q38_settlement_support: 3,
  q39_passport: 4, q40_docs_ready: 4, q41_apply_timeline: 4, q44_refusal: 4,
  q45_refusal_count: 4, q46_refusal_recency: 4, q47_medical: 4,
  q48_police_clearance: 4, q49_breach: 4, q50_other_identity: 4,
  q51_self_submitted: 4, q52_other_agent: 4,
};

export interface InternalReportData {
  applicant: {
    fullName: string;
    email: string | null;
    phone: string | null;
    country: string | null;
    submittedAt: string;
  };
  totalScore: number;
  band: string;          // "BAND_3" etc.
  bandName: string;      // human-readable
  categoryScores: Record<number, number>;
  hardStops: Array<{
    code: string;
    name: string;
    reason: string;
    resolution: string;
  }>;
  riskFlags: string[];
  gateResults: Array<{ gateNumber: number; label: string; passed: boolean }>;
  executionEligible: boolean;
  nextActionContent: NextActionContent | null;
  nextActionTextEn: string;
  answers: Record<string, string>;
  perFieldScores?: ScoreResult['perFieldScores'];
  rawAnswers?: Record<string, string>;
}

export async function renderInternalReport(data: InternalReportData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
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
        Title:    `Sorena Scoring Report — ${data.applicant.fullName}`,
        Author:   'Sorena Visa',
        Subject:  'Internal Assessment Report',
        Creator:  'Sorena Visa Platform',
        Producer: 'Sorena Visa Platform · pdfkit',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header for every NEW page after the cover. Suppress header
    // drawing on the cover (page 1) — its hero already carries the
    // wordmark.
    let coverDrawn = false;
    doc.on('pageAdded', () => {
      if (!coverDrawn) return;
      drawHeader(doc, {});
      // Reset cursor below the gold rule.
      doc.x = doc.page.margins.left;
      doc.y = BRAND.PAGE.MARGIN;
    });

    // ─── PAGE 1 — Cover + Headline Result ──────────────────────────
    drawCoverBand(doc, {
      sublabel:   'LEAD SCORING REPORT - v2.0',
      headline:   'Assessment Result',
      appliedFor: `For: ${data.applicant.fullName || '(name not provided)'}`,
      dateText:   `Generated: ${formatDateTime(data.applicant.submittedAt)}`,
    });
    coverDrawn = true;

    // Big score badge.
    drawBandBadge(
      doc,
      doc.page.margins.left,
      doc.y,
      data.band,
      data.totalScore,
      data.executionEligible,
      data.hardStops.length,
    );
    doc.y += 130 + 20;
    doc.x = doc.page.margins.left;

    // Next best action — navy box.
    const nbX = doc.page.margins.left;
    const nbW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const nbY = doc.y;
    const nbH = 80;
    doc.save();
    doc.rect(nbX, nbY, nbW, nbH).fill(BRAND.COLORS.NAVY);
    doc.fillColor(BRAND.COLORS.GOLD).font(BRAND.FONTS.BOLD).fontSize(9);
    doc.text('NEXT BEST ACTION', nbX + 14, nbY + 12, { lineBreak: false });
    doc.fillColor('#FFFFFF').font(BRAND.FONTS.BODY).fontSize(10.5);
    const nextActionLine = data.nextActionContent?.heading ?? data.nextActionTextEn ?? '';
    doc.text(nextActionLine, nbX + 14, nbY + 30, {
      width: nbW - 28, align: 'left',
    });
    doc.restore();
    doc.x = doc.page.margins.left;
    doc.y = nbY + nbH + 20;

    // Quick context lines.
    doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(10);
    doc.text(`Band: ${data.bandName}`, doc.page.margins.left, doc.y);
    doc.moveDown(0.3);
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(10);
    doc.text(
      `Execution eligible: ${data.executionEligible ? 'YES - ready to proceed' : 'NOT YET - see hard stops + gates'}`,
      doc.page.margins.left, doc.y,
    );

    // ─── PAGE 2 — Category breakdown + hard stops + risk + gates ──
    doc.addPage();
    drawSectionTitle(doc, 'CATEGORY BREAKDOWN', 'Sub-totals against maximum');
    for (const c of [1, 2, 3, 4] as const) {
      const sc = data.categoryScores[c] ?? 0;
      const mx = CATEGORY_MAX[c];
      const warn = (c === 2 || c === 3) ? 12 : undefined;
      drawProgressBar(doc, `Category ${c}: ${CATEGORY_NAMES[c]}`, sc, mx, warn);
    }

    doc.moveDown(0.5);
    drawSectionTitle(doc, 'HARD STOPS', `${data.hardStops.length} active`);
    if (data.hardStops.length === 0) {
      doc.fillColor(BRAND.COLORS.SUCCESS).font(BRAND.FONTS.BODY).fontSize(10);
      doc.text('None. No execution-blocking conditions detected.', doc.page.margins.left, doc.y);
      doc.moveDown(0.5);
    } else {
      for (const hs of data.hardStops) {
        // Add page if low on space.
        if (doc.y > doc.page.height - 130) doc.addPage();
        drawHardStopCard(doc, hs);
      }
    }

    if (doc.y > doc.page.height - 160) doc.addPage();
    drawSectionTitle(doc, 'RISK FLAGS', `${data.riskFlags.length} identified`);
    if (data.riskFlags.length === 0) {
      doc.fillColor(BRAND.COLORS.SUCCESS).font(BRAND.FONTS.BODY).fontSize(10);
      doc.text('None. Standard handling.', doc.page.margins.left, doc.y);
      doc.moveDown(0.5);
    } else {
      for (const flag of data.riskFlags) drawRiskFlagBullet(doc, flag);
    }

    if (doc.y > doc.page.height - 180) doc.addPage();
    drawSectionTitle(doc, 'EXECUTION ELIGIBILITY - 5-GATE CHECK');
    for (const gate of data.gateResults) {
      drawGateRow(doc, { label: gate.label, passed: gate.passed });
    }
    doc.moveDown(0.4);
    doc.fillColor(data.executionEligible ? BRAND.COLORS.SUCCESS : BRAND.COLORS.DANGER)
       .font(BRAND.FONTS.BOLD).fontSize(11);
    doc.text(
      `Overall: ${data.executionEligible ? 'ELIGIBLE FOR EXECUTION' : 'NOT YET ELIGIBLE'}`,
      doc.page.margins.left, doc.y,
    );

    // ─── PAGE 3+ — Full Answer Log ─────────────────────────────────
    doc.addPage();
    drawSectionTitle(doc, 'FULL ANSWER LOG', 'Every question + points awarded');
    for (const catId of [1, 2, 3, 4] as const) {
      // Subhead.
      if (doc.y > doc.page.height - 80) doc.addPage();
      drawSubhead(
        doc,
        `Category ${catId}: ${CATEGORY_NAMES[catId]}  -  ${data.categoryScores[catId]} / ${CATEGORY_MAX[catId]}`,
      );
      // Rows.
      const fields = Object.keys(QUESTION_LABELS).filter((q) => FIELD_CATEGORIES[q] === catId);
      for (const fld of fields) {
        const label = QUESTION_LABELS[fld] ?? fld;
        const ans = data.answers[fld] ?? '-';
        const pts = data.perFieldScores?.[fld]?.points ?? 0;
        if (doc.y > doc.page.height - 70) doc.addPage();
        drawAnswerRow(doc, label, ans, pts);
      }
      doc.moveDown(0.4);
    }

    // ─── Final page — Client contact + staff observations ─────────
    doc.addPage();
    drawSectionTitle(doc, 'CLIENT CONTACT SUMMARY');
    const a = data.answers;
    drawKvRow(doc, 'Full name',         a.full_name ?? data.applicant.fullName);
    drawKvRow(doc, 'Email',             a.email ?? data.applicant.email ?? '-');
    drawKvRow(doc, 'Mobile / WhatsApp', a.mobile ?? data.applicant.phone ?? '-');
    drawKvRow(doc, 'Date of birth',     a.dob ?? '-');
    drawKvRow(doc, 'Nationality',       a.nationality ?? '-');
    drawKvRow(doc, 'Current country',   a.country_resident ?? data.applicant.country ?? '-');
    drawKvRow(doc, 'Current city',      a.city_resident ?? '-');
    drawDivider(doc);
    drawKvRow(doc, 'Field specialisation',
      truncate(a.q16b_field_specialisation ?? '-', 80));
    drawKvRow(doc, 'Countries visited',
      truncate(a.q14_countries_list ?? '-', 80));
    drawKvRow(doc, 'Role description',
      truncate(a.q32b_role_description ?? '-', 80));
    drawKvRow(doc, 'Refusal countries (if any)',
      truncate(a.q44b_refusal_countries ?? '-', 80));
    drawDivider(doc);
    drawKvRow(doc, 'Source',            a.q53_source ?? '-');
    drawKvRow(doc, 'Additional notes',
      truncate(a.q54_notes ?? '-', 80));

    doc.moveDown(1.5);
    drawSubhead(doc, 'Staff observations');
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.ITALIC).fontSize(9);
    doc.text(
      '- Space below for handwritten/staff notes after review -',
      doc.page.margins.left, doc.y,
    );
    doc.moveDown(0.5);
    // Six blank ruled lines.
    for (let i = 0; i < 6; i++) {
      doc.moveTo(doc.page.margins.left, doc.y + 18)
         .lineTo(doc.page.width - doc.page.margins.right, doc.y + 18)
         .lineWidth(0.4)
         .strokeColor(BRAND.COLORS.PALETTE.GRAYLIGHT)
         .stroke();
      doc.y += 24;
    }

    // ─── Footers on every page ────────────────────────────────────
    renderFooterOnAllPages(doc, 'internal', data.applicant.submittedAt);
    doc.end();
  });
}
