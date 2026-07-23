import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { generateClientId } from '../leads/client-id';
import {
  Prisma,
  ScorecardBand,
  ScorecardNextAction,
  ScoreBand as LegacyScoreBand,
  TargetCountry,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { MagicLinkService } from '../auth/magic-link.service';
import { PasswordSetupService } from '../auth/password-setup.service';
import { isValidLanguageCode } from '../common/language-codes';
import { score, ScoreResult } from './scoring/engine';
import { determineRouting, NextActionContent } from './scoring/routing';
import {
  renderInternalReport, renderClientReport,
  type InternalReportData, type ClientReportData,
} from './pdf';

// PR-SCORECARD-1 — Readiness Assessment service.
//
// Submit flow (single transaction):
//   1. Score via the TypeScript engine port
//   2. Encrypt answers JSON
//   3. Create ScorecardSubmission row
//   4. Find-or-create Contact (by email)
//   5. Create Lead in the existing CRM (status=SCORING_DONE) and
//      populate it with the score breakdown the rest of the platform
//      already understands (readinessScore, academicScore, etc.)
//   6. Link ScorecardSubmission.leadId → Lead
//   7. Promote User.role to LEAD only when the current role is null
//      / SALES / SUPPORT-default (i.e. they haven't been promoted
//      higher yet). NEVER downgrade an existing STUDENT / OWNER /
//      ADMIN / LIA etc.
//   8. Audit rows: SCORECARD_SUBMITTED + SCORECARD_LEAD_CREATED
//
// Encryption: answers contain DOB, financial data, refusal history,
// medical disclosures — all PII. AES-256-GCM via CryptoService, same
// envelope as every other Bytes column in the project.

interface Viewer {
  userId: string;
  name: string | null;
  role: string;
}

interface SubmissionMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}

// PR-SCORECARD-2 — attribution carried in the submit body (client-side
// reads sv_attribution cookie + URL ?ch/agent/campaign and forwards it).
export interface AttributionInput {
  trackingLinkId?: string | null;
  agentId?: string | null;
  campaignLabel?: string | null;
  channel?: string | null;
}

// Fix 5: gateResults is now a SORTED ARRAY (server-side numerical
// order) rather than a Record<string, boolean>. Object key iteration
// for string keys isn't guaranteed and was producing 1, 4, 2, 5, 3.
export interface GateResultRow {
  gateNumber: 1 | 2 | 3 | 4 | 5;
  label: string;
  passed: boolean;
}

export interface ScorecardResultPayload {
  submissionId: string;
  totalScore: number;
  band: ScorecardBand;
  bandName: string;
  bandRange: string;
  categoryScores: Record<number, number>;
  hardStops: ReturnType<typeof score>['hardStops'];
  riskFlags: string[];
  executionEligible: boolean;
  gateResults: GateResultRow[];
  nextAction: ScorecardNextAction;
  nextActionTextEn: string;
  nextActionTextFa: string;
  // Polish PR (post-e57a769): structured payload for the results
  // page's bulleted list. Nullable on legacy rows; the frontend
  // falls back to splitting nextActionTextEn when absent.
  nextActionContent: NextActionContent | null;
  // Convenience flags for the PR-SCORECARD-2 frontend
  shouldShowMalaysiaCallout: boolean;
  shouldShowBookingLink: boolean;
  shouldShowPaymentLink: boolean;
  shouldShowNurtureMessage: boolean;
  // Decrypted answers (only included when the viewer is staff or the
  // submission's owner; the wire shape always carries the field for
  // simplicity)
  answers?: Record<string, string>;
  perFieldScores?: ScoreResult['perFieldScores'];
  submittedAt: string;
  leadId: string | null;
  consultationBookedAt: string | null;
}

const STAFF_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'CONSULTANT']);

@Injectable()
export class ScorecardService {
  private readonly logger = new Logger(ScorecardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly magicLink: MagicLinkService,
    private readonly passwordSetup: PasswordSetupService,
  ) {}

  // ─── Submit ───────────────────────────────────────────────────────────

  async submitScorecard(
    userId: string,
    answers: Record<string, string>,
    meta: SubmissionMetadata,
    actor: Viewer,
    attribution: AttributionInput = {},
    // Path A (anonymous on-ramp): the public by-email path passes
    // allowRolePromotion:false so an EXISTING account's role is never
    // touched (a new account is created as LEAD directly, so promotion
    // is a no-op there anyway). The authenticated path defaults to true,
    // preserving the original SALES/SUPPORT/null → LEAD promotion.
    opts: { allowRolePromotion?: boolean; targetCountry?: string | null } = {},
  ): Promise<ScorecardResultPayload> {
    const result = score(answers);
    const routing = determineRouting(
      result.band.enumValue,
      result.hardStops,
      result.execution.eligible,
    );

    const answersJson = JSON.stringify(answers);
    const answersEncrypted = this.crypto.encrypt(answersJson);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Cat 3 max is 25. The legacy Lead.financialScore is also INT —
    // we feed the capped sub-totals so the Lead surface stays
    // numerically consistent with what the staff see.
    const categoryScores = result.catScores;

    // Map our 6-band to the legacy 3-band ScoreBand enum that pre-
    // existing Lead consumers (CRM, scoring widgets) understand.
    const legacyBand = this.toLegacyBand(result.band.enumValue);

    // PR-SCORECARD-2: resolve attribution BEFORE the transaction so a
    // bad/missing trackingLink doesn't abort the whole submit. We try
    // trackingLinkId → agentId (from URL/cookie) — first attribution
    // wins. The Lead row receives whichever pair we end up with.
    const resolvedAttribution = await this.resolveAttribution(attribution);

    // PR-SCORECARD-2: if the user has an open draft, promote it
    // (update in place) instead of creating a new row. This keeps
    // (userId, isDraft=true) at most one row per user — the draft
    // "graduates" into a submission.
    const existingDraft = await this.prisma.scorecardSubmission.findFirst({
      where: { userId, isDraft: true },
      orderBy: { submittedAt: 'desc' },
      select: { id: true },
    });

    // Fix 5: store the gateResults JSON column in the new sorted-array
    // shape so SQL queries / staff views read the same shape that
    // the API returns. Legacy rows (stored as objects pre-Fix 5)
    // are tolerated on read by `gatesToArray`.
    const gateRowsForStorage = ScorecardService.gatesToArray(result.execution.gates);

    const submission = await this.prisma.$transaction(async (tx) => {
      const submissionData = {
        userId,
        answersEncrypted: answersEncrypted as never,
        totalScore: result.total,
        category1Score: categoryScores[1] ?? 0,
        category2Score: categoryScores[2] ?? 0,
        category3Score: categoryScores[3] ?? 0,
        category4Score: categoryScores[4] ?? 0,
        band: result.band.enumValue as ScorecardBand,
        hardStops: result.hardStops as unknown as Prisma.InputJsonValue,
        riskFlags: result.riskFlags,
        executionEligible: result.execution.eligible,
        gateResults: gateRowsForStorage as unknown as Prisma.InputJsonValue,
        nextAction: routing.nextAction as ScorecardNextAction,
        nextActionTextEn: routing.nextActionTextEn,
        nextActionTextFa: routing.nextActionTextFa,
        nextActionContent: routing.nextActionContent as unknown as Prisma.InputJsonValue,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        isDraft: false,
        draftLastSavedAt: null,
        submittedAt: new Date(),
      };

      const created = existingDraft
        ? await tx.scorecardSubmission.update({
            where: { id: existingDraft.id },
            data: submissionData,
          })
        : await tx.scorecardSubmission.create({ data: submissionData });

      // ─── Lead auto-creation ─────────────────────────────────────────
      const fullName = (answers.full_name ?? user.name ?? '').trim() || user.name || 'Lead';
      const email = (answers.email ?? user.email ?? '').trim() || null;
      const phone = (answers.phone ?? '').trim() || null;
      const country = (answers.current_country ?? '').trim() || null;
      // Phase 2b: the optional first-language answer. `capturedLang` is a valid
      // lowercase ISO 639-1 code ONLY when the user actually picked one — it is
      // null when the field was left empty or holds an invalid value. On CREATE
      // we default a missing value to 'en'; on UPDATE (returning lead) we leave
      // any existing value untouched when nothing was captured, so an empty
      // field never clobbers a previously-chosen non-'en' language. This is the
      // value consultant auto-assignment reads for language matching (Phase 2a).
      // COMPLIANCE: language only — nationality is NOT captured or written into
      // the assignment path.
      const rawLang = (answers.first_language ?? '').trim().toLowerCase();
      const capturedLang = isValidLanguageCode(rawLang) ? rawLang : null;
      const preferredLanguage = capturedLang ?? 'en';

      // Find-or-create Contact by email (best-effort dedupe). If no
      // email is provided we always create a new Contact rather than
      // collide on the unique(email) constraint with NULLs.
      let contactId: string | null = null;
      if (email) {
        const existing = await tx.contact.findFirst({ where: { email } });
        if (existing) {
          contactId = existing.id;
          // Refresh the returning lead's language to what they just selected —
          // but only when they actually selected one (capturedLang non-null).
          if (capturedLang) {
            await tx.contact.update({
              where: { id: existing.id },
              data: { preferredLanguage: capturedLang },
            });
          }
        }
      }
      if (!contactId) {
        const c = await tx.contact.create({
          data: {
            fullName,
            email,
            phone,
            countryOfResidence: country,
            preferredLanguage,
          },
        });
        contactId = c.id;
      }

      // PR-CLIENT-ID — assign the permanent human-readable id at creation.
      const clientId = await generateClientId(tx, { countryOfResidence: country, contactId });
      const lead = await tx.lead.create({
        data: {
          clientId,
          contactId,
          sourceChannel: resolvedAttribution.sourceChannel,
          leadStatus: 'SCORING_DONE',
          readinessScore: result.total,
          academicScore: categoryScores[2] ?? 0,
          financialScore: categoryScores[3] ?? 0,
          // englishScore + intentScore are derived signals — pull the
          // raw point values for Q22 + Q27 so the existing CRM
          // surfaces keep their per-axis numbers.
          englishScore: result.perFieldScores.q22_english_score?.points ?? null,
          intentScore: result.perFieldScores.q27_study_goal?.points ?? null,
          scoreBand: legacyBand,
          riskFlags: result.riskFlags,
          hardStopFlag: result.hardStops.length > 0,
          hardStopReason: result.hardStops[0]?.name ?? null,
          liaEscalationRequired: result.hardStops.some((h) => h.code === 'HS4'),
          executionAllowed: result.execution.eligible,
          // PR-SCORECARD-2: marketing attribution. New rows always
          // accept the resolved attribution (since the Lead is fresh,
          // first-attribution-wins is implicit — nothing to overwrite).
          trackingLinkId:    resolvedAttribution.trackingLinkId,
          attributedAgentId: resolvedAttribution.agentId,
          campaignId:        resolvedAttribution.campaignLabel,
          // Country the visitor picked on /start. Client-supplied → whitelisted
          // to the enum-or-null here (single trust boundary). Nullable —
          // deep-links straight to the assessment have none.
          targetCountry:     this.sanitizeTargetCountry(opts.targetCountry),
        },
      });

      // Link submission → lead (1:0..1)
      await tx.scorecardSubmission.update({
        where: { id: created.id },
        data: { leadId: lead.id },
      });

      // Promote User.role to LEAD ONLY when current role doesn't
      // outrank LEAD. The spec is explicit: do NOT downgrade
      // STUDENT / OWNER / ADMIN / LIA / etc.
      if (opts.allowRolePromotion !== false && this.shouldPromoteToLead(user.role)) {
        await tx.user.update({
          where: { id: userId },
          data: { role: 'LEAD' },
        });
      }

      // Audit rows
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CREATE',
          eventType: 'SCORECARD_SUBMITTED',
          entityType: 'SCORECARD_SUBMISSION',
          entityId: created.id,
          newValue: {
            submissionId: created.id,
            band: result.band.enumValue,
            totalScore: result.total,
            executionEligible: result.execution.eligible,
            hardStopCount: result.hardStops.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CREATE',
          eventType: 'SCORECARD_LEAD_CREATED',
          entityType: 'LEAD',
          entityId: lead.id,
          newValue: {
            leadId: lead.id,
            scorecardSubmissionId: created.id,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return { id: created.id, leadId: lead.id, submittedAt: created.submittedAt };
    });

    return this.toPayload({
      submissionId: submission.id,
      result,
      routing,
      submittedAt: submission.submittedAt,
      leadId: submission.leadId,
      consultationBookedAt: null,
      includeAnswers: true,
    });
  }

  // ─── Path A: public (anonymous) submit — account created on submit ──────
  //
  // The scorecard is fillable without an account. On submit we resolve the
  // user by the email in the answers:
  //   • NEW email  → create User{ role:'LEAD', passwordHash:null }, issue a
  //     first-time set-password token + email the secure "Create Your Password"
  //     link, and return { mode:'created' }. NO session — the client sets a
  //     password via the email link, then lands in the portal.
  //   • EXISTING email (client OR staff) → NEVER session, NEVER mutate the
  //     account. Record the submission against them and email a magic-link so
  //     the real inbox owner signs in. Returns a generic { mode:'existing' }
  //     that reveals nothing about the account type.
  // role is HARDCODED 'LEAD' on create (the DTO has no role); existing roles
  // are left untouched via allowRolePromotion:false.
  async submitScorecardPublic(
    answers: Record<string, string>,
    meta: SubmissionMetadata,
    attribution: AttributionInput = {},
    targetCountry?: string,
  ): Promise<{ mode: 'created' } | { mode: 'existing' }> {
    const email = (answers.email ?? '').trim().toLowerCase() || null;
    if (!email) {
      throw new BadRequestException('An email address is required to submit the assessment.');
    }
    const fullName = (answers.full_name ?? '').trim() || 'Lead';

    // Case-insensitive match — mirrors the unique(email) + magic-link lookup.
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, name: true, role: true },
    });

    if (existing) {
      // Existing account: record the submission, but NEVER session or change
      // the account (allowRolePromotion:false leaves even a SALES/SUPPORT
      // default untouched). Then email a sign-in link to the real owner.
      await this.submitScorecard(
        existing.id,
        answers,
        meta,
        { userId: existing.id, name: existing.name, role: existing.role },
        attribution,
        { allowRolePromotion: false, targetCountry },
      );
      await this.magicLink.requestLink(email);
      return { mode: 'existing' };
    }

    // Brand-new account — passwordless LEAD (role hardcoded).
    let created: { id: string; name: string | null; role: string; email: string };
    try {
      created = await this.prisma.user.create({
        data: {
          email,
          name: fullName,
          role: 'LEAD',
          passwordHash: null,
          isActive: true,
        },
        select: { id: true, name: true, role: true, email: true },
      });
    } catch (e) {
      // Concurrent submit created the account first — treat as existing:
      // send a sign-in link, no session, generic response.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.magicLink.requestLink(email);
        return { mode: 'existing' };
      }
      throw e;
    }

    await this.submitScorecard(
      created.id,
      answers,
      meta,
      { userId: created.id, name: created.name, role: created.role },
      attribution,
      { allowRolePromotion: false, targetCountry },
    );

    // First-time onboarding: issue a "create your password" token + email the
    // secure link. NO session is minted here — the client sets their password
    // via the email link, then lands in the portal. requestSetup only issues
    // for the passwordless LEAD we just created and swallows mail failures, so
    // it never unwinds the submission.
    await this.passwordSetup.requestSetup(created.id);
    return { mode: 'created' };
  }

  /**
   * Whitelist the client-supplied country to the enum or null. Untrusted input
   * — anything that isn't EXACTLY one of the two allowed values (missing,
   * 'AUSTRALIA', a coerced object, casing variants, …) becomes null, so a bad
   * value can never break the submit.
   */
  private sanitizeTargetCountry(raw?: string | null): TargetCountry | null {
    if (raw === 'NEW_ZEALAND') return TargetCountry.NEW_ZEALAND;
    if (raw === 'MALAYSIA') return TargetCountry.MALAYSIA;
    return null;
  }

  // ─── Read endpoints ───────────────────────────────────────────────────

  async getMyLatestResult(userId: string): Promise<ScorecardResultPayload> {
    const row = await this.prisma.scorecardSubmission.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    });
    if (!row) throw new NotFoundException('No scorecard submissions for this user yet.');
    return this.hydrate(row);
  }

  async getMyHistory(userId: string): Promise<ScorecardResultPayload[]> {
    const rows = await this.prisma.scorecardSubmission.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map((r) => this.hydrate(r));
  }

  async getSubmissionByIdForStaff(
    submissionId: string,
    staff: Viewer,
  ): Promise<ScorecardResultPayload & { lead: { id: string; contactId: string } | null }> {
    if (!STAFF_ROLES.has(staff.role)) {
      throw new ForbiddenException('Staff-only endpoint.');
    }
    const row = await this.prisma.scorecardSubmission.findUnique({
      where: { id: submissionId },
      include: { lead: { select: { id: true, contactId: true } } },
    });
    if (!row) throw new NotFoundException('Submission not found');

    // Audit the staff view.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: staff.userId,
          action: 'READ',
          eventType: 'SCORECARD_VIEWED_BY_STAFF',
          entityType: 'SCORECARD_SUBMISSION',
          entityId: submissionId,
          newValue: { submissionId, viewerUserId: staff.userId } as Prisma.InputJsonValue,
          actorNameSnapshot: staff.name ?? null,
          actorRoleSnapshot: staff.role ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to audit scorecard view: ${err?.message ?? err}`);
    }

    const payload = this.hydrate(row);
    return { ...payload, lead: row.lead ?? null };
  }

  async recordBookingLinkOpened(
    submissionId: string,
    userId: string,
  ): Promise<{ consultationBookedAt: string }> {
    const row = await this.prisma.scorecardSubmission.findUnique({
      where: { id: submissionId },
      select: { userId: true },
    });
    if (!row) throw new NotFoundException('Submission not found');
    if (row.userId !== userId) {
      throw new ForbiddenException('You can only mark your own submissions.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.scorecardSubmission.update({
        where: { id: submissionId },
        data: { consultationBookedAt: now },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'UPDATE',
          eventType: 'SCORECARD_BOOKING_LINK_OPENED',
          entityType: 'SCORECARD_SUBMISSION',
          entityId: submissionId,
          newValue: { submissionId } as Prisma.InputJsonValue,
          actorNameSnapshot: null,
          actorRoleSnapshot: null,
        },
      });
    });

    return { consultationBookedAt: now.toISOString() };
  }

  // ─── PDF generation (PR-SCORECARD-3) ─────────────────────────────────

  async generateClientPdf(
    submissionId: string,
    requester: Viewer,
  ): Promise<{ buffer: Buffer; applicantName: string; submittedAt: Date }> {
    const row = await this.prisma.scorecardSubmission.findUnique({
      where: { id: submissionId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { contact: { select: { fullName: true, email: true, phone: true, countryOfResidence: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Submission not found');

    // Ownership check — own submission OR staff role.
    const isStaff = STAFF_ROLES.has(requester.role);
    if (!isStaff && row.userId !== requester.userId) {
      throw new ForbiddenException('You can only download your own report.');
    }

    const payload = this.hydrate({ ...row, answersEncrypted: row.answersEncrypted as Buffer });
    const applicantName = row.lead?.contact?.fullName ?? row.user?.name ?? 'Applicant';

    const clientData: ClientReportData = {
      applicant: {
        fullName: applicantName,
        submittedAt: payload.submittedAt,
      },
      totalScore: payload.totalScore,
      band: payload.band,
      bandName: payload.bandName,
      bandRange: payload.bandRange,
      categoryScores: payload.categoryScores,
      hasHardStops: payload.hardStops.length > 0,
      nextActionContent: payload.nextActionContent,
      nextActionTextEn: payload.nextActionTextEn,
      shouldShowMalaysiaCallout: payload.shouldShowMalaysiaCallout,
    };

    const buffer = await renderClientReport(clientData);

    // Audit — fire-and-log on failure.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: requester.userId,
          action: 'READ',
          eventType: 'SCORECARD_CLIENT_PDF_GENERATED',
          entityType: 'SCORECARD_SUBMISSION',
          entityId: submissionId,
          newValue: {
            submissionId,
            byStaff: isStaff,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: requester.name ?? null,
          actorRoleSnapshot: requester.role ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to audit client PDF generation: ${err?.message ?? err}`);
    }

    return { buffer, applicantName, submittedAt: row.submittedAt };
  }

  async generateInternalPdf(
    submissionId: string,
    requester: Viewer,
  ): Promise<{ buffer: Buffer; applicantName: string; submittedAt: Date }> {
    if (!STAFF_ROLES.has(requester.role)) {
      throw new ForbiddenException('Staff-only endpoint.');
    }
    const row = await this.prisma.scorecardSubmission.findUnique({
      where: { id: submissionId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { contact: { select: { fullName: true, email: true, phone: true, countryOfResidence: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Submission not found');

    const payload = this.hydrate({ ...row, answersEncrypted: row.answersEncrypted as Buffer });
    const contact = row.lead?.contact;
    const applicantName = contact?.fullName ?? row.user?.name ?? 'Applicant';

    const internalData: InternalReportData = {
      applicant: {
        fullName: applicantName,
        email:    contact?.email ?? row.user?.email ?? null,
        phone:    contact?.phone ?? null,
        country:  contact?.countryOfResidence ?? null,
        submittedAt: payload.submittedAt,
      },
      totalScore: payload.totalScore,
      band: payload.band,
      bandName: payload.bandName,
      categoryScores: payload.categoryScores,
      hardStops: payload.hardStops.map((hs) => ({
        code: hs.code,
        name: hs.name,
        reason: hs.reason,
        resolution: hs.resolution,
      })),
      riskFlags: payload.riskFlags,
      gateResults: payload.gateResults,
      executionEligible: payload.executionEligible,
      nextActionContent: payload.nextActionContent,
      nextActionTextEn: payload.nextActionTextEn,
      answers: payload.answers ?? {},
      perFieldScores: payload.perFieldScores,
    };

    const buffer = await renderInternalReport(internalData);

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: requester.userId,
          action: 'READ',
          eventType: 'SCORECARD_INTERNAL_PDF_GENERATED',
          entityType: 'SCORECARD_SUBMISSION',
          entityId: submissionId,
          newValue: {
            submissionId,
            viewerUserId: requester.userId,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: requester.name ?? null,
          actorRoleSnapshot: requester.role ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to audit internal PDF generation: ${err?.message ?? err}`);
    }

    return { buffer, applicantName, submittedAt: row.submittedAt };
  }

  // ─── List for staff (used by /staff/scorecards index) ────────────────

  async listForStaff(staff: Viewer): Promise<Array<{
    id: string;
    submittedAt: Date;
    applicantName: string | null;
    band: ScorecardBand;
    totalScore: number;
    executionEligible: boolean;
    hardStopCount: number;
    leadId: string | null;
  }>> {
    if (!STAFF_ROLES.has(staff.role)) {
      throw new ForbiddenException('Staff-only endpoint.');
    }
    const rows = await this.prisma.scorecardSubmission.findMany({
      orderBy: { submittedAt: 'desc' },
      include: {
        user: { select: { name: true } },
        lead: {
          select: {
            id: true,
            contact: { select: { fullName: true } },
          },
        },
      },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt,
      // Prefer the Lead's Contact fullName (auto-created from
      // questionnaire answers.full_name), fall back to User.name.
      applicantName: r.lead?.contact?.fullName ?? r.user?.name ?? null,
      band: r.band,
      totalScore: r.totalScore,
      executionEligible: r.executionEligible,
      hardStopCount: Array.isArray(r.hardStops) ? (r.hardStops as unknown[]).length : 0,
      leadId: r.lead?.id ?? null,
    }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private hydrate(row: {
    id: string;
    userId: string;
    totalScore: number;
    category1Score: number;
    category2Score: number;
    category3Score: number;
    category4Score: number;
    band: ScorecardBand;
    hardStops: Prisma.JsonValue;
    riskFlags: string[];
    executionEligible: boolean;
    gateResults: Prisma.JsonValue;
    nextAction: ScorecardNextAction;
    nextActionTextEn: string;
    nextActionTextFa: string;
    nextActionContent: Prisma.JsonValue;
    submittedAt: Date;
    leadId: string | null;
    consultationBookedAt: Date | null;
    answersEncrypted: Buffer | Uint8Array;
  }): ScorecardResultPayload {
    let answers: Record<string, string> | undefined;
    let perFieldScores: ScoreResult['perFieldScores'] | undefined;
    try {
      const buf = Buffer.isBuffer(row.answersEncrypted)
        ? row.answersEncrypted
        : Buffer.from(row.answersEncrypted);
      const decrypted = this.crypto.decrypt(buf);
      answers = JSON.parse(decrypted) as Record<string, string>;
      // Re-run the engine so we can surface per-field scores in the
      // staff view (the row stores totals, not per-question points).
      perFieldScores = score(answers).perFieldScores;
    } catch (err: any) {
      this.logger.error(`Failed to decrypt scorecard answers: ${err?.message ?? err}`);
    }

    const bandName = this.bandDisplayName(row.band);
    const bandRange = this.bandRange(row.band);
    const cs = {
      1: row.category1Score,
      2: row.category2Score,
      3: row.category3Score,
      4: row.category4Score,
    };

    return {
      submissionId: row.id,
      totalScore: row.totalScore,
      band: row.band,
      bandName,
      bandRange,
      categoryScores: cs,
      hardStops: (row.hardStops as unknown as ScoreResult['hardStops']) ?? [],
      riskFlags: row.riskFlags,
      executionEligible: row.executionEligible,
      // Fix 5: normalise both legacy (object) and new (array) DB shapes.
      gateResults: ScorecardService.gatesToArray(row.gateResults),
      nextAction: row.nextAction,
      nextActionTextEn: row.nextActionTextEn,
      nextActionTextFa: row.nextActionTextFa,
      // Legacy rows (pre-this-migration) have NULL → frontend uses
      // the flat string fallback.
      nextActionContent: (row.nextActionContent as unknown as NextActionContent) ?? null,
      shouldShowMalaysiaCallout:
        row.band === 'BAND_4' || row.band === 'BAND_5' || row.band === 'BAND_6',
      shouldShowBookingLink: row.nextAction === 'BOOK_FREE_15MIN_SESSION',
      shouldShowPaymentLink: row.nextAction === 'PAY_GAP_CLOSING_SESSION',
      shouldShowNurtureMessage: row.nextAction === 'NURTURE_ONLY',
      answers,
      perFieldScores,
      submittedAt: row.submittedAt.toISOString(),
      leadId: row.leadId,
      consultationBookedAt: row.consultationBookedAt?.toISOString() ?? null,
    };
  }

  private toPayload(args: {
    submissionId: string;
    result: ScoreResult;
    routing: ReturnType<typeof determineRouting>;
    submittedAt: Date;
    leadId: string | null;
    consultationBookedAt: Date | null;
    includeAnswers: boolean;
  }): ScorecardResultPayload {
    const { result, routing } = args;
    return {
      submissionId: args.submissionId,
      totalScore: result.total,
      band: result.band.enumValue as ScorecardBand,
      bandName: result.band.name,
      bandRange: result.band.range,
      categoryScores: result.catScores,
      hardStops: result.hardStops,
      riskFlags: result.riskFlags,
      executionEligible: result.execution.eligible,
      // Fix 5: engine still returns Record<string, boolean>; convert
      // to sorted array for the API response.
      gateResults: ScorecardService.gatesToArray(result.execution.gates),
      nextAction: routing.nextAction as ScorecardNextAction,
      nextActionTextEn: routing.nextActionTextEn,
      nextActionTextFa: routing.nextActionTextFa,
      nextActionContent: routing.nextActionContent,
      shouldShowMalaysiaCallout:
        result.band.enumValue === 'BAND_4'
        || result.band.enumValue === 'BAND_5'
        || result.band.enumValue === 'BAND_6',
      shouldShowBookingLink: routing.nextAction === 'BOOK_FREE_15MIN_SESSION',
      shouldShowPaymentLink: routing.nextAction === 'PAY_GAP_CLOSING_SESSION',
      shouldShowNurtureMessage: routing.nextAction === 'NURTURE_ONLY',
      answers: args.includeAnswers ? result.answers : undefined,
      perFieldScores: args.includeAnswers ? result.perFieldScores : undefined,
      submittedAt: args.submittedAt.toISOString(),
      leadId: args.leadId,
      consultationBookedAt: args.consultationBookedAt?.toISOString() ?? null,
    };
  }

  private bandDisplayName(b: ScorecardBand): string {
    switch (b) {
      case 'BAND_1': return 'Cold / Unready';
      case 'BAND_2': return 'Early Stage / Fragile';
      case 'BAND_3': return 'Developing / Consultable';
      case 'BAND_4': return 'Viable / Structured Opportunity';
      case 'BAND_5': return 'Strong / Near Execution Ready';
      case 'BAND_6': return 'Premium / Execution Ready';
    }
  }

  private bandRange(b: ScorecardBand): string {
    switch (b) {
      case 'BAND_1': return '0-24';
      case 'BAND_2': return '25-39';
      case 'BAND_3': return '40-54';
      case 'BAND_4': return '55-69';
      case 'BAND_5': return '70-84';
      case 'BAND_6': return '85-100';
    }
  }

  private toLegacyBand(b: ScorecardBand): LegacyScoreBand {
    if (b === 'BAND_1' || b === 'BAND_2') return 'LOW';
    if (b === 'BAND_3' || b === 'BAND_4') return 'MID';
    return 'HIGH';
  }

  // Fix 5: convert the engine's `Record<string, boolean>` gates output
  // into a sorted array (Gate 1 → Gate 5). The engine still returns an
  // object keyed by the human label; this helper normalises BOTH:
  //   * fresh gates from the engine (object), AND
  //   * legacy gates loaded from the DB (object stored before Fix 5)
  //   * already-converted gates loaded from the DB (array stored after Fix 5)
  // so re-reading historical submissions doesn't break.
  static gatesToArray(input: unknown): GateResultRow[] {
    // Already-converted array shape (Fix 5 forward).
    if (Array.isArray(input)) {
      const arr = input
        .filter(
          (row): row is GateResultRow =>
            typeof row === 'object' && row !== null
            && typeof (row as GateResultRow).gateNumber === 'number'
            && typeof (row as GateResultRow).label === 'string'
            && typeof (row as GateResultRow).passed === 'boolean',
        )
        .slice()
        .sort((a, b) => a.gateNumber - b.gateNumber);
      return arr;
    }
    // Object shape (legacy / engine fresh output). Parse the "Gate N:"
    // prefix to recover the gate number; pass through label intact.
    if (typeof input === 'object' && input !== null) {
      const obj = input as Record<string, boolean>;
      const rows: GateResultRow[] = [];
      for (const [label, passed] of Object.entries(obj)) {
        const m = /^Gate\s+(\d)\b/i.exec(label);
        if (!m) continue;
        const n = parseInt(m[1]!, 10) as 1 | 2 | 3 | 4 | 5;
        if (n < 1 || n > 5) continue;
        rows.push({ gateNumber: n, label, passed: !!passed });
      }
      rows.sort((a, b) => a.gateNumber - b.gateNumber);
      return rows;
    }
    return [];
  }

  private shouldPromoteToLead(role: string | null | undefined): boolean {
    // Promote only when the user currently holds a role that's
    // strictly below LEAD in the funnel. Anyone already at STUDENT
    // or higher staff role keeps their privileges.
    if (!role) return true;
    // The default for new sign-ups in this codebase is SALES (see
    // UserRole default in schema.prisma). Treat SALES + SUPPORT as
    // "not yet promoted" for scorecard purposes.
    return role === 'SALES' || role === 'SUPPORT';
  }

  // ─── PR-SCORECARD-2: drafts ───────────────────────────────────────

  async getDraft(userId: string): Promise<{
    id: string;
    answers: Record<string, string>;
    draftLastSavedAt: string | null;
  } | null> {
    const row = await this.prisma.scorecardSubmission.findFirst({
      where: { userId, isDraft: true },
      orderBy: { submittedAt: 'desc' },
    });
    if (!row) return null;
    let answers: Record<string, string> = {};
    try {
      const buf = Buffer.isBuffer(row.answersEncrypted)
        ? row.answersEncrypted
        : Buffer.from(row.answersEncrypted);
      answers = JSON.parse(this.crypto.decrypt(buf)) as Record<string, string>;
    } catch (err: any) {
      this.logger.error(`Failed to decrypt draft answers: ${err?.message ?? err}`);
    }
    return {
      id: row.id,
      answers,
      draftLastSavedAt: row.draftLastSavedAt?.toISOString() ?? null,
    };
  }

  async saveDraft(
    userId: string,
    answers: Record<string, string>,
  ): Promise<{ id: string; draftLastSavedAt: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const encrypted = this.crypto.encrypt(JSON.stringify(answers));
    const now = new Date();

    const existing = await this.prisma.scorecardSubmission.findFirst({
      where: { userId, isDraft: true },
      select: { id: true },
    });

    if (existing) {
      const updated = await this.prisma.scorecardSubmission.update({
        where: { id: existing.id },
        data: {
          answersEncrypted: encrypted as never,
          draftLastSavedAt: now,
        },
      });
      return { id: updated.id, draftLastSavedAt: now.toISOString() };
    }

    // New draft. Populate sentinel zeros for the NOT NULL scoring
    // columns — they're never read while isDraft=true.
    const created = await this.prisma.scorecardSubmission.create({
      data: {
        userId,
        answersEncrypted: encrypted as never,
        totalScore: 0,
        category1Score: 0,
        category2Score: 0,
        category3Score: 0,
        category4Score: 0,
        band: 'BAND_1' as ScorecardBand,
        hardStops: [] as unknown as Prisma.InputJsonValue,
        riskFlags: [],
        executionEligible: false,
        gateResults: {} as unknown as Prisma.InputJsonValue,
        nextAction: 'NURTURE_ONLY' as ScorecardNextAction,
        nextActionTextEn: '',
        nextActionTextFa: '',
        isDraft: true,
        draftLastSavedAt: now,
      },
    });
    return { id: created.id, draftLastSavedAt: now.toISOString() };
  }

  // ─── PR-SCORECARD-2: attribution resolution ───────────────────────

  private async resolveAttribution(input: AttributionInput): Promise<{
    trackingLinkId: string | null;
    agentId: string | null;
    campaignLabel: string | null;
    sourceChannel: string;
  }> {
    let trackingLinkId: string | null = null;
    let agentId: string | null = null;
    let campaignLabel: string | null = input.campaignLabel?.trim() || null;
    let sourceChannel = 'SCORECARD';

    if (input.trackingLinkId) {
      try {
        const link = await this.prisma.trackingLink.findUnique({
          where: { id: input.trackingLinkId },
          select: {
            id: true,
            status: true,
            agentId: true,
            campaignLabel: true,
            channel: true,
          },
        });
        // Even an archived link still attributes — archiving stops
        // NEW clicks counting, but if someone bookmarked and
        // converted later, the attribution credit still applies.
        if (link) {
          trackingLinkId = link.id;
          agentId = link.agentId ?? agentId;
          campaignLabel = campaignLabel ?? link.campaignLabel ?? null;
          sourceChannel = `SCORECARD_${link.channel}`;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to resolve tracking link ${input.trackingLinkId}: ${err?.message ?? err}`);
      }
    }

    // Direct agent attribution (no tracking link, just ?agent=).
    if (!agentId && input.agentId) {
      try {
        const agent = await this.prisma.affiliateAgent.findUnique({
          where: { id: input.agentId },
          select: { id: true, status: true },
        });
        if (agent && agent.status !== 'TERMINATED') {
          agentId = agent.id;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to resolve agent ${input.agentId}: ${err?.message ?? err}`);
      }
    }

    // Channel hint when no tracking link existed (someone manually
    // typed a URL with ?ch=instagram).
    if (!trackingLinkId && input.channel) {
      sourceChannel = `SCORECARD_${input.channel.toUpperCase()}`;
    }

    return { trackingLinkId, agentId, campaignLabel, sourceChannel };
  }
}
