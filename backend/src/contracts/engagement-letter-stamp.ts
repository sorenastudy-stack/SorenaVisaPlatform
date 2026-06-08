import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';

/**
 * PR-DOCUSIGN-1 step 5g — stamp the LIA's identity (name + IAA
 * licence number) into the engagement letter PDF before it goes to
 * DocuSign, so the stamped text becomes part of the legal document's
 * static layer at both occurrences (page 1 Clause 2.1 and page 11
 * LIA signature block). Pure: no DB, no network, no Nest.
 *
 * Replaces the 5b/5c approach of using DocuSign text tabs for those
 * fields. Trade-off: CLIENT now sees the LIA's identity on page 1
 * from the very first email (before the LIA signs), which is the
 * intended UX — the legal document the client agrees to names the
 * LIA up front.
 *
 * Coordinates and font size constants below come from the 5g.2
 * calibration script (scripts/calibrate-stamp-coordinates.ts) which
 * uses pdfjs-dist to extract the exact (x, y) baselines of the four
 * anchor labels in the live engagement-letter-v1.pdf. Re-run that
 * script and update these constants if the PDF is ever replaced.
 *
 * Font is Caladea Regular (SIL OFL 1.1), Google's metric-clone of
 * Cambria; bundled at backend/assets/fonts/caladea-regular.ttf.
 */

// ─── 5g.2 calibration constants ──────────────────────────────────────────
//
// Source: scripts/calibrate-stamp-coordinates.ts against
// engagement-letter-v1.pdf SHA at time of writing.

const STAMP_PAGE_1_FONT_SIZE  = 11.04;
const STAMP_PAGE_11_FONT_SIZE =  9.96;

const STAMP_PAGE_1_NAME_X  = 97.66;
const STAMP_PAGE_1_NAME_Y  = 100.10;
const STAMP_PAGE_1_IAA_X   = 166.70;
const STAMP_PAGE_1_IAA_Y   = 68.30;

const STAMP_PAGE_11_NAME_X = 280.32;
const STAMP_PAGE_11_NAME_Y = 529.27;
const STAMP_PAGE_11_IAA_X  = 300.04;
const STAMP_PAGE_11_IAA_Y  = 471.19;

const CALADEA_TTF_REL_PATH = 'assets/fonts/caladea-regular.ttf';

// Fixed PDF modification date — pinning makes stamped output
// byte-deterministic for any (pdfBytes, identity) pair. Required for
// the idempotency property the spec asserts.
const PINNED_MODIFICATION_DATE = new Date('2024-01-01T00:00:00.000Z');

// ─── DocuSign anchor guard list ──────────────────────────────────────────
//
// Stamping a value that contains any of these strings would inject a
// duplicate occurrence of a previously-unique anchor, breaking
// DocuSign's tab placement at envelope-send time. The realistic risk
// is essentially zero (no human is named "SIGNED by the Client") but
// the cost of the check is negligible, so we defensively guard.
//
// The list mirrors the 4 declared-unique anchors + 11 visa-row
// labels declared in docusign.service.ts. Keep in sync if either
// list ever changes.

const DOCUSIGN_ANCHOR_GUARDS: readonly string[] = [
  'IAA Licence Number:',
  'SIGNED by the Client',
  'SIGNED by the assigned Licensed Immigration Adviser',
  'SIGNED for and on behalf of Sorena Study Limited',
  'Initial Student Visa',
  'Student Visa Renewal',
  'Post-Study Work Visa (PSWV)',
  'Dependent Partner Work Visa',
  'Dependent Child Visa (per child)',
  'Dependent Partner Visa Renewal',
  'Dependent Child Visa Renewal (per child)',
  'Visitor Visa',
  'Work Visa (post-study, employer-sponsored)',
  'Visa Variation / Condition Change',
  'Visa Resubmission (one resubmission per declined visa)',
];

// ─── Font byte cache ─────────────────────────────────────────────────────
//
// Caladea TTF is ~80KB — read once from disk and cached for the
// process lifetime (it's static repo content). Per-document
// embedFont() must still run each call (pdf-lib subsets per doc).

let cachedCaladeaBytes: Buffer | null = null;

function loadCaladeaBytes(): Buffer {
  if (cachedCaladeaBytes !== null) return cachedCaladeaBytes;
  const filePath = path.resolve(CALADEA_TTF_REL_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Caladea TTF not found at ${filePath} (cwd: ${process.cwd()}). ` +
      `Expected the file at backend/${CALADEA_TTF_REL_PATH}.`,
    );
  }
  cachedCaladeaBytes = fs.readFileSync(filePath);
  return cachedCaladeaBytes;
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface LiaIdentityForStamp {
  liaName:          string;   // stamped at all 4 positions
  iaaLicenceNumber: string;   // '' when LIA has no number on file — stamps blank
}

function rejectAnchorCollision(value: string, fieldLabel: string): void {
  for (const anchor of DOCUSIGN_ANCHOR_GUARDS) {
    if (value.includes(anchor)) {
      throw new Error(
        `Refusing to stamp engagement letter — ${fieldLabel} contains the ` +
        `DocuSign anchor string "${anchor}", which would corrupt envelope ` +
        `tab anchoring. Reject the input upstream.`,
      );
    }
  }
}

/**
 * Stamp the LIA's name + IAA licence number into the engagement
 * letter at four positions (page 1 Clause 2.1 Name, page 1 Clause
 * 2.1 IAA, page 11 LIA-block Full Name, page 11 LIA-block IAA).
 * Pure function — no I/O beyond the cached font bytes.
 *
 * Empty iaaLicenceNumber leaves the two IAA positions BLANK (the LIA
 * can write in those fields at signing time on the unlocked
 * envelope-side affordance — but as of 5g there's no DocuSign tab on
 * those positions, so a blank IAA stays blank end to end).
 */
export async function stampLiaIdentity(
  pdfBytes: Buffer,
  identity: LiaIdentityForStamp,
): Promise<Buffer> {
  rejectAnchorCollision(identity.liaName,          'liaName');
  rejectAnchorCollision(identity.iaaLicenceNumber, 'iaaLicenceNumber');

  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit as never);
  const caladea = await pdfDoc.embedFont(loadCaladeaBytes(), { subset: true });

  const page1  = pdfDoc.getPage(0);
  const page11 = pdfDoc.getPage(10);

  // Page 1 Clause 2.1 — LIA Name (always stamped) + IAA Number (if non-empty).
  page1.drawText(identity.liaName, {
    x:     STAMP_PAGE_1_NAME_X,
    y:     STAMP_PAGE_1_NAME_Y,
    size:  STAMP_PAGE_1_FONT_SIZE,
    font:  caladea,
    color: rgb(0, 0, 0),
  });
  if (identity.iaaLicenceNumber !== '') {
    page1.drawText(identity.iaaLicenceNumber, {
      x:     STAMP_PAGE_1_IAA_X,
      y:     STAMP_PAGE_1_IAA_Y,
      size:  STAMP_PAGE_1_FONT_SIZE,
      font:  caladea,
      color: rgb(0, 0, 0),
    });
  }

  // Page 11 LIA signature block (middle of three side-by-side blocks).
  page11.drawText(identity.liaName, {
    x:     STAMP_PAGE_11_NAME_X,
    y:     STAMP_PAGE_11_NAME_Y,
    size:  STAMP_PAGE_11_FONT_SIZE,
    font:  caladea,
    color: rgb(0, 0, 0),
  });
  if (identity.iaaLicenceNumber !== '') {
    page11.drawText(identity.iaaLicenceNumber, {
      x:     STAMP_PAGE_11_IAA_X,
      y:     STAMP_PAGE_11_IAA_Y,
      size:  STAMP_PAGE_11_FONT_SIZE,
      font:  caladea,
      color: rgb(0, 0, 0),
    });
  }

  // Pin the modification date for byte-deterministic output.
  pdfDoc.setModificationDate(PINNED_MODIFICATION_DATE);

  const stamped = await pdfDoc.save({ updateFieldAppearances: false });
  return Buffer.from(stamped);
}
