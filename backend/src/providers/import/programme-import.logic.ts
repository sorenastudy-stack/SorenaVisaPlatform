// `xlsx` (SheetJS) is loaded LAZILY: recent versions live only on SheetJS's own CDN, so a clean
// `npm ci --only=production` in Docker can end up without it — and a top-level import would then
// crash app boot for everyone, even though only the (optional) spreadsheet-import feature needs it.
// The Proxy defers `require('xlsx')` until the module is actually used, so boot never depends on it.
let _xlsx: any;
const XLSX: any = new Proxy({}, { get: (_t, prop) => { _xlsx ??= require('xlsx'); return _xlsx[prop]; } });
import type { InstitutionType, ProviderType, NZQFLevel, QualificationLevel, VerificationStatus, IntakeBasis } from '@prisma/client';

// PR-CATALOG-1 — pure parse/map logic for the NZ programme spreadsheet, extracted
// verbatim from scripts/import-programmes.ts so the CLI and the Owner-panel upload
// share ONE code path. No DB access here — the ProgrammeImportService does the
// upserts. `studyFieldKey` returns an `unmapped` flag (was a module-level array).

export const s = (v: unknown): string | null => { const t = v == null ? '' : String(v).trim(); return t && t !== '-' && t.toLowerCase() !== 'n/a' ? t : null; };
export const yesNo = (v: unknown): boolean | null => { const t = s(v)?.toLowerCase(); return t == null ? null : /^(y|yes|true)/.test(t) ? true : /^(n|no|false)/.test(t) ? false : null; };
export const num = (v: unknown): number | null => { const t = s(v)?.replace(/[^0-9.]/g, ''); const n = t ? parseFloat(t) : NaN; return Number.isFinite(n) ? n : null; };
export const int = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n); };
export const date = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'number') { const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null; if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d)); }
  const t = s(v); if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d;
};
export const durationMonths = (v: unknown): number | null => {
  const t = s(v)?.toLowerCase(); if (!t) return null;
  const yr = t.match(/([\d.]+)\s*year/); if (yr) return Math.round(parseFloat(yr[1]) * 12);
  const mo = t.match(/([\d.]+)\s*month/); if (mo) return Math.round(parseFloat(mo[1]));
  const wk = t.match(/([\d.]+)\s*week/); if (wk) return Math.max(1, Math.round(parseFloat(wk[1]) / 4.345));
  return null;
};
export const ieltsMin = (v: unknown): number | null => { const m = s(v)?.match(/ielts[^\d]*([\d.]+)/i) ?? s(v)?.match(/\b([5-9](?:\.\d)?)\b/); return m ? parseFloat(m[1]) : null; };
export const nzqf = (v: unknown): NZQFLevel | null => { const n = int(v); return n != null && n >= 3 && n <= 10 ? (`LEVEL_${n}` as NZQFLevel) : null; };
export const verif = (v: unknown): VerificationStatus | null => { const t = s(v)?.toLowerCase(); return t == null ? null : /verified|confirm/.test(t) ? 'VERIFIED' : /recheck|reconfirm/.test(t) ? 'NEEDS_RECHECK' : 'UNVERIFIED'; };

export function providerTypeFor(institutionType: InstitutionType): ProviderType {
  return institutionType === 'UNIVERSITY' ? 'UNIVERSITY' : institutionType === 'ITP' ? 'POLYTECHNIC' : 'COLLEGE';
}

export function qualLevel(qualType: string | null, nz: NZQFLevel | null): QualificationLevel | null {
  const t = (qualType ?? '').toLowerCase();
  if (/postgraduate certificate/.test(t)) return 'POSTGRADUATE_CERTIFICATE';
  if (/postgraduate diploma/.test(t)) return 'POSTGRADUATE_DIPLOMA';
  if (/graduate certificate/.test(t)) return 'GRADUATE_CERTIFICATE';
  if (/graduate diploma/.test(t)) return 'GRADUATE_DIPLOMA';
  if (/master/.test(t)) return 'MASTER';
  if (/doctor|phd/.test(t)) return 'PHD';
  if (/bachelor|degree/.test(t)) return 'BACHELOR';
  if (/diploma/.test(t)) return 'DIPLOMA';
  if (/certificate/.test(t)) return 'CERTIFICATE';
  const lvl = nz ? parseInt(nz.replace('LEVEL_', ''), 10) : 0;
  if (lvl >= 9) return 'PHD';
  if (lvl === 8) return 'POSTGRADUATE_DIPLOMA';
  if (lvl === 7) return 'BACHELOR';
  if (lvl === 6 || lvl === 5) return 'DIPLOMA';
  if (lvl === 3 || lvl === 4) return 'CERTIFICATE';
  return null;
}

// Subject Area (+ programme title for the split cases) → StudyField key.
export function studyFieldKey(subjectArea: string | null, title: string): { key: string; unmapped: boolean } {
  const sa = (subjectArea ?? '').toLowerCase();
  const nm = title.toLowerCase();
  const has = (re: RegExp) => re.test(nm);
  if (/business|management/.test(sa)) return { key: 'business_management', unmapped: false };
  if (/computing|it\b|information tech/.test(sa)) return { key: 'it_computer_science', unmapped: false };
  if (/health|nursing/.test(sa)) return { key: has(/nurs/) ? 'nursing' : 'healthcare_medical', unmapped: false };
  if (/engineering/.test(sa)) return { key: 'engineering', unmapped: false };
  if (/construction|architecture|trades|welding|plumb|carpentr|joinery|electrical|automotive/.test(sa)) {
    return { key: 'construction_trades', unmapped: false };
  }
  if (/science|environment/.test(sa)) return { key: 'science_environment', unmapped: false };
  // Culinary sits ABOVE the arts branch on purpose: "Culinary Arts / Cookery"
  // and "Pâtisserie" are hospitality, and a broader arts rule would steal them.
  if (/hospitality|tourism|culinar|cookery|patisserie|pâtisserie|baking|food, wine/.test(sa)) {
    return { key: 'hospitality_culinary', unmapped: false };
  }
  if (/beauty|hair|barber|massage/.test(sa)) return { key: 'personal_services', unmapped: false };
  if (/sport|outdoor|equine/.test(sa)) return { key: 'sport_recreation', unmapped: false };
  if (/english language|foundation|pathway/.test(sa)) return { key: 'foundation_pathways', unmapped: false };
  // PR-PHASE37 — these keys existed in the taxonomy from the start but nothing
  // reached them, because the only tests for agriculture/aviation were nested
  // inside the `other` branch below. 220 of 1,129 production programmes were
  // landing in `other` as a result, including 31 law and 21 aviation rows.
  if (/agricultur|horticultur|viticultur|dairy|farm(ing)?\b/.test(sa)) {
    return { key: 'agriculture', unmapped: false };
  }
  if (/aviation|pilot|rererangi|maritime|marine|diving|transport|logistics/.test(sa)) {
    return { key: 'aviation_transport', unmapped: false };
  }
  if (/\blaw\b|legal|criminal justice|politic|government/.test(sa)) {
    return { key: 'law_government', unmapped: false };
  }
  // Performing arts, screen, audio and music all belong with design rather than
  // with journalism — the media split below is about communication, not craft.
  if (/creative arts|media|performing arts|art and design|art & design|arts,|game art|songwriting|screen|audio|music|film|animation|advertising|creative techn|creative\/performance/.test(sa)) {
    return {
      key: has(/media|journal|communicat|broadcast|advertis/) ? 'media_communication' : 'arts_design',
      unmapped: false,
    };
  }
  if (/communication studies/.test(sa)) return { key: 'media_communication', unmapped: false };
  // Psychology → healthcare_medical, deliberately, for two reasons. The tag
  // decides which applicants are SHOWN a programme, and people looking for
  // psychology look under health. More importantly `social_community` carries
  // backgroundWeight 0, so routing psychology there would also score a real
  // psychology degree as 0 for field of study when used as a Q13 answer.
  // Counselling without psychology stays social/community via the branch below.
  if (/psychology/.test(sa)) return { key: 'healthcare_medical', unmapped: false };
  if (/pharmac|chinese medicine/.test(sa)) return { key: 'healthcare_medical', unmapped: false };
  if (/education|social/.test(sa)) return { key: has(/social|counsel|community|support work|youth/) ? 'social_community' : 'education_teaching', unmapped: false };
  if (/counsel|youth work|community service/.test(sa)) return { key: 'social_community', unmapped: false };
  if (/property|valuation|financial services/.test(sa)) return { key: 'business_management', unmapped: false };
  // Humanities-shaped subjects: real disciplines with no dedicated key, so they
  // go to the general bucket rather than to `other`. `unmapped: false` because
  // this IS the intended destination, not a failure to place them.
  if (/theolog|christian|ministry|religio|humanities|language and culture|intercultural|international studies|maori|māori|indigenous|te ara poutama|te kawa a maui|te reo/.test(sa)) {
    return { key: 'general_interdisciplinary', unmapped: false };
  }
  if (/other/.test(sa)) {
    if (has(/ict|informatic|comput|software|data/)) return { key: 'it_computer_science', unmapped: false };
    if (has(/commerce|business|account|financ/)) return { key: 'business_management', unmapped: false };
    if (has(/media|journal|communicat|visual|film/)) return { key: 'media_communication', unmapped: false };
    if (has(/art\b|design|contemporary/)) return { key: 'arts_design', unmapped: false };
    if (has(/mentor|leadership|supervis|professional/)) return { key: 'business_management', unmapped: false };
    if (has(/maritime|skipper|marine|aviation/)) return { key: 'aviation_transport', unmapped: false };
    if (has(/dairy|farm|agricultur|horticultur/)) return { key: 'agriculture', unmapped: false };
    return { key: 'general_interdisciplinary', unmapped: true };
  }
  return { key: 'other', unmapped: true };
}

export function parseIntakes(remaining: string | null, published: string | null, projected: string | null) {
  const out: { year: number; label: string; basis: IntakeBasis; needsReconfirmation: boolean }[] = [];
  const split = (v: string | null) => (v ? v.split(/[,;\/\n]+/).map((x) => x.trim()).filter(Boolean) : []);
  for (const l of split(remaining)) out.push({ year: 2026, label: l, basis: 'REMAINING', needsReconfirmation: false });
  for (const l of split(published)) out.push({ year: 2027, label: l, basis: 'PUBLISHED', needsReconfirmation: false });
  for (const l of split(projected)) out.push({ year: 2027, label: l, basis: 'PROJECTED', needsReconfirmation: true });
  return out;
}

// One spreadsheet row → the EducationProgramme data (minus source/sourceRef, which
// the service stamps). Kept identical to the original importer mapping.
export function rowToProgrammeData(row: Record<string, unknown>, providerId: string) {
  const nz = nzqf(row['NZQF Level']);
  return {
    providerId, name: s(row['Programme/Qualification'])!, majorStrand: s(row['Major/Strand']),
    qualificationType: s(row['Qualification Type']), level: qualLevel(s(row['Qualification Type']), nz) ?? 'CERTIFICATE',
    nzqfLevel: nz ?? 'LEVEL_4', durationText: s(row['Duration']), durationMonths: durationMonths(row['Duration']),
    deliveryMode: s(row['Delivery']), studentVisaSuitable: yesNo(row['Student Visa Suitable']), campusCity: s(row['Campus/City']),
    tuitionFeeNZD: num(row['Tuition Fee (NZD)']), feeBasis: s(row['Fee Basis']), feeYear: int(row['Fee Year']),
    fee2027Status: s(row['2027 Fee Status']), scholarshipNote: s(row['Scholarship/Study Grant']),
    programmeUrl: s(row['Programme URL']), verificationSourceUrl: s(row['Secondary Verification Source']),
    verifiedAt: date(row['Verified Date']), verificationStatus: verif(row['Verification Status']),
    notes: s(row['Notes']), reviewStatus: 'PENDING' as const, isActive: false,
  };
}

export function parseSheet(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets['Programme Database'] ?? wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
}
