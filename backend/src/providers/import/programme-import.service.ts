import { Injectable } from '@nestjs/common';
import type { InstitutionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  s, ieltsMin, studyFieldKey, parseIntakes, rowToProgrammeData, providerTypeFor, parseSheet,
} from './programme-import.logic';

// PR-CATALOG-1 — shared Excel importer. Same parse/map/upsert as the original CLI
// (idempotent: providers by name, programmes by provider+name+campus+nzqf; intakes
// replaced; StudyField upserted). ALL rows land PENDING / isActive:false with
// source=MANUAL_EXCEL — invisible to students until per-programme Owner approval.
//
// Two modes:
//   • providerId set (Owner-panel per-institution upload) → every row attaches to
//     that provider; the Brand column is ignored.
//   • providerId unset (CLI bulk file) → providers upserted by the Brand column.

export interface ImportOptions {
  institutionType: InstitutionType; // used when creating providers by Brand
  providerId?: string;              // fixed target provider (per-institution upload)
  sourceRef: string;                // batch id / filename — provenance
  dryRun?: boolean;
}
export interface ImportSummary {
  providersCreated: number; created: number; updated: number; skipped: number; unmapped: string[];
}

@Injectable()
export class ProgrammeImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importFromXlsx(buffer: Buffer, opts: ImportOptions): Promise<ImportSummary> {
    return this.importRows(parseSheet(buffer), opts);
  }

  async importRows(rows: Record<string, unknown>[], opts: ImportOptions): Promise<ImportSummary> {
    const fieldByKey = Object.fromEntries(
      (await this.prisma.studyField.findMany({ select: { key: true, id: true } })).map((f) => [f.key, f.id]),
    );
    const providerCache = new Map<string, string>();
    const summary: ImportSummary = { providersCreated: 0, created: 0, updated: 0, skipped: 0, unmapped: [] };

    for (const row of rows) {
      const progName = s(row['Programme/Qualification']);
      if (!progName) { summary.skipped++; continue; }

      // ── Resolve the provider ───────────────────────────────────────────────
      let providerId = opts.providerId;
      if (!providerId) {
        const brand = s(row['Brand']) ?? s(row['Provider Entity']);
        if (!brand) { summary.skipped++; continue; }
        providerId = providerCache.get(brand);
        if (!providerId) {
          let prov = await this.prisma.educationProvider.findFirst({ where: { name: brand } });
          if (!prov && !opts.dryRun) {
            prov = await this.prisma.educationProvider.create({ data: {
              name: brand, legalEntityName: s(row['Provider Entity']), providerType: providerTypeFor(opts.institutionType),
              institutionType: opts.institutionType, country: 'NZ', status: 'PENDING',
            } });
            summary.providersCreated++;
          } else if (prov && !opts.dryRun) {
            await this.prisma.educationProvider.update({ where: { id: prov.id }, data: { institutionType: opts.institutionType, legalEntityName: prov.legalEntityName ?? s(row['Provider Entity']) } });
          }
          providerId = prov?.id ?? `dry-${brand}`;
          providerCache.set(brand, providerId);
        }
      }

      const campus = s(row['Campus/City']);
      const progData = { ...rowToProgrammeData(row, providerId), source: 'MANUAL_EXCEL' as const, sourceRef: opts.sourceRef };

      // StudyField tag (collected for the summary even on dry runs).
      const sf = studyFieldKey(s(row['Subject Area']), progName);
      if (sf.unmapped) summary.unmapped.push(`${s(row['Subject Area']) ?? 'Other'} → "${progName}"`);

      if (opts.dryRun) { summary.created++; continue; }

      const existing = await this.prisma.educationProgramme.findFirst({ where: { providerId, name: progName, campusCity: campus, nzqfLevel: progData.nzqfLevel } });
      const prog = existing
        ? (await this.prisma.educationProgramme.update({ where: { id: existing.id }, data: progData }), (summary.updated++, existing))
        : (summary.created++, await this.prisma.educationProgramme.create({ data: progData }));

      await this.prisma.programmeRequirement.upsert({
        where: { programmeId: prog.id },
        update: { englishRequirementText: s(row['English Requirement']), academicPrerequisites: s(row['Academic/Subject Prerequisites']), otherRequirements: s(row['Other Requirements']), englishOverallMin: ieltsMin(row['English Requirement']), reviewStatus: 'PENDING' },
        create: { programmeId: prog.id, englishRequirementText: s(row['English Requirement']), academicPrerequisites: s(row['Academic/Subject Prerequisites']), otherRequirements: s(row['Other Requirements']), englishOverallMin: ieltsMin(row['English Requirement']), reviewStatus: 'PENDING' },
      });

      await this.prisma.programmeIntake.deleteMany({ where: { programmeId: prog.id } });
      const intakes = parseIntakes(s(row['Remaining 2026 Intake(s)']), s(row['Published 2027 Intake(s)']), s(row['Projected 2027 Intake(s)']));
      if (intakes.length) await this.prisma.programmeIntake.createMany({ data: intakes.map((it) => ({ ...it, programmeId: prog.id })) });

      const sfId = fieldByKey[sf.key];
      if (sfId) {
        await this.prisma.programmeStudyField.upsert({
          where: { programmeId_studyFieldId: { programmeId: prog.id, studyFieldId: sfId } },
          update: { isPrimary: true }, create: { programmeId: prog.id, studyFieldId: sfId, isPrimary: true },
        });
      }
    }
    return summary;
  }
}
