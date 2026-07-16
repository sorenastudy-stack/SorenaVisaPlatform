import PDFDocument from 'pdfkit';
import type { NextActionContent } from '../scoring/routing';
import { getSessionConfig } from '../../booking/session-config';
import { BRAND } from './branding';
import {
  drawSectionTitle, drawProgressBar, drawBullet,
  drawCoverBand, formatDateOnly, renderFooterOnAllPages,
} from './helpers';

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

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Personal & Background',
  2: 'Education & English',
  3: 'Financial Readiness',
  4: 'Documentation & History',
};
const CATEGORY_MAX: Record<number, number> = { 1: 25, 2: 35, 3: 25, 4: 15 };

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
}

export async function renderClientReport(data: ClientReportData): Promise<Buffer> {
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
        Title:    `Your Sorena Pathway — ${data.applicant.fullName}`,
        Author:   'Sorena Visa',
        Subject:  'Your Readiness Assessment',
        Creator:  'Sorena Visa Platform',
        Producer: 'Sorena Visa Platform · pdfkit',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const firstName = (data.applicant.fullName || '').trim().split(/\s+/)[0] || 'there';

    // ─── PAGE 1 — Cover + warm greeting + score badge ─────────────
    drawCoverBand(doc, {
      sublabel:   'YOUR PERSONAL PATHWAY RECOMMENDATION',
      headline:   coverHeadline(data, firstName),
      appliedFor: `Prepared for: ${data.applicant.fullName || 'You'}`,
      dateText:   formatDateOnly(data.applicant.submittedAt),
      height:     220,
    });

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

    // Big score.
    doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(48);
    doc.text(String(data.totalScore), margins.left + 24, cardY + 24, { lineBreak: false });
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(10);
    doc.text('/ 100', margins.left + 24, cardY + 78, { lineBreak: false });

    // Band line + plain-language summary.
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(9);
    doc.text('YOUR BAND', margins.left + 160, cardY + 24, { lineBreak: false });
    doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(14);
    doc.text(data.bandName, margins.left + 160, cardY + 38, {
      lineBreak: false, width: contentW - 170,
    });
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.ITALIC).fontSize(9.5);
    doc.text(bandMeaning(data.band, data.hasHardStops), margins.left + 160, cardY + 60, {
      width: contentW - 170,
    });
    doc.restore();
    doc.x = margins.left;
    doc.y = cardY + cardH + 20;

    // ─── PAGE 2 — Warm message + your strengths ──────────────────
    doc.addPage();
    drawSectionTitle(doc, 'YOUR READINESS', 'A clear picture of where you stand today');

    // Greeting paragraph.
    const intro = buildIntroParagraph(data, firstName);
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(11);
    doc.text(intro, margins.left, doc.y, {
      width: contentW, align: 'left', lineGap: 3,
    });
    doc.moveDown(0.8);

    drawSectionTitle(doc, 'YOUR STRENGTHS', 'Areas where your profile already shines');
    for (const c of [1, 2, 3, 4] as const) {
      const sc = data.categoryScores[c] ?? 0;
      const mx = CATEGORY_MAX[c];
      drawProgressBar(doc, CATEGORY_NAMES[c], sc, mx);
    }
    doc.moveDown(0.6);
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.ITALIC).fontSize(9.5);
    doc.text(
      'Every area has room to grow. The areas where you scored highest are your launchpad - the areas where you scored lower are the targets for our next conversation.',
      margins.left, doc.y, { width: contentW, lineGap: 2 },
    );

    // ─── PAGE 3 — Your next steps ────────────────────────────────
    doc.addPage();
    drawSectionTitle(doc, 'YOUR NEXT STEPS');

    // Heading + lead-in + bullets, ported from nextActionContent.
    const nc = data.nextActionContent;
    if (nc) {
      if (nc.leadIn) {
        doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(10.5);
        doc.text(nc.leadIn, margins.left, doc.y, { width: contentW, lineGap: 2 });
        doc.moveDown(0.5);
      }
      doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(12);
      doc.text(nc.heading, margins.left, doc.y, { width: contentW });
      doc.moveDown(0.4);
      for (const b of nc.bullets) drawBullet(doc, b);
    } else {
      // Legacy: nextActionContent is null. Fall back to the flat
      // English text written by the engine.
      doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(11.5);
      doc.text(data.nextActionTextEn, margins.left, doc.y, { width: contentW });
    }

    doc.moveDown(0.8);

    // Pathway notes by scenario.
    drawPathwayNotes(doc, data);

    // Dual-country callout (Bands 4-6, NOT showing hard stops).
    if (data.shouldShowMalaysiaCallout && !data.hasHardStops) {
      doc.addPage();
      drawDualCountryPage(doc);
    }

    // ─── Final page — About Sorena Visa ──────────────────────────
    doc.addPage();
    drawSectionTitle(doc, 'ABOUT SORENA VISA');
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(11);
    doc.text(
      'Sorena Visa is a New Zealand-based education and immigration consultancy. We\'re authorised agents for universities in New Zealand and Malaysia, helping students secure offers of place, visa approval, and successful settlement abroad.',
      margins.left, doc.y, { width: contentW, lineGap: 3 },
    );
    doc.moveDown(0.8);
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(11);
    doc.text(
      'Our admission and visa-coordination service is paid by the universities we represent, not by you. That means our interests are aligned with yours from day one - we only succeed when you do.',
      margins.left, doc.y, { width: contentW, lineGap: 3 },
    );
    doc.moveDown(1.0);

    // Closing.
    doc.save();
    doc.moveTo(margins.left, doc.y).lineTo(margins.left + 60, doc.y)
       .lineWidth(0.8).strokeColor(BRAND.COLORS.GOLD).stroke();
    doc.restore();
    doc.moveDown(0.6);
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.BODY).fontSize(10.5);
    doc.text(
      'If you have any questions, simply reply to the email this report came with. We\'re here to help you make the right choice - not just the fastest one.',
      margins.left, doc.y, { width: contentW, lineGap: 2 },
    );
    doc.moveDown(0.8);
    doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(11);
    doc.text('The Sorena Visa team', margins.left, doc.y);
    doc.moveDown(0.2);
    doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.ITALIC).fontSize(9.5);
    doc.text(
      'Licensed Education Counsellor - ICEF Registered Agent - Auckland, New Zealand',
      margins.left, doc.y,
    );

    // ─── Footers on every page ────────────────────────────────────
    renderFooterOnAllPages(doc, 'client', data.applicant.submittedAt);
    doc.end();
  });
}

// ─── Copy helpers ────────────────────────────────────────────────

function coverHeadline(data: ClientReportData, firstName: string): string {
  if (data.hasHardStops) return 'We have a clear path forward - together';
  switch (data.band) {
    case 'BAND_1': return 'Thank you for sharing your story';
    case 'BAND_2': return 'You have potential - let\'s build on it';
    case 'BAND_3': return 'You\'re closer than you think';
    case 'BAND_4': return 'Welcome - your pathway is open';
    case 'BAND_5': return 'You\'re ready - let\'s move';
    case 'BAND_6': return 'You\'re an excellent candidate';
    default:       return `Hello ${firstName}`;
  }
}

function bandMeaning(band: string, hasHardStops: boolean): string {
  if (hasHardStops) return 'Specific factors need legal review before we plan your full pathway.';
  switch (band) {
    case 'BAND_1': return 'Foundations to build before applying. We have a free pathway to support you.';
    case 'BAND_2': return 'Workable potential - a few areas to develop before direct application.';
    case 'BAND_3': return 'Solid foundation with addressable gaps. A short paid session sharpens your plan.';
    case 'BAND_4': return 'You meet the requirements. Time to choose your destination.';
    case 'BAND_5': return 'A strong candidate. Priority handling from our team.';
    case 'BAND_6': return 'Exceptional profile. Premium handling and the best-matched specialist.';
    default:       return 'Your personalised pathway is in this report.';
  }
}

function buildIntroParagraph(data: ClientReportData, firstName: string): string {
  if (data.hasHardStops) {
    return `Hello ${firstName}, thank you for being transparent. Your responses include details that need to be reviewed by a Licensed Immigration Adviser before we can plan a full pathway. This is a protection, not a barrier - most cases like yours have a solution, but a licensed professional must review the specifics first.`;
  }
  switch (data.band) {
    case 'BAND_1':
      return `Hello ${firstName}, we've carefully read everything you shared. Based on where you are right now, our honest recommendation is to take a little time to build the foundations before applying. This isn't a "no" - it's a "not yet" - and it's the right move. Applying with weak foundations leads to refusals; applying with strong ones leads to acceptances.`;
    case 'BAND_2':
      return `Hello ${firstName}, thank you for taking the time to complete our assessment. We see real potential in your profile, and we want to help you turn that potential into a real plan. You're not quite ready for direct application yet, but you're closer than many people realise.`;
    case 'BAND_3':
      return `Hello ${firstName}, we've reviewed your profile carefully. You have a workable foundation - there are a few areas to develop, but they're addressable with the right guidance. At this stage, the most valuable thing we can offer you is clarity.`;
    case 'BAND_4':
      return `Hello ${firstName}, we've reviewed your profile and we're genuinely pleased. You meet the requirements to move forward, and we're ready to help you take the next step. From here, the path becomes very practical - you're not building foundations any more, you're choosing where to go.`;
    case 'BAND_5':
      return `Hello ${firstName}, we've reviewed your profile and you stand out as a strong candidate. The foundations are in place - academically, financially, and personally. At this stage we move quickly: our team will give you priority handling and the best-matched specialist.`;
    case 'BAND_6':
      return `Hello ${firstName}, your profile is exceptional. You meet every readiness criterion, and we're honoured to help you take the next step. We'll match you with our best available specialist and prioritise your case across our pipeline.`;
    default:
      return `Hello ${firstName}, we've received your responses and our team will be in touch with personalised next steps.`;
  }
}

function drawPathwayNotes(doc: PDFKit.PDFDocument, data: ClientReportData): void {
  const margins = doc.page.margins;
  const width = doc.page.width;
  const contentW = width - margins.left - margins.right;

  let note: string | null = null;
  if (data.hasHardStops) {
    note = `Your LIA Consultation (${getSessionConfig('LIA').currency} ${getSessionConfig('LIA').price}) is the gate that unlocks the rest. The adviser will review your full history confidentially and identify the safest pathway. Once cleared, every onward step opens up.`;
  } else if (data.band === 'BAND_1' || data.band === 'BAND_2') {
    note = 'The free webinar series and tailored preparation content are no cost to you. We re-assess in 3 to 6 months, when foundations are stronger - so the moment you\'re ready, your path opens.';
  } else if (data.band === 'BAND_3') {
    note = 'The Gap-Closing Roadmap Session is a focused 30-minute consultation with our Admission Specialist. You leave with a structured improvement plan tailored to your profile, plus the answers to your immediate questions.';
  } else {
    note = 'Your free 15-minute consultation is no cost, no commitment. We use it to confirm pathway, walk through next steps, and answer any final questions before opening your case file.';
  }
  doc.save();
  doc.rect(margins.left, doc.y, contentW, 70).fill(BRAND.COLORS.OFF_WHITE);
  doc.rect(margins.left, doc.y, 3, 70).fill(BRAND.COLORS.GOLD);
  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(10);
  doc.text(note, margins.left + 12, doc.y + 12, {
    width: contentW - 24, height: 60, lineGap: 2,
  });
  doc.restore();
  doc.y += 70 + 10;
  doc.x = margins.left;
}

function drawDualCountryPage(doc: PDFKit.PDFDocument): void {
  const margins = doc.page.margins;
  const width = doc.page.width;
  const contentW = width - margins.left - margins.right;

  drawSectionTitle(doc, 'TWO DESTINATIONS - YOUR CHOICE');

  doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(11);
  doc.text(
    'Sorena Visa represents universities, colleges, and polytechnics in both New Zealand and Malaysia. We help students choose the destination that fits their goals, budget, and timeline - and the choice is yours.',
    margins.left, doc.y, { width: contentW, lineGap: 3 },
  );
  doc.moveDown(0.8);

  // Two columns.
  const colW = (contentW - 16) / 2;
  const colH = 165;
  const startY = doc.y;
  drawCountryColumn(doc, margins.left, startY, colW, colH, {
    name: 'New Zealand',
    sub:  'Globally recognised - PR pathway',
    points: [
      'Strong global degree recognition',
      'Post-study work visa (1-3 years)',
      'Clear residency pathway for graduates',
      'Higher tuition and living costs',
      'Longer timeline (4-6 months prep)',
    ],
  });
  drawCountryColumn(doc, margins.left + colW + 16, startY, colW, colH, {
    name: 'Malaysia',
    sub:  'Affordable - Fast start',
    points: [
      'Lower tuition and living costs',
      'Faster admission and visa process',
      'Quality English-medium programmes',
      'Strong regional career opportunities',
      'Easier transition for first-time students',
    ],
  });
  doc.y = startY + colH + 16;
  doc.x = margins.left;

  // Philosophy callout.
  const callY = doc.y;
  const callH = 90;
  doc.save();
  doc.rect(margins.left, callY, contentW, callH).fill(BRAND.COLORS.NAVY);
  doc.rect(margins.left, callY, contentW, 3).fill(BRAND.COLORS.GOLD);
  doc.fillColor(BRAND.COLORS.GOLD).font(BRAND.FONTS.BOLD).fontSize(10.5);
  doc.text('OUR PHILOSOPHY', margins.left + 16, callY + 12, { lineBreak: false });
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BOLD).fontSize(13);
  doc.text('No charge to the student - universities pay us.', margins.left + 16, callY + 30, {
    width: contentW - 32, lineBreak: false,
  });
  doc.fillColor('#FFFFFF').font(BRAND.FONTS.BODY).fontSize(9.5);
  doc.text(
    'Sorena is paid directly by the universities and colleges we represent. Our admission and visa-coordination service costs you nothing - we earn only when you succeed, which means our interests are aligned with yours from day one.',
    margins.left + 16, callY + 50,
    { width: contentW - 32, lineGap: 2 },
  );
  doc.restore();
  doc.x = margins.left;
  doc.y = callY + callH + 14;
}

function drawCountryColumn(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  c: { name: string; sub: string; points: string[] },
): void {
  doc.save();
  doc.rect(x, y, w, h).fillAndStroke(BRAND.COLORS.OFF_WHITE, BRAND.COLORS.PALETTE.GRAYLIGHT);
  doc.rect(x, y, w, 3).fill(BRAND.COLORS.GOLD);
  doc.fillColor(BRAND.COLORS.NAVY).font(BRAND.FONTS.BOLD).fontSize(13);
  doc.text(c.name, x + 14, y + 14, { lineBreak: false, width: w - 28 });
  doc.fillColor(BRAND.COLORS.PALETTE.WARMGRAY).font(BRAND.FONTS.ITALIC).fontSize(9);
  doc.text(c.sub, x + 14, y + 32, { lineBreak: false, width: w - 28 });
  let yy = y + 52;
  for (const pt of c.points) {
    doc.fillColor(BRAND.COLORS.GOLD).circle(x + 20, yy + 4, 1.4).fill();
    doc.fillColor(BRAND.COLORS.PALETTE.NAVY_DEEP).font(BRAND.FONTS.BODY).fontSize(9.5);
    doc.text(pt, x + 28, yy, { lineBreak: false, width: w - 36 });
    yy += 18;
  }
  doc.restore();
}
