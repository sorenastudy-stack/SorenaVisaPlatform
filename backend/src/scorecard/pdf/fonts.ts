import fs from 'fs';
import path from 'path';
import type PDFKit from 'pdfkit';

// PR-PERSIAN-CLIENT-REPORT — Persian typeface for the client report.
//
// WHY A BUNDLED FONT AT ALL. pdfkit's built-in fonts are the PDF base-14
// (Helvetica et al), which are Latin-only: every Persian character renders as
// an empty box. A Persian report therefore has to embed a font, and the
// production image is `node:22-alpine` with no system fonts, so the file must
// travel with the repo. This mirrors what engagement-letter-stamp.ts already
// does with Caladea — same assets/fonts location, same "resolve from cwd and
// fail loudly" loader, same Dockerfile COPY.
//
// WHY VAZIRMATN, and not the two fonts considered first:
//   • Calibri  — Regular/Bold do carry Persian, but Calibri ITALIC has no
//                Arabic glyphs at all (22 of 26 glyphs in a Persian test
//                sentence come back .notdef), and it is licensed with
//                Windows/Office, so it cannot be committed here.
//   • Carlito  — the metric-compatible libre stand-in for Calibri, and the
//                obvious parallel to Caladea/Cambria. It has NO Persian in any
//                weight (1 of 11 codepoints, and that one is ZWNJ). It is a
//                Latin/Greek/Cyrillic/Vietnamese face. Metric compatibility
//                also turned out to be moot: this report is set in Helvetica,
//                not Calibri, so there is no Calibri layout to preserve.
//   • Vazirmatn — SIL OFL (redistributable), full Persian AND Latin coverage
//                in every weight used here, and already the platform's
//                Persian typeface elsewhere.
//
// NO ITALIC, DELIBERATELY. Persian script has no italic tradition — Vazirmatn
// ships nine weights and zero italics, which is a design decision rather than
// an omission. The four passages the English report sets in italic are secondary
// asides (the band meaning, "every area has room to grow", the counsellor
// credential line, the country-column subtitles), so Persian renders them in the
// LIGHT weight: still visibly quieter than body text, where bold would have
// inverted the intent into emphasis.

const FONT_DIR = 'assets/fonts';

export const VAZIR = {
  BODY:  'Vazirmatn',
  BOLD:  'Vazirmatn-Bold',
  LIGHT: 'Vazirmatn-Light',
} as const;

const FILES: Record<string, string> = {
  [VAZIR.BODY]:  'vazirmatn-regular.ttf',
  [VAZIR.BOLD]:  'vazirmatn-bold.ttf',
  [VAZIR.LIGHT]: 'vazirmatn-light.ttf',
};

const cache = new Map<string, Buffer>();

function loadFontBytes(name: string): Buffer {
  const cached = cache.get(name);
  if (cached) return cached;
  const rel = `${FONT_DIR}/${FILES[name]}`;
  const filePath = path.resolve(rel);
  if (!fs.existsSync(filePath)) {
    // Loud rather than silent: pdfkit would otherwise fall back to Helvetica
    // and emit a Persian report that is entirely empty boxes — a failure that
    // looks like a rendering bug rather than a missing file.
    throw new Error(
      `Vazirmatn TTF not found at ${filePath} (cwd: ${process.cwd()}). ` +
      `Expected the file at backend/${rel}. If this fires in a container, the ` +
      `Dockerfile is not COPYing assets/.`,
    );
  }
  const bytes = fs.readFileSync(filePath);
  cache.set(name, bytes);
  return bytes;
}

/**
 * Register the three Persian faces on a document.
 *
 * Only called for Persian renders — an English report never registers them and
 * so is byte-for-byte what it was before this phase.
 */
export function registerPersianFonts(doc: PDFKit.PDFDocument): void {
  for (const name of Object.values(VAZIR)) {
    doc.registerFont(name, loadFontBytes(name));
  }
}

/** Readable at boot / in tests without constructing a document. */
export function persianFontFilesPresent(): boolean {
  return Object.values(VAZIR).every((n) => fs.existsSync(path.resolve(`${FONT_DIR}/${FILES[n]}`)));
}
