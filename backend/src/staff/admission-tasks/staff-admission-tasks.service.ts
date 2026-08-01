import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// PR-INTAKE-1 (Slice 3) — the Admission Officer's task list. Surfaces the
// INTAKE_REASSIGNED (routine) + INTAKE_REASSIGN_FAILED (urgent) tasks created at
// submit time. Default view = OPEN tasks assigned to the caller OR unassigned (so
// the unassigned queue is visible); admin tier can request everything.

const ADMIN_ROLES = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

@Injectable()
export class StaffAdmissionTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, role: string, scope?: string) {
    const where: any = { status: 'OPEN' };
    const wantAll = scope === 'all' && ADMIN_ROLES.has(role);
    if (!wantAll) where.OR = [{ assignedToId: userId }, { assignedToId: null }]; // mine + unassigned queue

    const rows = await this.prisma.admissionTask.findMany({
      where,
      orderBy: [{ urgent: 'desc' }, { createdAt: 'asc' }], // urgent first, then oldest
      include: { case: { select: { id: true, lead: { select: { contact: { select: { fullName: true } } } } } } },
    });
    return rows.map((t) => ({
      id: t.id, caseId: t.caseId, type: t.type, status: t.status, urgent: t.urgent,
      title: t.title, referenceId: t.referenceId, assignedToId: t.assignedToId,
      studentName: t.case?.lead?.contact?.fullName ?? null,
      createdAt: t.createdAt,
    }));
  }

  async resolve(taskId: string, userId: string) {
    const task = await this.prisma.admissionTask.findUnique({ where: { id: taskId }, select: { id: true, status: true } });
    if (!task) throw new NotFoundException('Task not found.');
    return this.prisma.admissionTask.update({
      where: { id: taskId },
      data: { status: 'DONE', resolvedAt: new Date(), resolvedById: userId },
      select: { id: true, status: true, resolvedAt: true },
    });
  }
}
