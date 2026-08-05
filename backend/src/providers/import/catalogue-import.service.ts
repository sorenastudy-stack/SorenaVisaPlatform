import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService, EventSource } from '../../events/events.service';
import {
  parseCatalogueWorkbook,
  providerTypeFor,
  type ParsedProgrammeRow,
  type SourceFile,
} from './catalogue-workbook.logic';

// PR-IMPORT — bulk import of the three verified NZ catalogues (91 institutions,
// 1,124 programmes) into education_providers / education_programmes.
//
// THREE RULES THIS SERVICE EXISTS TO ENFORCE:
//
//  1. IDEMPOTENT. Create-if-absent, on institutions AND programmes. Re-running never
//     duplicates. A programme that already exists is left alone unless it is still
//     PENDING and unapproved — an APPROVED programme's live data is NEVER
//     overwritten by an import, because a student may be looking at it. Changes to
//     approved rows are reported for review instead.
//
//  2. NEW INSTITUTIONS ARE NOT CONTRACTED. Created with status PENDING, never
//     ACTIVE — Yashua does not have agreements with all 91. Existing institutions
//     keep every admin-configured field (commission terms, agreement dates, status)
//     untouched; the import only fills in blanks it can source.
//
//  3. NOTHING IS AUTO-APPROVED. Every programme lands reviewStatus PENDING and
//     needs an explicit per-programme approve before the Recommendation Engine's
//     `reviewStatus: 'APPROVED'` gate will surface it.

export interface CatalogueSource {
  sourceFile: SourceFile;
  buffer: Buffer;
  fileName: string;
}

export interface CatalogueImportReport {
  dryRun: boolean;
  providersCreated: number;
  providersMatched: number;
  programmesCreated: number;
  programmesSkippedExisting: number;
  /** Existing APPROVED programmes whose source data differs — reported, never overwritten. */
  changesNeedingReview: Array<{ programmeId: string; programmeName: string; field: string; current: string | null; incoming: string | null }>;
  parseProblems: Array<{ sourceFile: string; sourceRow: number; issue: string }>;
  perFile: Array<{ sourceFile: string; rows: number; institutions: number }>;
}

/** Loose name match — institutions are matched on a normalised name. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Map the source's Qualification Type text onto the QualificationLevel enum. */
export function qualificationLevelFor(qualificationType: string | null, nzqfLevel: number | null): string {
  const t = (qualificationType ?? '').toLowerCase();
  if (/postgraduate certificate/.test(t)) return 'POSTGRADUATE_CERTIFICATE';
  if (/postgraduate diploma/.test(t)) return 'POSTGRADUATE_DIPLOMA';
  if (/graduate certificate/.test(t)) return 'GRADUATE_CERTIFICATE';
  if (/graduate diploma/.test(t)) return 'GRADUATE_DIPLOMA';
  if (/master/.test(t)) return 'MASTER';
  if (/doctor|phd/.test(t)) return 'PHD';
  if (/bachelor/.test(t)) return 'BACHELOR';
  if (/diploma/.test(t)) return 'DIPLOMA';
  if (/certificate/.test(t)) return 'CERTIFICATE';
  // Fall back on the NZQF level when the label is unfamiliar.
  if (nzqfLevel != null) {
    if (nzqfLevel >= 9) return 'MASTER';
    if (nzqfLevel === 8) return 'POSTGRADUATE_DIPLOMA';
    if (nzqfLevel === 7) return 'BACHELOR';
    if (nzqfLevel === 6) return 'DIPLOMA';
  }
  return 'CERTIFICATE';
}

/** NZQF integer → the NZQFLevel enum (LEVEL_3..LEVEL_10). */
function nzqfEnum(level: number | null): string | null {
  return level != null && level >= 3 && level <= 10 ? `LEVEL_${level}` : null;
}

/** Fields an import may refresh on an existing PENDING programme. */
const REFRESHABLE = [
  'tuitionFeeRaw', 'tuitionFeeNZD', 'tuitionParseNote', 'feeBasis', 'feeYear', 'fee2027Status',
  'academicPrerequisites', 'englishRequirementRaw', 'otherRequirements', 'scholarshipNote',
  'remaining2026Intakes', 'published2027Intakes', 'projected2027Intakes', 'intakeBasis2027',
  'intakes2027Planning', 'durationText', 'campusCity', 'deliveryMode', 'programmeUrl',
  'verificationSourceUrl', 'verificationStatus', 'notes', 'subjectAreaRaw',
] as const;

@Injectable()
export class CatalogueImportService {
  private readonly logger = new Logger(CatalogueImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async import(sources: CatalogueSource[], dryRun: boolean, actorId: string | null): Promise<CatalogueImportReport> {
    const report: CatalogueImportReport = {
      dryRun, providersCreated: 0, providersMatched: 0, programmesCreated: 0,
      programmesSkippedExisting: 0, changesNeedingReview: [], parseProblems: [], perFile: [],
    };

    const all: ParsedProgrammeRow[] = [];
    for (const src of sources) {
      const res = parseCatalogueWorkbook(src.buffer, src.sourceFile);
      all.push(...res.rows);
      res.problems.forEach((p) => report.parseProblems.push({ sourceFile: src.sourceFile, sourceRow: p.sourceRow, issue: p.issue }));
      report.perFile.push({ sourceFile: src.sourceFile, rows: res.rows.length, institutions: res.institutions.length });
    }
    if (report.parseProblems.length) return report; // never half-import a malformed file

    // ── institutions ──
    const existingProviders = await this.prisma.educationProvider.findMany({ select: { id: true, name: true } });
    const providerByNorm = new Map(existingProviders.map((p) => [norm(p.name), p.id]));

    const institutionNames = [...new Set(all.map((r) => r.institutionName))];
    for (const name of institutionNames) {
      if (providerByNorm.has(norm(name))) { report.providersMatched++; continue; }
      const sample = all.find((r) => r.institutionName === name)!;
      report.providersCreated++;
      if (dryRun) {
        // Synthetic id so the programme loop below can still resolve a provider and
        // exercise the SAME dedup path a real run takes. Without this every row
        // short-circuits at the provider guard and the dry run always reports
        // "all rows created", hiding in-source duplicates.
        providerByNorm.set(norm(name), `dry:${norm(name)}`);
        continue;
      }
      const created = await this.prisma.educationProvider.create({
        data: {
          name,
          brand: sample.brand,
          providerType: providerTypeFor(sample.sourceFile) as any,
          institutionType: (sample.sourceFile === 'University' ? 'UNIVERSITY' : sample.sourceFile === 'ITP' ? 'ITP' : 'PTE') as any,
          country: 'NZ',
          city: sample.campusCity,
          // NOT contracted. Yashua flips this to ACTIVE once an agreement exists.
          status: 'PENDING' as any,
        },
        select: { id: true },
      });
      providerByNorm.set(norm(name), created.id);
    }

    // ── programmes ──
    // Existing rows keyed by (providerId, lowercased name) — the stable identity the
    // source gives us. Loaded once rather than queried per row.
    const existingProgrammes = await this.prisma.educationProgramme.findMany({
      select: { id: true, providerId: true, name: true, reviewStatus: true, tuitionFeeRaw: true, majorStrand: true, nzqfLevel: true, campusCity: true, subjectAreaRaw: true },
    });
    // IDENTITY KEY. Name alone is NOT unique within an institution: the source
    // legitimately repeats a programme name across different strands ("Cookery
    // Strand" vs "Patisserie Strand"), different NZQF levels (a Diploma at L5 and
    // L6 are different qualifications), different campuses and different subject
    // areas. Keying on name alone silently dropped 55 real programmes on the first
    // run. Only ONE row pair in the whole 1,124 is a genuine duplicate.
    // subjectAreaRaw is part of the identity because it IS the curation tab key: two
    // rows identical but for subject area are two entries the Owner must see, one
    // under each tab. Including it leaves exactly ONE genuine duplicate in the whole
    // 1,124-row corpus, which is the only row that should ever be deduped.
    const progKey = (providerId: string, name: string, strand: string | null, nzqf: string | null, campus: string | null, subjectArea: string | null) =>
      [providerId, name.toLowerCase().trim(), (strand ?? '').toLowerCase().trim(), nzqf ?? '', (campus ?? '').toLowerCase().trim(), (subjectArea ?? '').toLowerCase().trim()].join('|');
    const byKey = new Map(existingProgrammes.map((p) => [progKey(p.providerId, p.name, p.majorStrand, p.nzqfLevel, p.campusCity, p.subjectAreaRaw), p]));

    for (const row of all) {
      const providerId = providerByNorm.get(norm(row.institutionName));
      if (!providerId) { if (dryRun) { report.programmesCreated++; continue; } throw new Error(`provider not resolved: ${row.institutionName}`); }

      const rowNzqf = nzqfEnum(row.nzqfLevel);
      const key = progKey(providerId, row.programmeName, row.majorStrand, rowNzqf, row.campusCity, row.subjectAreaRaw);
      const existing = byKey.get(key);
      if (existing) {
        report.programmesSkippedExisting++;
        // An APPROVED programme is live to students — report the difference, never write it.
        if (existing.reviewStatus === 'APPROVED' && (existing.tuitionFeeRaw ?? null) !== (row.tuitionFeeRaw ?? null)) {
          report.changesNeedingReview.push({
            programmeId: existing.id, programmeName: existing.name, field: 'tuitionFeeRaw',
            current: existing.tuitionFeeRaw ?? null, incoming: row.tuitionFeeRaw ?? null,
          });
        }
        continue;
      }

      report.programmesCreated++;
      if (dryRun) {
        // Record the key even in a dry run so a duplicate INSIDE the source files is
        // counted the same way it would be on a real run.
        byKey.set(key, { id: 'dry', providerId, name: row.programmeName, reviewStatus: 'PENDING' as any, tuitionFeeRaw: row.tuitionFeeRaw, majorStrand: row.majorStrand, nzqfLevel: rowNzqf as any, campusCity: row.campusCity, subjectAreaRaw: row.subjectAreaRaw });
        continue;
      }
      const created = await this.prisma.educationProgramme.create({
        data: {
          providerId,
          name: row.programmeName,
          level: qualificationLevelFor(row.qualificationType, row.nzqfLevel) as any,
          nzqfLevel: (nzqfEnum(row.nzqfLevel) ?? 'LEVEL_4') as any,
          subjectAreaRaw: row.subjectAreaRaw,
          majorStrand: row.majorStrand,
          qualificationType: row.qualificationType,
          deliveryMode: row.delivery,
          studentVisaSuitable: row.studentVisaSuitable ? /yes|suitable|eligible/i.test(row.studentVisaSuitable) : null,
          campusCity: row.campusCity,
          durationText: row.duration,
          tuitionFeeRaw: row.tuitionFeeRaw,
          tuitionFeeNZD: row.tuitionFeeNZD,
          tuitionParseNote: row.tuitionParseNote,
          feeBasis: row.feeBasis,
          feeYear: row.feeYear,
          fee2027Status: row.fee2027Status,
          academicPrerequisites: row.academicPrerequisites,
          englishRequirementRaw: row.englishRequirement,
          otherRequirements: row.otherRequirements,
          scholarshipNote: row.scholarshipNote,
          remaining2026Intakes: row.remaining2026Intakes,
          published2027Intakes: row.published2027Intakes,
          projected2027Intakes: row.projected2027Intakes,
          intakeBasis2027: row.intakeBasis2027,
          intakes2027Planning: row.intakes2027ForPlanning,
          programmeUrl: row.programmeUrl,
          verificationSourceUrl: row.verificationSourceUrl,
          verificationStatus: row.verificationStatus ? 'VERIFIED' as any : null,
          notes: row.notes,
          source: 'MANUAL_EXCEL' as any,
          sourceRef: `${row.sourceFile}:row${row.sourceRow}`,
          // Nothing is auto-approved and nothing is live until approved.
          reviewStatus: 'PENDING' as any,
          isActive: false,
        },
        select: { id: true },
      });
      byKey.set(key, { id: created.id, providerId, name: row.programmeName, reviewStatus: 'PENDING' as any, tuitionFeeRaw: row.tuitionFeeRaw, majorStrand: row.majorStrand, nzqfLevel: rowNzqf as any, campusCity: row.campusCity, subjectAreaRaw: row.subjectAreaRaw });
    }

    if (!dryRun) {
      // One summary entry — 1,124 individual rows would drown the audit trail.
      // Later per-field edits DO get individual entries.
      await this.events.emit(
        'CATALOGUE_IMPORTED', 'EDUCATION_PROVIDER', null, null, EventSource.USER, actorId,
        {
          files: sources.map((s) => s.fileName),
          providersCreated: report.providersCreated,
          providersMatched: report.providersMatched,
          programmesCreated: report.programmesCreated,
          programmesSkippedExisting: report.programmesSkippedExisting,
          changesNeedingReview: report.changesNeedingReview.length,
        },
      );
      this.logger.log(`Catalogue import: +${report.providersCreated} providers, +${report.programmesCreated} programmes, ${report.programmesSkippedExisting} already present`);
    }

    return report;
  }
}
