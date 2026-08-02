import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  buildProgrammeChoiceAuditData, programmeLabel, studentTicketNotice,
  type ProgrammeChoiceAction,
} from '../../students/admission/programme-choice-notice';
import { notifyAdmissionTicket } from '../../students/admission/admission-ticket.util';
import { ProgrammeChoiceRulesService } from '../../students/admission/programme-choice-rules.service';

// PR-ADMISSION-SHARED — Admission Officer (CONSULTANT) CRUD over the SAME
// AdmissionProgrammeChoice list the student edits in Apply/Study Step 1. One
// shared list, both sides act on it. Staff edits are NOT locked by application
// status (staff are the curator role). Every staff edit: (1) writes case history
// (AuditLog, same as the student side) AND (2) notifies the student via a ticket.
// See PHASE_ADMISSION_CHOICES_SHARED.md for the full matrix.

interface Actor { id: string | null; name?: string | null; role?: string | null }

const CHOICE_INCLUDE = {
  programmeChoices: {
    orderBy: { priority: 'asc' as const },
    include: { programme: { select: { name: true, provider: { select: { name: true, institutionType: true } } } } },
  },
};

@Injectable()
export class StaffAdmissionChoicesService {
  private readonly logger = new Logger(StaffAdmissionChoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly choiceRules: ProgrammeChoiceRulesService,
  ) {}

  private async loadApplication(caseId: string) {
    const app = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      include: CHOICE_INCLUDE,
    });
    if (!app) throw new NotFoundException('No admission application for this case yet.');
    return app;
  }

  private shape(c: any) {
    return {
      id: c.id, programmeId: c.programmeId, programmeName: c.programme?.name ?? null,
      providerName: c.programme?.provider?.name ?? null,
      // PR-ADMISSION-CASEFILE — institution type drives the Case File type badges +
      // mandatory-position status display (read-only; same source as the student surface).
      institutionType: c.programme?.provider?.institutionType ?? null,
      intakeMonth: c.intakeMonth, intakeYear: c.intakeYear, priority: c.priority,
    };
  }

  async list(caseId: string) {
    const app = await this.loadApplication(caseId);
    return { applicationStatus: app.status, choices: app.programmeChoices.map((c) => this.shape(c)) };
  }

  async add(caseId: string, body: { programmeId: string; intakeMonth: number; intakeYear: number }, actor: Actor) {
    const app = await this.loadApplication(caseId); // NB: no status lock for staff
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: body.programmeId },
      include: { provider: { select: { name: true } } },
    });
    if (!programme) throw new NotFoundException('Programme not found.');

    if (app.programmeChoices.some((c) => c.programmeId === body.programmeId && c.intakeMonth === body.intakeMonth && c.intakeYear === body.intakeYear)) {
      throw new ConflictException('This programme + intake is already on the list.');
    }
    if (app.programmeChoices.some((c) => c.programmeId === body.programmeId)) {
      throw new ConflictException('This programme is already selected (one intake per programme).');
    }

    await this.prisma.admissionProgrammeChoice.create({
      data: {
        admissionApplicationId: app.id,
        programmeId: body.programmeId,
        intakeMonth: body.intakeMonth,
        intakeYear: body.intakeYear,
        priority: app.programmeChoices.length + 1,
      },
    });

    const label = programmeLabel(programme.provider?.name, programme.name);
    await this.logHistory(caseId, 'ADDED', actor, label);
    await this.notifyStudent(caseId, 'ADDED', label, actor);
    return this.list(caseId);
  }

  async remove(caseId: string, choiceId: string, actor: Actor) {
    const app = await this.loadApplication(caseId);
    const choice = app.programmeChoices.find((c) => c.id === choiceId);
    if (!choice) throw new NotFoundException('Programme choice not found on this list.');

    await this.prisma.admissionProgrammeChoice.delete({ where: { id: choiceId } });
    const remaining = app.programmeChoices.filter((c) => c.id !== choiceId);
    await Promise.all(remaining.map((c, i) =>
      this.prisma.admissionProgrammeChoice.update({ where: { id: c.id }, data: { priority: i + 1 } })));

    const label = programmeLabel((choice as any).programme?.provider?.name, (choice as any).programme?.name);
    await this.logHistory(caseId, 'REMOVED', actor, label);
    await this.notifyStudent(caseId, 'REMOVED', label, actor);
    return this.list(caseId);
  }

  async reorder(caseId: string, orderedIds: string[], actor: Actor) {
    const app = await this.loadApplication(caseId);
    const current = new Set(app.programmeChoices.map((c) => c.id));
    const incoming = new Set(orderedIds);
    if (current.size !== incoming.size || ![...current].every((id) => incoming.has(id))) {
      throw new BadRequestException('orderedIds must contain exactly the current programme choices.');
    }
    // PR-SLOTRULES — same reorder-hole guard as the student path (no-op when the rule is off).
    const choiceById = new Map(app.programmeChoices.map((c) => [c.id, c]));
    await this.choiceRules.assertNoWrongTypeInMandatory(
      orderedIds.map((id, i) => ({ programmeId: choiceById.get(id)!.programmeId, priority: i + 1 })),
    );
    await Promise.all(orderedIds.map((id, i) =>
      this.prisma.admissionProgrammeChoice.update({ where: { id }, data: { priority: i + 1 } })));

    await this.logHistory(caseId, 'REORDERED', actor, null);
    await this.notifyStudent(caseId, 'REORDERED', null, actor);
    return this.list(caseId);
  }

  // ── Case history (both sides land here — unified audit trail) ────────────────
  private async logHistory(caseId: string, action: ProgrammeChoiceAction, actor: Actor, label: string | null) {
    try {
      await this.prisma.auditLog.create({
        data: buildProgrammeChoiceAuditData({
          caseId, action, actorSide: 'STAFF',
          actorId: actor.id, actorName: actor.name ?? null, actorRole: actor.role ?? 'CONSULTANT',
          programmeLabel: label,
        }),
      });
    } catch (e) {
      this.logger.warn(`programme-choice history log failed for case ${caseId}: ${(e as Error).message}`);
    }
  }

  // ── Student notification (staff actions only) — one persistent ADMISSIONS
  //    thread per case; append a SYSTEM message per action. Best-effort. ────────
  private async notifyStudent(caseId: string, action: ProgrammeChoiceAction, label: string | null, actor: Actor) {
    try {
      await notifyAdmissionTicket(this.prisma, this.crypto, {
        caseId, message: studentTicketNotice(action, label ?? ''), authorId: actor.id,
      });
    } catch (e) {
      this.logger.warn(`programme-choice student notification failed for case ${caseId}: ${(e as Error).message}`);
    }
  }
}
