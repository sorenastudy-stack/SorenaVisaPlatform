import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  validateSubmissionInput,
  summariseChoiceSubmissions,
  type SubmissionInput,
  type SubmissionMethod,
  type SubmissionOutcome,
} from './submission.logic';

// PR-ADMISSION-SUBMIT (step 4) — the per-institution Submission Log. APPEND-ONLY: `create` logs a
// new attempt (submission facts frozen), `recordResponse` completes the institution's response to a
// specific attempt (outcome/response fields only — the submission facts stay frozen), and a
// resubmission is simply another `create`. `remove` is for correcting a mis-entered attempt.
// Logging is gated to submitted applications (the shared finality signal Steps 2b/3 also use).
@Injectable()
export class SubmissionService {
  constructor(private readonly prisma: PrismaService) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async loadApp(caseId: string) {
    const app = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      include: {
        programmeChoices: {
          orderBy: { priority: 'asc' },
          include: { programme: { select: { name: true, provider: { select: { name: true } } } } },
        },
      },
    });
    return app;
  }

  private assertSubmitted(status: string | null | undefined) {
    if (status !== 'SUBMITTED' && status !== 'LOCKED') {
      throw new BadRequestException('Log institution submissions after the client submits their programme choices.');
    }
  }

  private shape(r: {
    id: string; admissionProgrammeChoiceId: string; submittedAt: Date; method: string; portalName: string | null;
    referenceNo: string | null; outcome: string; responseReceivedAt: Date | null; responseNotes: string | null;
    submittedById: string | null; createdAt: Date;
  }) {
    const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
    return {
      id: r.id, choiceId: r.admissionProgrammeChoiceId, submittedAt: d(r.submittedAt)!, method: r.method,
      portalName: r.portalName, referenceNo: r.referenceNo, outcome: r.outcome,
      responseReceivedAt: d(r.responseReceivedAt), responseNotes: r.responseNotes,
      submittedById: r.submittedById, createdAt: r.createdAt.toISOString(),
    };
  }

  // The Case File submission surface: every submitted programme choice with its attempt history
  // (newest first) and derived current status.
  async list(caseId: string) {
    const app = await this.loadApp(caseId);
    const choices = app?.programmeChoices ?? [];
    const records = choices.length
      ? await this.prisma.submissionRecord.findMany({
          where: { admissionProgrammeChoiceId: { in: choices.map((c: any) => c.id) } },
          orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        })
      : [];
    const byChoice = new Map<string, any[]>();
    for (const r of records) {
      const arr = byChoice.get(r.admissionProgrammeChoiceId) ?? [];
      arr.push(r);
      byChoice.set(r.admissionProgrammeChoiceId, arr);
    }
    const out = choices.map((ch: any) => {
      const rows = byChoice.get(ch.id) ?? [];
      const summary = summariseChoiceSubmissions(rows.map((r) => ({ id: r.id, submittedAt: r.submittedAt.toISOString().slice(0, 10), createdAt: r.createdAt.toISOString(), outcome: r.outcome as SubmissionOutcome })));
      return {
        choiceId: ch.id,
        priority: ch.priority,
        programme: ch.programme.name,
        provider: ch.programme.provider?.name ?? null,
        intake: { month: ch.intakeMonth ?? null, year: ch.intakeYear ?? null },
        currentOutcome: summary.latestOutcome,
        attemptCount: summary.attemptCount,
        attempts: rows.map((r) => this.shape(r)),
      };
    });
    return { applicationStatus: app?.status ?? null, choices: out };
  }

  async create(caseId: string, input: SubmissionInput, actorId: string | null) {
    const app = await this.loadApp(caseId);
    this.assertSubmitted(app?.status ?? null);
    const choice = (app?.programmeChoices ?? []).find((c: any) => c.id === (input as any).choiceId);
    if (!choice) throw new NotFoundException('Programme choice not found on this case.');

    const errors = validateSubmissionInput(input, this.today());
    if (errors.length) throw new BadRequestException(errors.join(' '));

    const created = await this.prisma.submissionRecord.create({
      data: {
        caseId,
        admissionProgrammeChoiceId: choice.id,
        submittedAt: new Date(`${input.submittedAt}T00:00:00Z`),
        method: input.method as SubmissionMethod,
        portalName: input.portalName?.trim() || null,
        referenceNo: input.referenceNo?.trim() || null,
        outcome: (input.outcome as SubmissionOutcome) || 'PENDING',
        responseReceivedAt: input.responseReceivedAt ? new Date(`${input.responseReceivedAt}T00:00:00Z`) : null,
        responseNotes: input.responseNotes?.trim() || null,
        submittedById: actorId,
      },
    });
    return this.shape(created);
  }

  // Complete the institution's RESPONSE to one specific attempt — outcome + response fields only.
  // The submission facts (date/method/portal/ref) stay frozen; a fresh submission is a new attempt.
  async recordResponse(
    caseId: string,
    id: string,
    body: { outcome?: string; responseReceivedAt?: string | null; responseNotes?: string | null },
  ) {
    const rec = await this.prisma.submissionRecord.findUnique({ where: { id } });
    if (!rec || rec.caseId !== caseId) throw new NotFoundException('Submission record not found on this case.');

    // Validate the response fields against the frozen submission date.
    const errors = validateSubmissionInput(
      {
        submittedAt: rec.submittedAt.toISOString().slice(0, 10),
        method: rec.method,
        outcome: body.outcome ?? rec.outcome,
        responseReceivedAt: body.responseReceivedAt ?? (rec.responseReceivedAt?.toISOString().slice(0, 10) ?? null),
      },
      this.today(),
    );
    if (errors.length) throw new BadRequestException(errors.join(' '));

    const updated = await this.prisma.submissionRecord.update({
      where: { id },
      data: {
        outcome: (body.outcome as SubmissionOutcome) || rec.outcome,
        responseReceivedAt:
          body.responseReceivedAt === undefined
            ? rec.responseReceivedAt
            : body.responseReceivedAt
              ? new Date(`${body.responseReceivedAt}T00:00:00Z`)
              : null,
        responseNotes: body.responseNotes === undefined ? rec.responseNotes : (body.responseNotes?.trim() || null),
      },
    });
    return this.shape(updated);
  }

  // Delete a mis-entered attempt (the only mutation of the submission facts — for error correction).
  async remove(caseId: string, id: string) {
    const rec = await this.prisma.submissionRecord.findUnique({ where: { id } });
    if (!rec || rec.caseId !== caseId) throw new NotFoundException('Submission record not found on this case.');
    await this.prisma.submissionRecord.delete({ where: { id } });
    return { deleted: true };
  }
}
