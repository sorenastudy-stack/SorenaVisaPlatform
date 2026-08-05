import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import {
  activationTarget, changedFields, decideDeactivation, matchingBlockedReason, type StudentHold,
} from './programme-curation.logic';
import type { SetProgrammeActivationDto, UpdateProgrammeDto } from './dto/update-programme.dto';

// PR-CURATION — the Owner's review screen for imported programmes.
//
// Every write here is audited. The import phase surfaced that provider status
// changes leave no trace at all, which makes "who made this live" unanswerable
// after the fact; these actions decide what students can see, so they record
// actor, entity and the exact field-level diff from the start.
@Injectable()
export class ProgrammeCurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  /** Everything the curation screen needs for one institution, in one round trip. */
  async listForProvider(providerId: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id: providerId },
      select: { id: true, name: true, brand: true, status: true, providerType: true, institutionType: true },
    });
    if (!provider) throw new NotFoundException('Institution not found.');

    const programmes = await this.prisma.educationProgramme.findMany({
      where: { providerId },
      orderBy: [{ subjectAreaRaw: 'asc' }, { name: 'asc' }],
    });

    // One query for every student hold across the institution, rather than one
    // per programme — an institution can carry 100+ programmes and the screen
    // needs the warning state on every row up front.
    const holds = await this.prisma.admissionProgrammeChoice.groupBy({
      by: ['programmeId'],
      where: { programmeId: { in: programmes.map((p) => p.id) } },
      _count: { programmeId: true },
    });
    const holdCount = new Map(holds.map((h) => [h.programmeId, h._count.programmeId]));

    const subjectAreas = [...programmes.reduce((m, p) => {
      const k = p.subjectAreaRaw ?? 'Unspecified';
      return m.set(k, (m.get(k) ?? 0) + 1);
    }, new Map<string, number>())]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
      provider,
      subjectAreas,
      programmes: programmes.map((p) => ({
        ...p,
        studentHolds: holdCount.get(p.id) ?? 0,
        matchingBlockedReason: matchingBlockedReason(p, provider.status),
      })),
    };
  }

  /**
   * Direct edit. Saves immediately — this is a human correcting catalogue facts,
   * NOT the change-proposal flow, which exists for automated re-uploads and
   * web-checks proposing changes to an ALREADY-APPROVED programme.
   */
  async updateProgramme(programmeId: string, dto: UpdateProgrammeDto, actorId: string | null) {
    const before = await this.prisma.educationProgramme.findUnique({ where: { id: programmeId } });
    if (!before) throw new NotFoundException('Programme not found.');

    const diff = changedFields(before as any, dto as any);
    if (Object.keys(diff).length === 0) return { ...before, changed: [] as string[] };

    // Empty strings from cleared inputs become null so the column stays
    // genuinely empty rather than holding "".
    const data: Record<string, any> = {};
    for (const key of Object.keys(diff)) {
      const v = (dto as any)[key];
      data[key] = v === '' ? null : v;
    }

    const updated = await this.prisma.educationProgramme.update({ where: { id: programmeId }, data });

    await this.eventsService.emit(
      'PROGRAMME_EDITED', 'EDUCATION_PROGRAMME', programmeId, null, EventSource.USER, actorId,
      { programmeName: before.name, providerId: before.providerId, changed: diff },
    );

    return { ...updated, changed: Object.keys(diff) };
  }

  /**
   * The Active/Inactive switch — the gate on Recommendation Engine eligibility.
   *
   * Deactivating a programme students already hold returns 409 with the
   * affected cases the first time; the Owner re-sends with confirm:true.
   */
  async setActivation(programmeId: string, dto: SetProgrammeActivationDto, actorId: string | null) {
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: programmeId },
      select: { id: true, name: true, providerId: true, reviewStatus: true, isActive: true },
    });
    if (!programme) throw new NotFoundException('Programme not found.');

    const holds: StudentHold[] = dto.active ? [] : await this.studentHolds(programmeId);
    const decision = decideDeactivation(dto.active, holds, dto.confirm === true);
    if (!decision.allowed) {
      // `details` is the opt-in the global exception filter preserves; without
      // it the refusal reaches the client as a bare sentence and the UI cannot
      // show who is affected or offer the confirmation.
      throw new ConflictException({
        message: decision.message,
        details: {
          code: 'CONFIRMATION_REQUIRED',
          affected: decision.affected,
          // The client re-sends the same call with confirm: true.
          retryWith: { active: dto.active, confirm: true },
        },
      });
    }

    const target = activationTarget(dto.active);
    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: target,
      select: { id: true, name: true, reviewStatus: true, isActive: true },
    });

    await this.eventsService.emit(
      dto.active ? 'PROGRAMME_ACTIVATED' : 'PROGRAMME_DEACTIVATED',
      'EDUCATION_PROGRAMME', programmeId, null, EventSource.USER, actorId,
      {
        programmeName: programme.name,
        providerId: programme.providerId,
        from: { reviewStatus: programme.reviewStatus, isActive: programme.isActive },
        to: target,
        affectedStudentChoices: decision.affected.length,
        confirmed: dto.confirm === true,
      },
    );

    const provider = await this.prisma.educationProvider.findUnique({
      where: { id: programme.providerId }, select: { status: true },
    });
    return {
      ...updated,
      warning: matchingBlockedReason(updated, provider?.status ?? 'PENDING'),
    };
  }

  /** Students who have already chosen this programme, for the deactivation warning. */
  private async studentHolds(programmeId: string): Promise<StudentHold[]> {
    const choices = await this.prisma.admissionProgrammeChoice.findMany({
      where: { programmeId },
      select: {
        admissionApplicationId: true,
        // The student's name lives on the Contact, and the case's external
        // reference is its INZ number (null until INZ issues one).
        admissionApplication: {
          select: {
            caseId: true,
            contact: { select: { fullName: true } },
            case: { select: { inzApplicationNumber: true } },
          },
        },
      },
    });
    return choices.map((c) => ({
      admissionApplicationId: c.admissionApplicationId,
      studentName: c.admissionApplication?.contact?.fullName ?? null,
      caseReference: c.admissionApplication?.case?.inzApplicationNumber
        ?? c.admissionApplication?.caseId
        ?? null,
    }));
  }

  /** Bulk activation for a whole subject area — same guard, applied per programme. */
  async setActivationBulk(programmeIds: string[], active: boolean, confirm: boolean, actorId: string | null) {
    if (!programmeIds.length) throw new BadRequestException('No programmes selected.');
    const results: Array<{ programmeId: string; ok: boolean; reason?: string }> = [];
    for (const id of programmeIds) {
      try {
        await this.setActivation(id, { active, confirm }, actorId);
        results.push({ programmeId: id, ok: true });
      } catch (e: any) {
        results.push({ programmeId: id, ok: false, reason: e?.response?.error ?? e?.message ?? 'failed' });
      }
    }
    return { updated: results.filter((r) => r.ok).length, skipped: results.filter((r) => !r.ok), results };
  }
}
