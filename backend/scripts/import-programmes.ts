/* PR-PHASE34 — idempotent importer for the NZ programme source spreadsheets
 * (ITP / University / PTE). Imports the "Programme Database" sheet as
 * EducationProvider + EducationProgramme + ProgrammeRequirement + ProgrammeIntake
 * + a StudyField tag — ALL as PENDING / not visible until staff approve.
 *
 *   npx ts-node scripts/import-programmes.ts <path-to.xlsx> [--type ITP|UNIVERSITY|PTE] [--dry]
 *
 * Idempotent: re-running matches providers by name and programmes by a natural
 * key (provider+name+campus+nzqf), updating in place — no duplicates. Intakes are
 * replaced (delete+recreate) each run. StudyField tags are upserted.
 */
import * as XLSX from 'xlsx';
import { PrismaClient, InstitutionType, ProviderType, ReviewStatus, VerificationStatus, IntakeBasis, QualificationLevel, NZQFLevel } from '@prisma/client';

const prisma = new PrismaClient();

// ── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const typeArg = (args.find((a) => a.startsWith('--type='))?.split('=')[1] ?? 'ITP').toUpperCase();
const dry = args.includes('--dry');
if (!filePath) { console.error('Usage: import-programmes.ts <file.xlsx> [--type=ITP] [--dry]'); process.exit(1); }
const INSTITUTION_TYPE = typeArg as InstitutionType;
const PROVIDER_TYPE: ProviderType = INSTITUTION_TYPE === 'UNIVERSITY' ? 'UNIVERSITY' : INSTITUTION_TYPE === 'ITP' ? 'POLYTECHNIC' : 'COLLEGE';

// ── parsers ──────────────────────────────────────────────────────────
const s = (v: unknown): string | null => { const t = v == null ? '' : String(v).trim(); return t && t !== '-' && t.toLowerCase() !== 'n/a' ? t : null; };
const yesNo = (v: unknown): boolean | null => { const t = s(v)?.toLowerCase(); return t == null ? null : /^(y|yes|true)/.test(t) ? true : /^(n|no|false)/.test(t) ? false : null; };
const num = (v: unknown): number | null => { const t = s(v)?.replace(/[^0-9.]/g, ''); const n = t ? parseFloat(t) : NaN; return Number.isFinite(n) ? n : null; };
const int = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n); };
const date = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'number') { const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null; if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d)); }
  const t = s(v); if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d;
};
const durationMonths = (v: unknown): number | null => {
  const t = s(v)?.toLowerCase(); if (!t) return null;
  const yr = t.match(/([\d.]+)\s*year/); if (yr) return Math.round(parseFloat(yr[1]) * 12);
  const mo = t.match(/([\d.]+)\s*month/); if (mo) return Math.round(parseFloat(mo[1]));
  const wk = t.match(/([\d.]+)\s*week/); if (wk) return Math.max(1, Math.round(parseFloat(wk[1]) / 4.345));
  return null;
};
const ieltsMin = (v: unknown): number | null => { const m = s(v)?.match(/ielts[^\d]*([\d.]+)/i) ?? s(v)?.match(/\b([5-9](?:\.\d)?)\b/); return m ? parseFloat(m[1]) : null; };
const nzqf = (v: unknown): NZQFLevel | null => { const n = int(v); return n != null && n >= 3 && n <= 10 ? (`LEVEL_${n}` as NZQFLevel) : null; };
const verif = (v: unknown): VerificationStatus | null => { const t = s(v)?.toLowerCase(); return t == null ? null : /verified|confirm/.test(t) ? 'VERIFIED' : /recheck|reconfirm/.test(t) ? 'NEEDS_RECHECK' : 'UNVERIFIED'; };

function qualLevel(qualType: string | null, nz: NZQFLevel | null): QualificationLevel | null {
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
  // Fallback from NZQF level.
  const lvl = nz ? parseInt(nz.replace('LEVEL_', ''), 10) : 0;
  if (lvl >= 9) return 'PHD';
  if (lvl === 8) return 'POSTGRADUATE_DIPLOMA';
  if (lvl === 7) return 'BACHELOR';
  if (lvl === 6 || lvl === 5) return 'DIPLOMA';
  if (lvl === 3 || lvl === 4) return 'CERTIFICATE';
  return null;
}

// Subject Area (+ programme title for the split cases) → StudyField key.
const unmapped: string[] = [];
function studyFieldKey(subjectArea: string | null, title: string): string {
  const sa = (subjectArea ?? '').toLowerCase();
  const nm = title.toLowerCase();
  const has = (re: RegExp) => re.test(nm);
  if (/business|management/.test(sa)) return 'business_management';
  if (/computing|it\b|information tech/.test(sa)) return 'it_computer_science';
  if (/health|nursing/.test(sa)) return has(/nurs/) ? 'nursing' : 'healthcare_medical';
  if (/engineering/.test(sa)) return 'engineering';
  if (/construction|architecture/.test(sa)) return 'construction_trades';
  if (/science|environment/.test(sa)) return 'science_environment';
  if (/hospitality|tourism/.test(sa)) return 'hospitality_culinary';
  if (/beauty|hair/.test(sa)) return 'personal_services';
  if (/sport|outdoor/.test(sa)) return 'sport_recreation';
  if (/english language|foundation|pathway/.test(sa)) return 'foundation_pathways';
  if (/creative arts|media/.test(sa)) return has(/media|journal|communicat|visual|film|broadcast/) ? 'media_communication' : 'arts_design';
  if (/education|social/.test(sa)) return has(/social|counsel|community|support work|youth/) ? 'social_community' : 'education_teaching';
  if (/other/.test(sa)) {
    if (has(/ict|informatic|comput|software|data/)) return 'it_computer_science';
    if (has(/commerce|business|account|financ/)) return 'business_management';
    if (has(/media|journal|communicat|visual|film/)) return 'media_communication';
    if (has(/art\b|design|contemporary/)) return 'arts_design';
    if (has(/mentor|leadership|supervis|professional/)) return 'business_management';
    if (has(/maritime|skipper|marine|aviation/)) return 'aviation_transport';
    if (has(/dairy|farm|agricultur|horticultur/)) return 'agriculture';
    unmapped.push(`Other → "${title}"`);
    return 'general_interdisciplinary';
  }
  unmapped.push(`${subjectArea} → "${title}"`);
  return 'other';
}

function parseIntakes(remaining: string | null, published: string | null, projected: string | null) {
  const out: { year: number; label: string; basis: IntakeBasis; needsReconfirmation: boolean }[] = [];
  const split = (v: string | null) => (v ? v.split(/[,;\/\n]+/).map((x) => x.trim()).filter(Boolean) : []);
  for (const l of split(remaining)) out.push({ year: 2026, label: l, basis: 'REMAINING', needsReconfirmation: false });
  for (const l of split(published)) out.push({ year: 2027, label: l, basis: 'PUBLISHED', needsReconfirmation: false });
  for (const l of split(projected)) out.push({ year: 2027, label: l, basis: 'PROJECTED', needsReconfirmation: true });
  return out;
}

async function main() {
  const wb = XLSX.readFile(filePath!);
  const sheet = wb.Sheets['Programme Database'] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  console.log(`Read ${rows.length} rows from "${filePath}" (type=${INSTITUTION_TYPE}${dry ? ', DRY RUN' : ''})`);

  const fieldByKey = Object.fromEntries((await prisma.studyField.findMany({ select: { key: true, id: true } })).map((f) => [f.key, f.id]));
  const providerCache = new Map<string, string>();
  let providers = 0, created = 0, updated = 0, skipped = 0;

  for (const [i, row] of rows.entries()) {
    const brand = s(row['Brand']) ?? s(row['Provider Entity']);
    const progName = s(row['Programme/Qualification']);
    if (!brand || !progName) { skipped++; continue; }

    // Provider (upsert by name).
    let providerId = providerCache.get(brand);
    if (!providerId) {
      let prov = await prisma.educationProvider.findFirst({ where: { name: brand } });
      if (!prov && !dry) {
        prov = await prisma.educationProvider.create({ data: {
          name: brand, legalEntityName: s(row['Provider Entity']), providerType: PROVIDER_TYPE,
          institutionType: INSTITUTION_TYPE, country: 'NZ', status: 'PENDING',
        } });
        providers++;
      } else if (prov && !dry) {
        await prisma.educationProvider.update({ where: { id: prov.id }, data: { institutionType: INSTITUTION_TYPE, legalEntityName: prov.legalEntityName ?? s(row['Provider Entity']) } });
      }
      providerId = prov?.id ?? `dry-${brand}`;
      providerCache.set(brand, providerId);
    }

    const nz = nzqf(row['NZQF Level']);
    const campus = s(row['Campus/City']);
    const progData = {
      providerId, name: progName, majorStrand: s(row['Major/Strand']),
      qualificationType: s(row['Qualification Type']), level: qualLevel(s(row['Qualification Type']), nz) ?? 'CERTIFICATE',
      nzqfLevel: nz ?? 'LEVEL_4', durationText: s(row['Duration']), durationMonths: durationMonths(row['Duration']),
      deliveryMode: s(row['Delivery']), studentVisaSuitable: yesNo(row['Student Visa Suitable']), campusCity: campus,
      tuitionFeeNZD: num(row['Tuition Fee (NZD)']), feeBasis: s(row['Fee Basis']), feeYear: int(row['Fee Year']),
      fee2027Status: s(row['2027 Fee Status']), scholarshipNote: s(row['Scholarship/Study Grant']),
      programmeUrl: s(row['Programme URL']), verificationSourceUrl: s(row['Secondary Verification Source']),
      verifiedAt: date(row['Verified Date']), verificationStatus: verif(row['Verification Status']),
      notes: s(row['Notes']), reviewStatus: 'PENDING' as ReviewStatus, isActive: false,
    };

    if (dry) { created++; continue; }

    const existing = await prisma.educationProgramme.findFirst({ where: { providerId, name: progName, campusCity: campus, nzqfLevel: progData.nzqfLevel } });
    const prog = existing
      ? (await prisma.educationProgramme.update({ where: { id: existing.id }, data: progData }), (updated++, existing))
      : (created++, await prisma.educationProgramme.create({ data: progData }));

    // Requirement (1:1 upsert).
    await prisma.programmeRequirement.upsert({
      where: { programmeId: prog.id },
      update: { englishRequirementText: s(row['English Requirement']), academicPrerequisites: s(row['Academic/Subject Prerequisites']), otherRequirements: s(row['Other Requirements']), englishOverallMin: ieltsMin(row['English Requirement']), reviewStatus: 'PENDING' },
      create: { programmeId: prog.id, englishRequirementText: s(row['English Requirement']), academicPrerequisites: s(row['Academic/Subject Prerequisites']), otherRequirements: s(row['Other Requirements']), englishOverallMin: ieltsMin(row['English Requirement']), reviewStatus: 'PENDING' },
    });

    // Intakes (replace).
    await prisma.programmeIntake.deleteMany({ where: { programmeId: prog.id } });
    const intakes = parseIntakes(s(row['Remaining 2026 Intake(s)']), s(row['Published 2027 Intake(s)']), s(row['Projected 2027 Intake(s)']));
    if (intakes.length) await prisma.programmeIntake.createMany({ data: intakes.map((it) => ({ ...it, programmeId: prog.id })) });

    // StudyField tag (upsert).
    const sfKey = studyFieldKey(s(row['Subject Area']), progName);
    const sfId = fieldByKey[sfKey];
    if (sfId) {
      await prisma.programmeStudyField.upsert({
        where: { programmeId_studyFieldId: { programmeId: prog.id, studyFieldId: sfId } },
        update: { isPrimary: true }, create: { programmeId: prog.id, studyFieldId: sfId, isPrimary: true },
      });
    }
    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${rows.length}`);
  }

  console.log(`\nProviders created: ${providers} | Programmes created: ${created}, updated: ${updated}, skipped(no name): ${skipped}`);
  if (unmapped.length) {
    console.log(`\n⚠ ${unmapped.length} rows fell back to general_interdisciplinary/other — review StudyField for:`);
    unmapped.slice(0, 30).forEach((u) => console.log('   ' + u));
  } else {
    console.log('All rows mapped to a specific StudyField.');
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
