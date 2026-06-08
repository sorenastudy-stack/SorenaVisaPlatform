/**
 * PR-DOCUSIGN-1 step 5g.3 — pure spec for stampLiaIdentity().
 *
 * Loads the real engagement-letter-v1.pdf as a fixture, stamps it,
 * and round-trips the output through pdfjs-dist to verify the new
 * text fragments land at the expected positions. No network, no DB,
 * no Nest.
 *
 * One-time stamping happens in beforeAll(), shared across the
 * positional tests, so the full suite runs in ~2s despite the heavy
 * PDF I/O.
 */

import * as fs from 'fs';
import * as path from 'path';
import { stampLiaIdentity } from './engagement-letter-stamp';

// pdfjs-dist needs require() because its legacy build is CJS-style
// and ships without modern ESM exports. Same import shape as the
// 5g.2 calibration script.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const PDF_PATH = path.resolve(
  __dirname,
  '../../assets/contract-templates/engagement-letter-v1.pdf',
);

const LIA_NAME = 'Sheila Rose';
const IAA      = '202300520';

interface TextItem {
  str:       string;
  transform: number[];
  width:     number;
  height:    number;
}

async function extractItemsByPage(
  pdfBytes: Buffer,
): Promise<{ p1: TextItem[]; p11: TextItem[]; numPages: number }> {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    disableFontFace: true,
  }).promise;
  const p1Page  = await pdf.getPage(1);
  const p11Page = await pdf.getPage(11);
  const p1  = (await p1Page.getTextContent()).items  as TextItem[];
  const p11 = (await p11Page.getTextContent()).items as TextItem[];
  return { p1, p11, numPages: pdf.numPages };
}

describe('stampLiaIdentity (PR-DOCUSIGN-1 step 5g.3)', () => {
  const pdfBytes = fs.readFileSync(PDF_PATH);

  let stamped: Buffer;
  let p1items:  TextItem[];
  let p11items: TextItem[];
  let numPages: number;

  beforeAll(async () => {
    stamped = await stampLiaIdentity(pdfBytes, {
      liaName:          LIA_NAME,
      iaaLicenceNumber: IAA,
    });
    const ext = await extractItemsByPage(stamped);
    p1items  = ext.p1;
    p11items = ext.p11;
    numPages = ext.numPages;
  });

  it('returns a valid PDF (starts with %PDF magic bytes)', () => {
    expect(stamped.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('preserves the original 11-page count', () => {
    expect(numPages).toBe(11);
  });

  it('stamps the LIA name on page 1 near Clause 2.1 Name: position', () => {
    const found = p1items.find((it) => it.str === LIA_NAME);
    expect(found).toBeDefined();
    expect(Math.abs(found!.transform[4] - 97.66)).toBeLessThan(2);
    expect(Math.abs(found!.transform[5] - 100.10)).toBeLessThan(2);
  });

  it('stamps the IAA number on page 1 near Clause 2.1 IAA Licence Number position', () => {
    const found = p1items.find((it) => it.str === IAA);
    expect(found).toBeDefined();
    expect(Math.abs(found!.transform[4] - 166.70)).toBeLessThan(2);
    expect(Math.abs(found!.transform[5] - 68.30)).toBeLessThan(2);
  });

  it('stamps the LIA name in the page-11 LIA block (middle column)', () => {
    const found = p11items.find((it) => it.str === LIA_NAME);
    expect(found).toBeDefined();
    expect(Math.abs(found!.transform[4] - 280.32)).toBeLessThan(2);
    expect(Math.abs(found!.transform[5] - 529.27)).toBeLessThan(2);
  });

  it('stamps the IAA number in the page-11 LIA block (middle column)', () => {
    const found = p11items.find((it) => it.str === IAA);
    expect(found).toBeDefined();
    expect(Math.abs(found!.transform[4] - 300.04)).toBeLessThan(2);
    expect(Math.abs(found!.transform[5] - 471.19)).toBeLessThan(2);
  });

  it('is idempotent — stamping twice with same inputs produces byte-equal output', async () => {
    const second = await stampLiaIdentity(pdfBytes, {
      liaName:          LIA_NAME,
      iaaLicenceNumber: IAA,
    });
    expect(second.equals(stamped)).toBe(true);
  });

  it('with empty iaaLicenceNumber, IAA stamps are absent but the LIA name still stamps', async () => {
    const partial = await stampLiaIdentity(pdfBytes, {
      liaName:          LIA_NAME,
      iaaLicenceNumber: '',
    });
    const ext = await extractItemsByPage(partial);
    expect(ext.p1.find((it) => it.str === LIA_NAME)).toBeDefined();
    expect(ext.p1.find((it) => it.str === IAA)).toBeUndefined();
    expect(ext.p11.find((it) => it.str === LIA_NAME)).toBeDefined();
    expect(ext.p11.find((it) => it.str === IAA)).toBeUndefined();
  });

  it('rejects when liaName contains a DocuSign anchor string', async () => {
    await expect(
      stampLiaIdentity(pdfBytes, {
        liaName:          'SIGNED by the Client',
        iaaLicenceNumber: IAA,
      }),
    ).rejects.toThrow(/SIGNED by the Client/);
  });

  it('rejects when iaaLicenceNumber contains a DocuSign anchor string (visa-row label)', async () => {
    await expect(
      stampLiaIdentity(pdfBytes, {
        liaName:          LIA_NAME,
        iaaLicenceNumber: 'Visitor Visa',
      }),
    ).rejects.toThrow(/Visitor Visa/);
  });
});
