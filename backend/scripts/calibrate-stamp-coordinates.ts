/* eslint-disable no-console */
/**
 * PR-DOCUSIGN-1 step 5g.2 — extract exact (x, y) baselines and
 * label-only widths for the four LIA-identity stamp positions from
 * the engagement-letter-v1.pdf.
 *
 * Outputs ready-to-paste TypeScript constants for
 * engagement-letter-stamp.ts (built in 5g.3). Re-run this script if
 * the engagement letter PDF is ever replaced — drift in coordinates
 * would otherwise cause stamped text to land in the wrong place.
 *
 * Run:
 *   cd backend && npx ts-node scripts/calibrate-stamp-coordinates.ts
 *
 * Strategy:
 *   1. Use pdfjs-dist to extract every text fragment + its baseline
 *      transform from pages 1 and 11.
 *   2. Locate the four anchor labels by exact-string match, narrowed
 *      by column-X for page 11 (three signature blocks live side-by-
 *      side at x≈74, 230, 386; we want the LIA's middle column at 230).
 *   3. For each anchor, use Caladea (the font we'll stamp with) to
 *      measure the LABEL-ONLY width via pdf-lib + @pdf-lib/fontkit.
 *      Cambria and Caladea are metric-compatible (Caladea was
 *      explicitly designed as Cambria's open metric-clone), so this
 *      width matches the document's own rendering within ~1pt.
 *   4. stamp_x = anchor.x + caladea_label_width + small_gap
 *      stamp_y = anchor.y  (baseline = baseline)
 *   5. Print TypeScript const blocks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const PDF_PATH  = path.resolve('assets/contract-templates/engagement-letter-v1.pdf');
const FONT_PATH = path.resolve('assets/fonts/caladea-regular.ttf');

// Font sizes seen in the PDF for the surrounding label text. We
// stamp at the same size so the data visually matches the label.
const PAGE_1_FONT_SIZE  = 11.04;
const PAGE_11_FONT_SIZE =  9.96;

// Small visual gap (pt) between the label's right edge and the
// stamped value's left edge — matches the kerning the LIA would
// naturally leave between "Name:" and the data.
const STAMP_GAP_PT = 3;

// ─── Page 11 column boundaries (three signature blocks side-by-side) ────
//
// Three blocks at x ≈ 74 (CLIENT), 230 (LIA, MIDDLE), 386 (DIRECTOR).
// Filter window for LIA's column (middle):
const LIA_COL_X_MIN = 200;
const LIA_COL_X_MAX = 280;

interface TextItem {
  str:       string;
  transform: number[];   // [a, b, c, d, x, y]
  width:     number;
  height:    number;
  fontName:  string;
}

async function extractItems(page: any): Promise<TextItem[]> {
  const tc = await page.getTextContent();
  return tc.items as TextItem[];
}

function findByString(items: TextItem[], target: string): TextItem | undefined {
  // Exact match first, then prefix match.
  return (
    items.find((it) => it.str === target) ??
    items.find((it) => it.str.startsWith(target))
  );
}

function findByStringInColumn(
  items: TextItem[],
  target: string,
  xMin: number,
  xMax: number,
): TextItem | undefined {
  // Match all candidates, then pick the one whose x falls in window.
  const candidates = items.filter(
    (it) => it.str === target || it.str.startsWith(target),
  );
  return candidates.find((it) => {
    const x = it.transform[4];
    return x >= xMin && x <= xMax;
  });
}

interface CalibrationRow {
  pageNumber:        number;
  label:             string;   // doc label this anchors on (verbatim)
  anchorString:      string;   // actual fragment found (may include trailing underscores)
  anchorX:           number;
  anchorY:           number;
  anchorFullWidth:   number;
  caladeaLabelWidth: number;   // width of just the LABEL part in Caladea at this size
  fontSize:          number;
  stampX:            number;
  stampY:            number;
}

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('PR-DOCUSIGN-1 step 5g.2 — Stamp coordinate calibration');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  // Load Caladea via pdf-lib so we can measure its glyph widths.
  const ttfBytes = fs.readFileSync(FONT_PATH);
  const stagingDoc = await PDFDocument.create();
  stagingDoc.registerFontkit(fontkit as any);
  const caladea = await stagingDoc.embedFont(ttfBytes);
  console.log(`Caladea TTF loaded: ${ttfBytes.length} bytes — family ${caladea.name}`);

  // Load the engagement letter via pdfjs to extract text positions.
  const pdfBytes = new Uint8Array(fs.readFileSync(PDF_PATH));
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes, disableFontFace: true }).promise;
  console.log(`Engagement letter loaded: ${pdfBytes.length} bytes — ${pdf.numPages} pages`);
  console.log('');

  const page1  = await pdf.getPage(1);
  const page11 = await pdf.getPage(11);
  const p1items  = await extractItems(page1);
  const p11items = await extractItems(page11);

  // ─── Target 1: Page 1, "Name:" (Clause 2.1) ─────────────────────────────
  const t1Anchor = findByString(p1items, 'Name:');
  if (!t1Anchor) throw new Error('Page 1: "Name:" anchor not found.');
  const t1LabelOnly  = 'Name:';
  const t1LabelWidth = caladea.widthOfTextAtSize(t1LabelOnly, PAGE_1_FONT_SIZE);

  // ─── Target 2: Page 1, "IAA Licence Number:" (Clause 2.1) ───────────────
  // The fragment in the PDF includes trailing underscores; the label
  // part we want to measure is just "IAA Licence Number: " (with the
  // trailing space the colon-and-space convention reads to a stamper).
  const t2Anchor = findByString(p1items, 'IAA Licence Number:');
  if (!t2Anchor) throw new Error('Page 1: "IAA Licence Number:" anchor not found.');
  const t2LabelOnly  = 'IAA Licence Number: ';
  const t2LabelWidth = caladea.widthOfTextAtSize(t2LabelOnly, PAGE_1_FONT_SIZE);

  // ─── Target 3: Page 11, LIA block "Full Name:" (middle column) ──────────
  const t3Anchor = findByStringInColumn(p11items, 'Full Name:', LIA_COL_X_MIN, LIA_COL_X_MAX);
  if (!t3Anchor) throw new Error('Page 11 LIA column: "Full Name:" anchor not found.');
  const t3LabelOnly  = 'Full Name: ';
  const t3LabelWidth = caladea.widthOfTextAtSize(t3LabelOnly, PAGE_11_FONT_SIZE);

  // ─── Target 4: Page 11, LIA block "IAA Licence No:" (middle column) ─────
  const t4Anchor = findByStringInColumn(p11items, 'IAA Licence No:', LIA_COL_X_MIN, LIA_COL_X_MAX);
  if (!t4Anchor) throw new Error('Page 11 LIA column: "IAA Licence No:" anchor not found.');
  const t4LabelOnly  = 'IAA Licence No: ';
  const t4LabelWidth = caladea.widthOfTextAtSize(t4LabelOnly, PAGE_11_FONT_SIZE);

  const rows: CalibrationRow[] = [
    {
      pageNumber:        1,
      label:             'LIA Name (Clause 2.1)',
      anchorString:      t1Anchor.str,
      anchorX:           t1Anchor.transform[4],
      anchorY:           t1Anchor.transform[5],
      anchorFullWidth:   t1Anchor.width,
      caladeaLabelWidth: t1LabelWidth,
      fontSize:          PAGE_1_FONT_SIZE,
      stampX:            round2(t1Anchor.transform[4] + t1LabelWidth + STAMP_GAP_PT),
      stampY:            round2(t1Anchor.transform[5]),
    },
    {
      pageNumber:        1,
      label:             'IAA Licence Number (Clause 2.1)',
      anchorString:      t2Anchor.str,
      anchorX:           t2Anchor.transform[4],
      anchorY:           t2Anchor.transform[5],
      anchorFullWidth:   t2Anchor.width,
      caladeaLabelWidth: t2LabelWidth,
      fontSize:          PAGE_1_FONT_SIZE,
      stampX:            round2(t2Anchor.transform[4] + t2LabelWidth + STAMP_GAP_PT),
      stampY:            round2(t2Anchor.transform[5]),
    },
    {
      pageNumber:        11,
      label:             'LIA-block Full Name (page 11 middle column)',
      anchorString:      t3Anchor.str,
      anchorX:           t3Anchor.transform[4],
      anchorY:           t3Anchor.transform[5],
      anchorFullWidth:   t3Anchor.width,
      caladeaLabelWidth: t3LabelWidth,
      fontSize:          PAGE_11_FONT_SIZE,
      stampX:            round2(t3Anchor.transform[4] + t3LabelWidth + STAMP_GAP_PT),
      stampY:            round2(t3Anchor.transform[5]),
    },
    {
      pageNumber:        11,
      label:             'LIA-block IAA Licence No (page 11 middle column)',
      anchorString:      t4Anchor.str,
      anchorX:           t4Anchor.transform[4],
      anchorY:           t4Anchor.transform[5],
      anchorFullWidth:   t4Anchor.width,
      caladeaLabelWidth: t4LabelWidth,
      fontSize:          PAGE_11_FONT_SIZE,
      stampX:            round2(t4Anchor.transform[4] + t4LabelWidth + STAMP_GAP_PT),
      stampY:            round2(t4Anchor.transform[5]),
    },
  ];

  console.log('─── Anchor extraction results ─────────────────────────────────────');
  for (const r of rows) {
    console.log('');
    console.log(`  ${r.label}  (page ${r.pageNumber}, ${r.fontSize}pt)`);
    console.log(`    anchor str:    ${JSON.stringify(r.anchorString.slice(0, 60))}${r.anchorString.length > 60 ? '…' : ''}`);
    console.log(`    anchor (x,y):  (${r.anchorX.toFixed(2)}, ${r.anchorY.toFixed(2)})`);
    console.log(`    anchor width:  ${r.anchorFullWidth.toFixed(2)} pt (full string)`);
    console.log(`    caladea label width: ${r.caladeaLabelWidth.toFixed(2)} pt`);
    console.log(`    stamp at (x,y): (${r.stampX}, ${r.stampY})`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('Ready-to-paste constants for engagement-letter-stamp.ts:');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('// Font sizes — match the surrounding labels in the engagement letter.');
  console.log(`const STAMP_PAGE_1_FONT_SIZE  = ${PAGE_1_FONT_SIZE};`);
  console.log(`const STAMP_PAGE_11_FONT_SIZE = ${PAGE_11_FONT_SIZE};`);
  console.log('');
  console.log('// Page-1 Clause 2.1.');
  console.log(`const STAMP_PAGE_1_NAME_X = ${rows[0].stampX};`);
  console.log(`const STAMP_PAGE_1_NAME_Y = ${rows[0].stampY};`);
  console.log(`const STAMP_PAGE_1_IAA_X  = ${rows[1].stampX};`);
  console.log(`const STAMP_PAGE_1_IAA_Y  = ${rows[1].stampY};`);
  console.log('');
  console.log('// Page-11 LIA signature block (middle column of three).');
  console.log(`const STAMP_PAGE_11_NAME_X = ${rows[2].stampX};`);
  console.log(`const STAMP_PAGE_11_NAME_Y = ${rows[2].stampY};`);
  console.log(`const STAMP_PAGE_11_IAA_X  = ${rows[3].stampX};`);
  console.log(`const STAMP_PAGE_11_IAA_Y  = ${rows[3].stampY};`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

main().catch((err) => {
  console.error('[FAIL] calibrate-stamp-coordinates errored:');
  console.error(err);
  process.exit(1);
});
