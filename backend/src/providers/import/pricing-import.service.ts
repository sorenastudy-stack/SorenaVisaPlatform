import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { EventSource } from '@prisma/client';
import { parseScholarshipWorkbook } from './scholarship-import.logic';
import { parseTuitionWorkbook } from './tuition-import.logic';

// PR-EXPLORE (Rounds 2+3) — the Owner/Staff bulk upload path for a university's
// per-nationality SCHOLARSHIP and TUITION sheets. Mirrors ProgrammeImportService:
// the parsing lives in the pure *-import.logic.ts files, this class does the DB
// writes and the audit trail.
//
// Both flows are deliberately identical in shape (same validation, same dry-run,
// same report), because Yashua uploads both for an institution in one sitting.
//
// SAFETY RULES:
//   • dryRun=true parses and reports WITHOUT writing — the admin screen previews
//     the detected countries before anything is committed.
//   • Rows in `needsReview` are NEVER written. Partial success is the norm: good
//     rows import, flagged rows come back for a human.
//   • Every committed upload emits an audit event (who, which provider, counts).

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — these sheets are small
const ALLOWED_EXT = /\.(xlsx|xlsm|xls)$/i;

export interface UploadedSheet {
  buffer?: Buffer;
  originalname?: string;
  size?: number;
  mimetype?: string;
}

@Injectable()
export class PricingImportService {
  private readonly logger = new Logger(PricingImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  private assertValidFile(file: UploadedSheet | undefined): Buffer {
    if (!file?.buffer) throw new BadRequestException('No file uploaded.');
    const size = file.size ?? file.buffer.length;
    if (size > MAX_BYTES) {
      throw new BadRequestException(`File is too large (${Math.round(size / 1024)} KB). Maximum is 5 MB.`);
    }
    if (file.originalname && !ALLOWED_EXT.test(file.originalname)) {
      throw new BadRequestException('Only Excel files (.xlsx, .xlsm, .xls) can be uploaded here.');
    }
    return file.buffer;
  }

  private async assertProvider(providerId: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id: providerId },
      select: { id: true, name: true },
    });
    if (!provider) throw new NotFoundException('Institution not found.');
    return provider;
  }

  // ── Scholarships ───────────────────────────────────────────────────────────

  async importScholarships(providerId: string, file: UploadedSheet | undefined, dryRun: boolean, actorId: string | null) {
    const buffer = this.assertValidFile(file);
    const provider = await this.assertProvider(providerId);

    let preview: ReturnType<typeof parseScholarshipWorkbook>;
    try {
      preview = parseScholarshipWorkbook(buffer);
    } catch (e) {
      throw new BadRequestException(`Could not read the spreadsheet: ${(e as Error).message}`);
    }

    if (dryRun) return { dryRun: true, provider, ...preview, created: 0 };

    let created = 0;
    for (const row of preview.rows) {
      await this.prisma.providerScholarship.create({
        data: {
          providerId,
          nationality: row.countryCode,
          programmeId: null, // sheet is provider-wide; per-programme scoping is a manual edit
          level: null,
          name: row.name,
          amountType: row.amountType,
          amountValue: row.amountValue,
          currency: row.currency,
          eligibilityNotes: row.eligibilityNotes,
          isActive: true,
          updatedById: actorId,
        },
      });
      created++;
    }

    await this.events.emit(
      'SCHOLARSHIP_SHEET_IMPORTED',
      'EDUCATION_PROVIDER',
      providerId,
      null,
      EventSource.USER,
      actorId,
      {
        providerName: provider.name,
        fileName: file?.originalname ?? null,
        created,
        countries: preview.detected.map((d) => `${d.countryCode}:${d.count}`),
        flagged: preview.needsReview.length,
      },
    );
    this.logger.log(`Scholarship sheet imported for ${provider.name}: ${created} rows, ${preview.needsReview.length} flagged`);

    return { dryRun: false, provider, ...preview, created };
  }

  // ── Tuition ────────────────────────────────────────────────────────────────

  async importTuitions(providerId: string, file: UploadedSheet | undefined, dryRun: boolean, actorId: string | null) {
    const buffer = this.assertValidFile(file);
    const provider = await this.assertProvider(providerId);

    let preview: ReturnType<typeof parseTuitionWorkbook>;
    try {
      preview = parseTuitionWorkbook(buffer);
    } catch (e) {
      throw new BadRequestException(`Could not read the spreadsheet: ${(e as Error).message}`);
    }

    if (dryRun) return { dryRun: true, provider, ...preview, created: 0, updated: 0 };

    let created = 0;
    let updated = 0;
    for (const row of preview.rows) {
      // Re-uploading the same year's sheet should CORRECT the rate, not stack a
      // second row — otherwise resolveStudentTuition would pick between duplicates.
      const existing = await this.prisma.providerTuition.findFirst({
        where: {
          providerId,
          nationality: row.countryCode,
          programmeId: null,
          level: (row.level as any) ?? null,
          feeYear: row.feeYear,
        },
        select: { id: true, amountValue: true, currency: true, term: true, notes: true },
      });

      if (existing) {
        // PR-PROVIDER-PORTAL slice C — RE-REVIEW A CHANGED PRICE.
        //
        // `reviewStatus` defaults to PENDING, and a default only applies on
        // CREATE. This branch updates in place, so before this an APPROVED row
        // silently kept its approval while its figure changed — a second upload
        // could move a live price with nobody looking at it, which is the exact
        // thing slice A's gate exists to prevent. It was latent then (zero
        // tuition rows anywhere) and stops being latent the moment institutions
        // upload their own sheets.
        //
        // An unchanged row keeps its approval: re-uploading the same sheet is a
        // normal thing to do and should not throw away staff decisions.
        const figuresChanged =
          Number(existing.amountValue) !== Number(row.amountValue) ||
          existing.currency !== row.currency ||
          (existing.term ?? null) !== (row.term ?? null) ||
          (existing.notes ?? null) !== (row.notes ?? null);

        await this.prisma.providerTuition.update({
          where: { id: existing.id },
          data: {
            amountValue: row.amountValue, currency: row.currency, term: row.term, notes: row.notes,
            isActive: true, updatedById: actorId,
            ...(figuresChanged ? { reviewStatus: 'PENDING' as const } : {}),
          },
        });
        updated++;
      } else {
        await this.prisma.providerTuition.create({
          data: {
            providerId,
            programmeId: null,
            level: (row.level as any) ?? null,
            nationality: row.countryCode,
            amountValue: row.amountValue,
            currency: row.currency,
            feeYear: row.feeYear,
            term: row.term,
            notes: row.notes,
            isActive: true,
            updatedById: actorId,
          },
        });
        created++;
      }
    }

    await this.events.emit(
      'TUITION_SHEET_IMPORTED',
      'EDUCATION_PROVIDER',
      providerId,
      null,
      EventSource.USER,
      actorId,
      {
        providerName: provider.name,
        fileName: file?.originalname ?? null,
        created,
        updated,
        countries: preview.detected.map((d) => `${d.countryCode}:${d.count}`),
        flagged: preview.needsReview.length,
      },
    );
    this.logger.log(`Tuition sheet imported for ${provider.name}: ${created} created, ${updated} updated, ${preview.needsReview.length} flagged`);

    return { dryRun: false, provider, ...preview, created, updated };
  }
}
