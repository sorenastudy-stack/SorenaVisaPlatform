import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

// PR-LIA-2 — LIA auto-assignment + manual reassignment.
//
// Mirrors PR-CONSULT-1's load-based auto-allocation
// (backend/src/staff/assignments/assignments.service.ts):
//
//   * Candidate pool: users where role='LIA' AND isActive=true AND
//     (staffActiveStatus IS NULL OR staffActiveStatus.isActive=true)
//   * Workload count: open cases on this LIA (stage NOT IN
//     COMPLETED/WITHDRAWN). PR-CONSULT-1 counted VisaCaseAssignment
//     rows; PR-LIA-2 counts CRM Case.liaId directly. Different target
//     model, same intent.
//   * Pick: lowest count wins. Tie-break by createdAt ASC (oldest
//     hire first), matching PR-CONSULT-1.
//
// PR-LIA-2 explicitly does NOT consider `User.specialisedCountries`
// — that column is forward-compat for PR-LIA-2.1's country router.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface RosterRow {
  id: string;
  name: string;
  email: string;
  openCases: number;
}

interface ManualReassignDto {
  liaId: string | null;
  reason: string;
}

interface ManualReassignOwnerDto {
  ownerId: string | null;
  reason: string;
}

interface ManualReassignSupportDto {
  supportId: string | null;
  reason: string;
}

interface ManualReassignFinanceDto {
  financeId: string | null;
  reason: string;
}

interface ManualReassignConsultantDto {
  consultantId: string | null;
  reason: string;
}

interface AssignResult {
  status: 'assigned' | 'no_candidates' | 'already_assigned';
  liaId: string | null;
  liaName: string | null;
}

// Phase 2a — result of consultant auto-assignment. Mirrors AssignResult.
interface ConsultantAssignResult {
  status: 'assigned' | 'no_candidates' | 'already_assigned';
  consultantId: string | null;
  consultantName: string | null;
  langMatched: boolean;
}

// Phase 3 — result of Admission-Specialist (owner slot) auto-assignment.
// `replacedStrayOwner` is true when a non-CONSULTANT owner (e.g. a CRM/sales
// owner pre-set on the case) was replaced by a real Admission Specialist.
interface AdmissionAssignResult {
  status: 'assigned' | 'no_candidates' | 'already_assigned';
  ownerId: string | null;
  ownerName: string | null;
  replacedStrayOwner: boolean;
}

// Phase 3 — result of Finance-officer (finance slot) auto-assignment.
interface FinanceAssignResult {
  status: 'assigned' | 'no_candidates' | 'already_assigned';
  financeId: string | null;
  financeName: string | null;
}

@Injectable()
export class LiaAssignmentService {
  private readonly logger = new Logger(LiaAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── Roster ────────────────────────────────────────────────────────────

  async getRoster(): Promise<RosterRow[]> {
    const candidates = await this.findActiveLias();
    const rows: RosterRow[] = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      openCases: c.liaCases.length,
    }));
    // Sort: lowest openCases first, then oldest createdAt (already
    // returned in that order by the DB) as a stable tie-breaker.
    rows.sort((a, b) => a.openCases - b.openCases);
    return rows;
  }

  // ─── Auto-assign on contract sign ──────────────────────────────────────

  async assignLiaToCase(caseId: string, triggerActor?: Actor): Promise<AssignResult> {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, liaId: true, lead: { select: { contact: { select: { fullName: true } } } } },
    });
    if (!existing) {
      this.logger.warn(`assignLiaToCase: case ${caseId} not found`);
      return { status: 'no_candidates', liaId: null, liaName: null };
    }
    if (existing.liaId) {
      // Idempotency: don't replace an existing assignment. Manual
      // reassignment lives on a different endpoint.
      return { status: 'already_assigned', liaId: existing.liaId, liaName: null };
    }

    const candidates = await this.findActiveLias();
    if (candidates.length === 0) {
      this.logger.warn(
        `assignLiaToCase: no active LIAs available for case ${caseId} — leaving unassigned`,
      );
      await this.prisma.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'LIA_AUTO_ASSIGN_NO_CANDIDATES',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { reason: 'no_active_lias' } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return { status: 'no_candidates', liaId: null, liaName: null };
    }

    // Lowest open-case count wins; ties broken by createdAt ASC (the
    // DB sort order, preserved by the linear scan below).
    let pick = candidates[0]!;
    for (const c of candidates) {
      if (c.liaCases.length < pick.liaCases.length) pick = c;
    }

    const candidatesAudit = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      openCases: c.liaCases.length,
    }));

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        // PR-LIA-3: stamp the assignment time inside the same tx so
        // the productivity report's time-to-action / time-to-resolution
        // calculations have a reference point.
        data: { liaId: pick.id, liaAssignedAt: new Date() },
        select: { id: true, leadId: true },
      });
      await tx.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'LIA_AUTO_ASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            liaId: pick.id,
            liaName: pick.name,
            candidates: candidatesAudit,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System (contract signed)',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return u;
    });

    // Best-effort email — fire-and-forget; never blocks the caller.
    this.mail
      .sendNewLiaAssignment(
        pick.email,
        pick.name,
        updated.id,
        existing.lead?.contact?.fullName ?? 'A client',
      )
      .catch((err) => this.logger.error(`Failed to email new LIA: ${err?.message ?? err}`));

    return { status: 'assigned', liaId: pick.id, liaName: pick.name };
  }

  // ─── Auto-assign the client Consultant (Phase 2a) ─────────────────────
  //
  // Mirrors assignLiaToCase, but for the Case.consultantId slot (role
  // CLIENT_CONSULTANT). Two deliberate differences from the LIA path:
  //
  //   1. NEVER throws. The LIA path throws on no-candidates at contract
  //      send (blocking the send is desirable there). This runs off the
  //      lead→QUALIFIED / case-creation trigger and must NEVER block that
  //      flow — an empty pool logs an audit row and returns quietly.
  //   2. Language preference. When the client has a non-default language
  //      AND at least one active consultant speaks it, the pool narrows to
  //      those speakers; otherwise it stays the full pool. Today client
  //      preferredLanguage is 'en' everywhere (until 2b captures a real
  //      value), so this is a guarded no-op and selection is pure workload.
  //
  // COMPLIANCE: selection keys on LANGUAGE ONLY. Nationality is never read
  // or considered here.
  async assignConsultantToCase(
    caseId: string,
    triggerActor?: Actor,
  ): Promise<ConsultantAssignResult> {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        consultantId: true,
        lead: {
          select: {
            contact: { select: { fullName: true, preferredLanguage: true } },
          },
        },
      },
    });
    if (!existing) {
      this.logger.warn(`assignConsultantToCase: case ${caseId} not found`);
      return { status: 'no_candidates', consultantId: null, consultantName: null, langMatched: false };
    }
    if (existing.consultantId) {
      // Idempotency + continuity: never replace an existing consultant.
      // A re-opened case keeps its original consultant (consultantId is
      // sticky — nothing nulls it on close), so this short-circuit is what
      // makes "same consultant returns" hold automatically.
      return {
        status: 'already_assigned',
        consultantId: existing.consultantId,
        consultantName: null,
        langMatched: false,
      };
    }

    const candidates = await this.findActiveConsultants();
    if (candidates.length === 0) {
      this.logger.warn(
        `assignConsultantToCase: no active consultants for case ${caseId} — leaving unassigned`,
      );
      await this.prisma.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'CONSULTANT_AUTO_ASSIGN_NO_CANDIDATES',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { reason: 'no_active_consultants' } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return { status: 'no_candidates', consultantId: null, consultantName: null, langMatched: false };
    }

    // Language preference (guarded no-op while clientLang is 'en'). Compare
    // lowercase ISO 639-1 codes on both sides. Staff `languages` are stored
    // normalised lowercase (team.service); lowercase the client value too.
    const clientLang = (existing.lead?.contact?.preferredLanguage ?? 'en').trim().toLowerCase();
    const langAware = candidates.filter((c) =>
      (c.languages ?? []).map((l) => l.toLowerCase()).includes(clientLang),
    );
    const useLangPool = clientLang !== 'en' && langAware.length > 0;
    const pool = useLangPool ? langAware : candidates;

    // Lowest open-case count wins; ties broken by createdAt ASC (DB order).
    let pick = pool[0]!;
    for (const c of pool) {
      if (c.consultantCases.length < pick.consultantCases.length) pick = c;
    }

    const candidatesAudit = pool.map((c) => ({
      id: c.id,
      name: c.name,
      openCases: c.consultantCases.length,
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.case.update({
        where: { id: caseId },
        data: { consultantId: pick.id },
      });
      await tx.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'CONSULTANT_AUTO_ASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            consultantId: pick.id,
            consultantName: pick.name,
            clientLang,
            langMatched: useLangPool,
            candidates: candidatesAudit,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System (eligible)',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
    });

    return {
      status: 'assigned',
      consultantId: pick.id,
      consultantName: pick.name,
      langMatched: useLangPool,
    };
  }

  // ─── Auto-assign the Admission Specialist (Phase 3) ───────────────────
  //
  // Mirrors assignLiaToCase for the Case.ownerId slot (auth role CONSULTANT,
  // semantically the "Admission Specialist"). Fires at the same trigger as the
  // LIA (contract created / SIGNED webhook / ACCOUNT_OPENING payment).
  //
  //   * NEVER throws — an empty pool logs an audit and returns; callers are
  //     also try/catch-wrapped so this can't block contract send / the webhook.
  //   * Selection is WORKLOAD ONLY (lowest open owner-cases, createdAt tiebreak)
  //     — no language matching for Admission (per the manual).
  //   * Idempotency uses OPTION (b): skip only when the existing owner is a
  //     real Admission Specialist (role CONSULTANT). If ownerId is null OR
  //     points at a stray non-CONSULTANT owner (e.g. a CRM/sales owner copied
  //     from lead.ownerId at case creation), assign a real specialist and flag
  //     `replacedStrayOwner` in the audit. Continuity: a CONSULTANT owner is
  //     sticky (never nulled on close), so re-opens keep the same specialist.
  async assignAdmissionToCase(
    caseId: string,
    triggerActor?: Actor,
  ): Promise<AdmissionAssignResult> {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        ownerId: true,
        owner: { select: { id: true, name: true, role: true } },
        lead: { select: { contact: { select: { fullName: true } } } },
      },
    });
    if (!existing) {
      this.logger.warn(`assignAdmissionToCase: case ${caseId} not found`);
      return { status: 'no_candidates', ownerId: null, ownerName: null, replacedStrayOwner: false };
    }
    // Option (b): only a real Admission Specialist (role CONSULTANT) counts as
    // "already assigned". A stray non-CONSULTANT owner is replaceable.
    if (existing.ownerId && existing.owner?.role === 'CONSULTANT') {
      return {
        status: 'already_assigned',
        ownerId: existing.ownerId,
        ownerName: existing.owner?.name ?? null,
        replacedStrayOwner: false,
      };
    }
    const replacedStrayOwner = !!existing.ownerId && existing.owner?.role !== 'CONSULTANT';

    const candidates = await this.findActiveAdmissionSpecialists();
    if (candidates.length === 0) {
      this.logger.warn(
        `assignAdmissionToCase: no active Admission Specialists for case ${caseId} — leaving unassigned`,
      );
      await this.prisma.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'ADMISSION_AUTO_ASSIGN_NO_CANDIDATES',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { reason: 'no_active_admission_specialists' } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return { status: 'no_candidates', ownerId: null, ownerName: null, replacedStrayOwner: false };
    }

    // Lowest open owner-case count wins; ties broken by createdAt ASC.
    let pick = candidates[0]!;
    for (const c of candidates) {
      if (c.cases.length < pick.cases.length) pick = c;
    }
    const candidatesAudit = candidates.map((c) => ({ id: c.id, name: c.name, openCases: c.cases.length }));

    await this.prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: caseId }, data: { ownerId: pick.id } });
      await tx.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'ADMISSION_AUTO_ASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            ownerId: existing.ownerId ?? null,
            ownerName: existing.owner?.name ?? null,
            ownerRole: existing.owner?.role ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            ownerId: pick.id,
            ownerName: pick.name,
            // 'replaced-stray-owner' when we bumped a non-CONSULTANT owner,
            // 'fresh' when the slot was empty.
            assignment: replacedStrayOwner ? 'replaced-stray-owner' : 'fresh',
            replacedStrayOwner,
            candidates: candidatesAudit,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System (contract signed)',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
    });

    return { status: 'assigned', ownerId: pick.id, ownerName: pick.name, replacedStrayOwner };
  }

  // ─── Auto-assign the Finance officer (Phase 3) ────────────────────────
  //
  // Mirrors assignLiaToCase for the Case.financeId slot (role FINANCE). Same
  // trigger set as LIA/Admission. Workload only, never throws, idempotent
  // (skip if financeId already set). Continuity: financeId is sticky.
  //
  // 💰 This ONLY sets Case.financeId + writes an audit row. It does not create
  // or modify invoices, payments, refunds, or approvals — no financial side
  // effects whatsoever.
  async assignFinanceToCase(
    caseId: string,
    triggerActor?: Actor,
  ): Promise<FinanceAssignResult> {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, financeId: true, lead: { select: { contact: { select: { fullName: true } } } } },
    });
    if (!existing) {
      this.logger.warn(`assignFinanceToCase: case ${caseId} not found`);
      return { status: 'no_candidates', financeId: null, financeName: null };
    }
    if (existing.financeId) {
      return { status: 'already_assigned', financeId: existing.financeId, financeName: null };
    }

    const candidates = await this.findActiveFinanceStaff();
    if (candidates.length === 0) {
      this.logger.warn(
        `assignFinanceToCase: no active Finance staff for case ${caseId} — leaving unassigned`,
      );
      await this.prisma.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'FINANCE_AUTO_ASSIGN_NO_CANDIDATES',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { reason: 'no_active_finance_staff' } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
      return { status: 'no_candidates', financeId: null, financeName: null };
    }

    let pick = candidates[0]!;
    for (const c of candidates) {
      if (c.financeCases.length < pick.financeCases.length) pick = c;
    }
    const candidatesAudit = candidates.map((c) => ({ id: c.id, name: c.name, openCases: c.financeCases.length }));

    await this.prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: caseId }, data: { financeId: pick.id } });
      await tx.auditLog.create({
        data: {
          userId: triggerActor?.id ?? null,
          action: 'AUTO_ASSIGN',
          eventType: 'FINANCE_AUTO_ASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            financeId: pick.id,
            financeName: pick.name,
            candidates: candidatesAudit,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: triggerActor?.name ?? 'System (contract signed)',
          actorRoleSnapshot: triggerActor?.role ?? 'SYSTEM',
        },
      });
    });

    return { status: 'assigned', financeId: pick.id, financeName: pick.name };
  }

  // ─── Manual reassignment (OWNER / ADMIN / SUPER_ADMIN) ────────────────

  async manualReassign(
    caseId: string,
    dto: ManualReassignDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        liaId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        lia: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newLia: { id: string; name: string; email: string } | null = null;
    if (dto.liaId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.liaId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target LIA not found');
      if (target.role !== 'LIA') {
        throw new BadRequestException('Target user is not an LIA');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target LIA is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target LIA is archived');
      }
      newLia = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        // PR-LIA-3: stamp the assignment time on a reassignment; clear
        // it when the LIA is unassigned (liaId: null). The productivity
        // metrics treat liaAssignedAt as the start-of-clock per case.
        data: {
          liaId: newLia?.id ?? null,
          liaAssignedAt: newLia?.id ? new Date() : null,
        },
        include: {
          lia: { select: { id: true, name: true, email: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'LIA_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            liaId: existing.liaId ?? null,
            liaName: existing.lia?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            liaId: newLia?.id ?? null,
            liaName: newLia?.name ?? null,
            reason: dto.reason,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    const clientName = existing.lead?.contact?.fullName ?? 'A client';

    if (newLia) {
      this.mail
        .sendNewLiaAssignment(newLia.email, newLia.name, caseId, clientName)
        .catch((err) =>
          this.logger.error(`Failed to email new LIA on reassignment: ${err?.message ?? err}`),
        );
    }
    if (existing.lia && existing.lia.id !== newLia?.id) {
      this.mail
        .sendLiaAssignmentReleased(
          existing.lia.email,
          existing.lia.name,
          caseId,
          clientName,
        )
        .catch((err) =>
          this.logger.error(`Failed to email released LIA: ${err?.message ?? err}`),
        );
    }

    return updated;
  }

  // ─── Owner (Admission Specialist) manual reassignment ─────────────────
  //
  // Option 1 step 3a — mirror of manualReassign() for the CONSULTANT
  // slot, which lives on Case.ownerId. No timestamp column (Case has
  // no ownerAssignedAt) and no emails in v1 (the LIA email helpers
  // hardcode "LIA" copy + an LIA-portal link; reusing them would be
  // wrong, mirroring the templates is out of scope for this step).
  async reassignOwner(
    caseId: string,
    dto: ManualReassignOwnerDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        ownerId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newOwner: { id: string; name: string; email: string } | null = null;
    if (dto.ownerId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.ownerId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'CONSULTANT') {
        throw new BadRequestException('Target user is not an Admission Specialist');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Admission Specialist is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Admission Specialist is archived');
      }
      newOwner = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data: {
          ownerId: newOwner?.id ?? null,
        },
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'OWNER_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            ownerId: existing.ownerId ?? null,
            ownerName: existing.owner?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            ownerId: newOwner?.id ?? null,
            ownerName: newOwner?.name ?? null,
            reason: dto.reason,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Support manual reassignment ──────────────────────────────────────
  //
  // Option 1 step 4b — mirror of reassignOwner() for the SUPPORT slot,
  // which lives on Case.supportId (added in 4a migration). Same shape
  // as reassignOwner: no timestamp column, no emails in v1.
  async reassignSupport(
    caseId: string,
    dto: ManualReassignSupportDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        supportId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        support: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newSupport: { id: string; name: string; email: string } | null = null;
    if (dto.supportId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.supportId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'SUPPORT') {
        throw new BadRequestException('Target user is not a Support staff member');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Support staff member is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Support staff member is archived');
      }
      newSupport = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data:  { supportId: newSupport?.id ?? null },
        include: { support: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'SUPPORT_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            supportId: existing.supportId ?? null,
            supportName: existing.support?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            supportId: newSupport?.id ?? null,
            supportName: newSupport?.name ?? null,
            reason: dto.reason,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Finance manual reassignment ──────────────────────────────────────
  //
  // Option 1 step 4b — mirror of reassignOwner() for the FINANCE slot,
  // which lives on Case.financeId (added in 4a migration). Same shape.
  async reassignFinance(
    caseId: string,
    dto: ManualReassignFinanceDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        financeId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        finance: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newFinance: { id: string; name: string; email: string } | null = null;
    if (dto.financeId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.financeId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'FINANCE') {
        throw new BadRequestException('Target user is not a Finance staff member');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Finance staff member is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Finance staff member is archived');
      }
      newFinance = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data:  { financeId: newFinance?.id ?? null },
        include: { finance: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'FINANCE_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            financeId: existing.financeId ?? null,
            financeName: existing.finance?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            financeId: newFinance?.id ?? null,
            financeName: newFinance?.name ?? null,
            reason: dto.reason,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Consultant manual reassignment ──────────────────────────────────
  //
  // Phase 1 (auto-assignment) — mirror of reassignSupport() for the new
  // CONSULTANT slot, which lives on Case.consultantId. Validates the target's
  // role === 'CLIENT_CONSULTANT' (the real client Consultant — DISTINCT from the
  // CONSULTANT auth role, which is the "Admission Specialist" on ownerId). Same
  // shape as reassignSupport: no timestamp column, no emails in v1.
  async reassignConsultant(
    caseId: string,
    dto: ManualReassignConsultantDto,
    actor: Actor,
  ) {
    const existing = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        consultantId: true,
        lead: { select: { contact: { select: { fullName: true } } } },
        consultant: { select: { id: true, name: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('Case not found');

    let newConsultant: { id: string; name: string; email: string } | null = null;
    if (dto.consultantId) {
      const target = await this.prisma.user.findUnique({
        where: { id: dto.consultantId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          staffActiveStatus: { select: { isActive: true } },
        },
      });
      if (!target) throw new NotFoundException('Target user not found');
      if (target.role !== 'CLIENT_CONSULTANT') {
        throw new BadRequestException('Target user is not a Consultant');
      }
      if (!target.isActive) {
        throw new BadRequestException('Target Consultant is not active');
      }
      if (target.staffActiveStatus && target.staffActiveStatus.isActive === false) {
        throw new BadRequestException('Target Consultant is archived');
      }
      newConsultant = { id: target.id, name: target.name, email: target.email };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id: caseId },
        data:  { consultantId: newConsultant?.id ?? null },
        include: { consultant: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'MANUAL_REASSIGN',
          eventType: 'CONSULTANT_MANUAL_REASSIGNED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: {
            consultantId: existing.consultantId ?? null,
            consultantName: existing.consultant?.name ?? null,
          } as Prisma.InputJsonValue,
          newValue: {
            consultantId: newConsultant?.id ?? null,
            consultantName: newConsultant?.name ?? null,
            reason: dto.reason,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      return u;
    });

    return updated;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  // PR-CONSULT-1 mirror: pick candidates by role, exclude archived
  // (StaffActiveStatus.isActive=false), and pre-load each candidate's
  // open-cases collection for the counting step. Order by createdAt
  // ASC so the linear scan's lowest-count winner ties to the oldest
  // hire.
  private async findActiveLias() {
    return this.prisma.user.findMany({
      where: {
        role: 'LIA',
        isActive: true,
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        liaCases: {
          where: {
            stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
          },
          select: { id: true },
        },
      },
    });
  }

  // Phase 2a mirror of findActiveLias for the CLIENT_CONSULTANT pool.
  // Same active/archived filter and createdAt-ASC ordering; preloads each
  // candidate's open `consultantCases` (Case.consultantId) for the workload
  // count, plus `languages` for the language-preference filter.
  private async findActiveConsultants() {
    return this.prisma.user.findMany({
      where: {
        role: 'CLIENT_CONSULTANT',
        isActive: true,
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        languages: true,
        consultantCases: {
          where: {
            stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
          },
          select: { id: true },
        },
      },
    });
  }

  // Phase 3 mirror of findActiveLias for the Admission-Specialist pool (auth
  // role CONSULTANT). Preloads each candidate's open owner-slot cases for the
  // workload count — the CaseOwner back-relation is named `cases` (NOT
  // `ownerCases`), see schema.prisma.
  private async findActiveAdmissionSpecialists() {
    return this.prisma.user.findMany({
      where: {
        role: 'CONSULTANT',
        isActive: true,
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        cases: {
          where: {
            stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
          },
          select: { id: true },
        },
      },
    });
  }

  // Phase 3 mirror of findActiveLias for the Finance pool (role FINANCE).
  // Preloads each candidate's open finance-slot cases (CaseFinance back-relation
  // `financeCases`) for the workload count.
  private async findActiveFinanceStaff() {
    return this.prisma.user.findMany({
      where: {
        role: 'FINANCE',
        isActive: true,
        OR: [
          { staffActiveStatus: null },
          { staffActiveStatus: { isActive: true } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        financeCases: {
          where: {
            stage: { notIn: ['COMPLETED', 'WITHDRAWN'] },
          },
          select: { id: true },
        },
      },
    });
  }
}
