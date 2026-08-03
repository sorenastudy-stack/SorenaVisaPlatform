import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { summariseChoiceSubmissions, type SubmissionOutcome } from '../submission/submission.logic';
import { planFollowUpSweep, followUpTitle, type ChoiceSweepState } from './follow-up.logic';

// PR-ADMISSION-FOLLOWUP (step 5) — raises/clears the SUBMISSION_FOLLOW_UP AdmissionTask. The daily
// sweep (idempotent; plan computed by the pure logic behind an injected clock) creates a task for
// each submission still PENDING past its Day-5 (working-day) mark, and self-heals: it resolves tasks
// whose attempt has since responded, been superseded, or been deleted. `resolveForRecord` is called
// inline by SubmissionService the moment a response is logged or an attempt is removed, so the task
// clears immediately rather than waiting for the next daily run.
@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);
  constructor(private readonly prisma: PrismaService) {}

  private ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // Close any OPEN follow-up task for a specific submission record (its response arrived / it was
  // removed). Idempotent — updateMany over the open ones.
  async resolveForRecord(recordId: string, actorId: string | null = null): Promise<number> {
    const r = await this.prisma.admissionTask.updateMany({
      where: { type: 'SUBMISSION_FOLLOW_UP', status: 'OPEN', referenceId: recordId },
      data: { status: 'DONE', resolvedAt: new Date(), resolvedById: actorId },
    });
    return r.count;
  }

  async runDailySweep(now: Date = new Date()): Promise<{ created: number; resolved: number }> {
    const openTasks = await this.prisma.admissionTask.findMany({
      where: { type: 'SUBMISSION_FOLLOW_UP', status: 'OPEN' },
      select: { id: true, referenceId: true },
    });
    const openByRecord = new Map<string, string>();
    for (const t of openTasks) if (t.referenceId) openByRecord.set(t.referenceId, t.id);

    // Choices "in play" = those with a PENDING attempt (might become due) or an open task (might
    // need resolving). We load ALL attempts of those choices so the "latest attempt" is accurate.
    const pending = await this.prisma.submissionRecord.findMany({ where: { outcome: 'PENDING' }, select: { admissionProgrammeChoiceId: true } });
    const openRecordIds = [...openByRecord.keys()];
    const openRecs = openRecordIds.length
      ? await this.prisma.submissionRecord.findMany({ where: { id: { in: openRecordIds } }, select: { admissionProgrammeChoiceId: true } })
      : [];
    const choiceIds = [...new Set([...pending.map((p) => p.admissionProgrammeChoiceId), ...openRecs.map((r) => r.admissionProgrammeChoiceId)])];
    if (choiceIds.length === 0) return { created: 0, resolved: 0 };

    const [records, choices] = await Promise.all([
      this.prisma.submissionRecord.findMany({
        where: { admissionProgrammeChoiceId: { in: choiceIds } },
        select: { id: true, admissionProgrammeChoiceId: true, submittedAt: true, createdAt: true, outcome: true },
      }),
      this.prisma.admissionProgrammeChoice.findMany({
        where: { id: { in: choiceIds } },
        select: {
          id: true,
          admissionApplication: { select: { caseId: true, case: { select: { consultantId: true } } } },
          programme: { select: { name: true, provider: { select: { name: true } } } },
        },
      }),
    ]);

    const recsByChoice = new Map<string, typeof records>();
    for (const r of records) {
      const arr = recsByChoice.get(r.admissionProgrammeChoiceId) ?? [];
      arr.push(r);
      recsByChoice.set(r.admissionProgrammeChoiceId, arr);
    }
    const choiceInfo = new Map(choices.map((c) => [c.id, c]));

    const states: ChoiceSweepState[] = choiceIds.map((choiceId) => {
      const rows = recsByChoice.get(choiceId) ?? [];
      const summary = summariseChoiceSubmissions(rows.map((r) => ({ id: r.id, submittedAt: this.ymd(r.submittedAt), createdAt: r.createdAt.toISOString(), outcome: r.outcome as SubmissionOutcome })));
      const latest = summary.latestId
        ? { recordId: summary.latestId, submittedAt: this.ymd(rows.find((r) => r.id === summary.latestId)!.submittedAt), outcome: summary.latestOutcome! }
        : null;
      const openTaskRecordIds = rows.filter((r) => openByRecord.has(r.id)).map((r) => r.id);
      return { choiceId, latest, openTaskRecordIds };
    });

    const plan = planFollowUpSweep(states, now);

    // Resolve first (cheap), then create.
    let resolved = 0;
    for (const recordId of plan.toResolve) {
      const taskId = openByRecord.get(recordId);
      if (!taskId) continue;
      await this.prisma.admissionTask.update({ where: { id: taskId }, data: { status: 'DONE', resolvedAt: new Date(), resolvedById: null } });
      resolved++;
    }

    let created = 0;
    for (const { choiceId, recordId } of plan.toCreate) {
      const info = choiceInfo.get(choiceId);
      if (!info?.admissionApplication) continue;
      const rec = (recsByChoice.get(choiceId) ?? []).find((r) => r.id === recordId);
      if (!rec) continue;
      await this.prisma.admissionTask.create({
        data: {
          caseId: info.admissionApplication.caseId,
          assignedToId: info.admissionApplication.case?.consultantId ?? null, // null → unassigned queue
          type: 'SUBMISSION_FOLLOW_UP',
          urgent: false,
          title: followUpTitle(info.programme.name, info.programme.provider?.name ?? null, this.ymd(rec.submittedAt)),
          referenceId: recordId,
        },
      });
      created++;
    }

    return { created, resolved };
  }
}
