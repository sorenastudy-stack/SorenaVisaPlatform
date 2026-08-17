import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { ProvidersService } from '../providers/providers.service';
import { PricingImportService, UploadedSheet } from '../providers/import/pricing-import.service';

// PR-PROVIDER-PORTAL slice C — an institution uploading its own spreadsheets.
//
// A WRAPPER, NOT A SECOND IMPORTER. The parsing, the flagged-row reporting, the
// dry run and the PENDING landing state all belong to the existing importer and
// are reached unchanged. What this adds is the two things a staff importer never
// needed: the target institution comes from the caller's session, and the file
// came from outside the company.
//
// THE PROVIDER ID IS NOT A PARAMETER OF THIS CLASS BY ACCIDENT — it is passed in
// already resolved by ProviderAccessGuard, and must never be sourced from a
// request or from the spreadsheet. The programme sheet has a `Brand` column
// naming an institution; ProgrammeImportService ignores it entirely whenever a
// providerId is supplied (`programme-import.service.ts`, "the Brand column is
// ignored"), which is the branch this always takes. An institution therefore
// cannot write rows onto a competitor by typing their name into a cell.

/** Institutions get .xlsx only — see assertProviderFile. */
const PROVIDER_EXT = /\.xlsx$/i;
const MAX_BYTES = 5 * 1024 * 1024;

export type ImportKind = 'programmes' | 'tuition' | 'scholarships';

interface Actor {
  providerId: string;
  providerName: string;
  userId: string | null;
}

@Injectable()
export class ProviderImportService {
  private readonly logger = new Logger(ProviderImportService.name);

  constructor(
    private readonly providers: ProvidersService,
    private readonly pricing: PricingImportService,
    private readonly events: EventsService,
  ) {}

  /**
   * The upload constraints for an EXTERNAL uploader.
   *
   * The underlying importers keep their own checks and still run — this narrows,
   * it does not replace, and nothing here can be reached without passing theirs
   * too. Two deliberate differences from the staff path:
   *
   *   • .xlsx ONLY. Staff may send .xls and .xlsm; those come from a colleague.
   *     .xlsm is macro-enabled, and while we only ever parse the file (macros are
   *     never executed, the file is never stored or served back), there is no
   *     reason to accept a macro container from an outside party at all.
   *   • The programme importer has NO size or extension check of its own —
   *     `importProgrammes` only asserts a buffer exists. Staff-only, that was
   *     defensible. Reachable by an institution, it is not, so this is the check
   *     that covers it.
   */
  private assertProviderFile(file: UploadedSheet | undefined): void {
    if (!file?.buffer) throw new BadRequestException('No file was attached. Please choose a spreadsheet.');
    const size = file.size ?? file.buffer.length;
    if (size > MAX_BYTES) {
      throw new BadRequestException(
        `That file is ${Math.round(size / 1024 / 1024)} MB. Please keep spreadsheets under 5 MB.`,
      );
    }
    if (!file.originalname || !PROVIDER_EXT.test(file.originalname)) {
      throw new BadRequestException('Please upload an Excel .xlsx file.');
    }
  }

  async run(kind: ImportKind, actor: Actor, file: UploadedSheet | undefined, dryRun: boolean) {
    this.assertProviderFile(file);

    const result = await this.dispatch(kind, actor, file, dryRun);
    await this.audit(kind, actor, file, dryRun, result);
    return { kind, dryRun, ...result };
  }

  private dispatch(kind: ImportKind, actor: Actor, file: UploadedSheet | undefined, dryRun: boolean) {
    switch (kind) {
      case 'programmes':
        // providerId is the second argument the whole boundary rests on: supplying
        // it puts ProgrammeImportService in fixed-target mode, where Brand is dead.
        return this.providers.importProgrammes(actor.providerId, file, dryRun);
      case 'tuition':
        return this.pricing.importTuitions(actor.providerId, file, dryRun, actor.userId);
      case 'scholarships':
        return this.pricing.importScholarships(actor.providerId, file, dryRun, actor.userId);
    }
  }

  /**
   * Every upload is recorded, including dry runs.
   *
   * A dry run writes no rows, but a file still arrived from outside and was
   * parsed — "who sent us what, and when" is the question an audit trail exists
   * to answer, and answering it only for the uploads that succeeded would leave
   * the interesting cases out.
   */
  private async audit(
    kind: ImportKind,
    actor: Actor,
    file: UploadedSheet | undefined,
    dryRun: boolean,
    result: Record<string, any>,
  ) {
    const flagged = Array.isArray(result?.needsReview) ? result.needsReview.length : 0;
    const rows = Array.isArray(result?.rows) ? result.rows.length : null;

    await this.events.emit(
      'PROVIDER_SELF_IMPORT',
      'EDUCATION_PROVIDER',
      actor.providerId,
      null,
      EventSource.USER,
      actor.userId,
      {
        kind,
        dryRun,
        providerName: actor.providerName,
        fileName: file?.originalname ?? null,
        fileSizeBytes: file?.size ?? file?.buffer?.length ?? null,
        rowsReady: rows,
        created: result?.created ?? null,
        updated: result?.updated ?? null,
        skipped: result?.skipped ?? result?.skippedRows ?? null,
        flagged,
      },
    );

    this.logger.log(
      `Provider self-import (${kind}${dryRun ? ', dry run' : ''}) by ${actor.providerName}: ` +
        `${result?.created ?? 0} created, ${result?.updated ?? 0} updated, ${flagged} flagged`,
    );
  }
}
