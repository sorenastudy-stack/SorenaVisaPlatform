import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ContractSignerRole,
  ContractSignerStatus,
  ContractStatus,
  ConsultationStatus,
  ConsultationType,
  DocumentUploadStatus,
  LegalDecision,
  Prisma,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../common/r2/r2.service';
import {
  DocuSignService,
  EnvelopeDocumentSpec,
  EnvelopeRecipientSpec,
  TEMPLATE_ROLE_CLIENT,
  TEMPLATE_ROLE_LIA,
  TEMPLATE_ROLE_DIRECTOR,
} from './docusign.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { MailService } from '../mail/mail.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { CasesService } from '../cases/cases.service';
import { docusignToContractStatus } from './contract-status';
import { stampLiaIdentity } from './engagement-letter-stamp';
import { linkCaseContactToUser } from '../common/link-case-contact.helper';
import {
  DocusealService,
  buildEngagementSubmitters,
  docusealSubmitterStatus,
} from './docuseal.service';

// PR-DOCUSIGN-1 step 5 piece 5a/5b — real engagement-letter PDF.
// Lives at backend/assets/contract-templates/. Read lazily on first
// createContract() call and cached for the rest of the process
// lifetime (it's static content committed with the code). The earlier
// placeholder-v1 file stays alongside this one as an artifact —
// referenced by nothing in code, kept in case anyone wants to compare
// the multi-signer scaffolding shape against the real document.
const ENGAGEMENT_LETTER_PDF_REL_PATH = 'assets/contract-templates/engagement-letter-v1.pdf';

// PR-CONTRACT-CAPTURE — Document.category for the stored signed engagement PDF.
// Doubles as the idempotency key: at most one signed_contract Document per case.
const SIGNED_CONTRACT_CATEGORY = 'signed_contract';

// PR-DOCUSIGN-1 step 5 piece 3 — DocuSign recipient status →
// ContractSignerStatus mapping. Returns null on unrecognized values
// so the webhook handler can skip the row rather than poison it with
// raw text. Mappings:
//   'created'   ↔ PENDING   (recipient slot exists, not yet sent)
//   'sent'      ↔ SENT      (email dispatched to this recipient)
//   'delivered' ↔ VIEWED    (recipient opened the envelope)
//   'signed'    ↔ SIGNED    (intermediate state in some flows)
//   'completed' ↔ SIGNED    (DocuSign's "this recipient is done")
//   'declined'  ↔ DECLINED  (recipient refused to sign)
function docusignRecipientStatusToSignerStatus(
  s: string | null | undefined,
): ContractSignerStatus | null {
  switch (s) {
    case 'created':   return ContractSignerStatus.PENDING;
    case 'sent':      return ContractSignerStatus.SENT;
    case 'delivered': return ContractSignerStatus.VIEWED;
    case 'signed':    return ContractSignerStatus.SIGNED;
    case 'completed': return ContractSignerStatus.SIGNED;
    case 'declined':  return ContractSignerStatus.DECLINED;
    default:          return null;
  }
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private prisma: PrismaService,
    private docuSignService: DocuSignService,
    private mail: MailService,
    // PR-LIA-2 — auto-assign an LIA the moment the client signs.
    // The injection is one-directional (Contracts -> Cases-side
    // LiaAssignmentService); no circular import risk.
    private liaAssignments: LiaAssignmentService,
    // PR-CONTRACT-CAPTURE — store the signed PDF in R2 on completion.
    private r2: R2Service,
    // PR-DOCUSEAL — the active contract provider (DocuSign kept for rollback).
    private docuseal: DocusealService,
    // PR-CONTRACT-LEAD (Phase B) — auto-create the case when the client signs a
    // lead-based contract. CasesModule already exports CasesService and
    // ContractsModule imports it, so this is a plain (non-circular) injection.
    private cases: CasesService,
  ) {}

  // PR-DOCUSIGN-1 step 5 piece 2 — multi-signer envelope creation.
  //
  // New flow:
  //   1. Validate case + no existing contract.
  //   2. Auto-pick the LIA via the PR-LIA-2 service (idempotent on
  //      already-assigned cases; 422 if no candidate exists).
  //   3. Resolve the three signer identities:
  //        signer 1 — CLIENT   (case.lead.contact)
  //        signer 2 — LIA      (assigned User)
  //        signer 3 — DIRECTOR (env vars)
  //   4. Read the placeholder engagement-letter PDF.
  //   5. Dispatch the multi-signer envelope via DocuSignService
  //      (network call, outside any DB transaction so a failure
  //       doesn't leave orphan rows behind).
  //   6. In one $transaction, write the Contract row + 3 ContractSigner
  //      rows (CLIENT=SENT, LIA+DIRECTOR=PENDING; per-row docusignRecipientId
  //      mirrors the envelope's recipientId so the webhook handler in
  //      piece 3 can look up the matching row by it).
  //
  // The DocuSign-side email dispatch is automatic for envelope.status
  // === 'sent' with signers lacking clientUserId — signer 1 gets the
  // invite immediately, signer 2 once signer 1 completes, etc. We do
  // NOT send our own Sorena-branded "contract ready" email in this
  // step; the DocuSign email reaches the same address. If we later
  // want a Sorena-branded notification too, it lands in a follow-up.
  //
  // The existing downstream at-sign + at-payment LIA-assign triggers
  // (handleWebhook in this file, handlePaymentSucceeded in
  // payments.controller.ts) continue to fire; case.liaId is set here
  // BEFORE either trigger runs, so both short-circuit through the
  // assignLiaToCase 'already_assigned' branch and stay idempotent.
  // PR-CONTRACT-GATE (Phase A) — precondition before ANY engagement contract is
  // created/sent. Two rules:
  //   1. The client must have COMPLETED their free 15-minute consultation.
  //   2. If the lead is red-flagged for immigration/legal review
  //      (liaEscalationRequired === HS4), an LIA-type consultation must be
  //      COMPLETED with a recorded verdict of APPROVED. A missing verdict, or a
  //      REJECTED / NEEDS_MORE_INFO / WITHDRAWN verdict, keeps the send locked.
  // A non-flagged lead is NOT affected by any LIA session (only rule 1 applies).
  // Throws UnprocessableEntity with a client-safe message the UI surfaces.
  private async assertContractSendAllowed(lead: {
    id: string;
    liaEscalationRequired: boolean;
  }): Promise<void> {
    const free15 = await this.prisma.consultation.findFirst({
      where: {
        leadId: lead.id,
        type: ConsultationType.FREE_15,
        status: ConsultationStatus.COMPLETED,
      },
      select: { id: true },
    });
    if (!free15) {
      throw new UnprocessableEntityException(
        "This client hasn't completed their free 15-minute consultation yet.",
      );
    }

    if (lead.liaEscalationRequired) {
      const liaSession = await this.prisma.consultation.findFirst({
        where: {
          leadId: lead.id,
          type: ConsultationType.LIA,
          status: ConsultationStatus.COMPLETED,
          decision: { not: null },
        },
        orderBy: { decidedAt: 'desc' },
        select: { decision: true },
      });
      if (!liaSession) {
        throw new UnprocessableEntityException(
          'This case has a flagged immigration/legal concern. Contract sending is locked until an LIA holds a consultation and approves.',
        );
      }
      if (liaSession.decision !== LegalDecision.APPROVED) {
        const msg =
          liaSession.decision === LegalDecision.NEEDS_MORE_INFO
            ? 'The LIA reviewed this case and needs more information before it can proceed. Contract sending stays locked until an LIA approves.'
            : liaSession.decision === LegalDecision.WITHDRAWN
              ? 'The LIA review for this case was withdrawn. Contract sending stays locked until an LIA approves.'
              : 'The LIA reviewed this case and did not approve it. Contract sending stays locked until an LIA approves.';
        throw new UnprocessableEntityException(msg);
      }
    }
  }

  // PR-DOCUSEAL — shared send-prep for BOTH providers, extracted verbatim from
  // the original DocuSign createContract so the DocuSeal path reuses the EXACT
  // same gating (not a copy): validate the case + client identity, assign the
  // LIA (422 if none) + Admission + Finance, resolve the LIA identity + IAA
  // licence, and the director identity from env. Returns the three signer
  // identities the provider dispatch needs.
  // PR-CONTRACT-LEAD (Phase B) — `target` is EITHER an existing case (caseId,
  // legacy) OR a lead with no case yet (leadId). The resolved lead + client
  // contact, the Phase-A gate, and the LIA pick are identical in both; only the
  // LIA *assignment* differs (case-based assigns to the case + Admission/Finance;
  // lead-based just picks — the case created on client-sign is pointed at this
  // same LIA, and Admission/Finance are assigned then / at full completion). The
  // returned `resolved` tells the caller whether to persist caseId or leadId.
  private async prepareEngagementSend(target: { caseId?: string; leadId?: string }): Promise<{
    clientContact: { email: string; fullName: string; userId: string | null };
    lia: { id: string; email: string; name: string };
    iaaLicenceNumber: string | null;
    directorEmail: string;
    directorName: string;
    resolved: { caseId: string | null; leadId: string | null };
  }> {
    const caseId = target.caseId ?? null;
    const leadId = target.leadId ?? null;
    if ((caseId && leadId) || (!caseId && !leadId)) {
      throw new BadRequestException('A contract send must target exactly one of caseId or leadId.');
    }

    // 1. Resolve the lead + client contact, and guard against a duplicate
    //    contract, from EITHER the case (legacy) or the lead (Phase B).
    let resolvedLeadId: string;
    let liaEscalationRequired: boolean;
    let clientContact: { email: string | null; fullName: string | null; userId: string | null } | null | undefined;

    if (caseId) {
      const caseRecord = await this.prisma.case.findUnique({
        where: { id: caseId },
        include: { contract: true, lead: { include: { contact: true } } },
      });
      if (!caseRecord) {
        throw new NotFoundException('Case not found');
      }
      if (caseRecord.contract) {
        throw new BadRequestException('Contract already exists for this case');
      }
      if (!caseRecord.lead) {
        throw new BadRequestException('Case has no lead — cannot identify the client');
      }
      resolvedLeadId = caseRecord.lead.id;
      liaEscalationRequired = caseRecord.lead.liaEscalationRequired;
      clientContact = caseRecord.lead.contact;
    } else {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId! },
        include: {
          contact: true,
          cases: { select: { id: true }, take: 1 },
          // A LIVE lead-based contract already sent for this lead (caseId still
          // null). The partial unique index is the hard backstop; this is the
          // friendly pre-check.
          contracts: { where: { caseId: null }, select: { id: true }, take: 1 },
        },
      });
      if (!lead) {
        throw new NotFoundException('Lead not found');
      }
      if (lead.cases.length > 0) {
        throw new BadRequestException('This lead already has a case — send the contract from the case.');
      }
      if (lead.contracts.length > 0) {
        throw new BadRequestException('A contract has already been sent for this lead.');
      }
      resolvedLeadId = lead.id;
      liaEscalationRequired = lead.liaEscalationRequired;
      clientContact = lead.contact;
    }

    if (!clientContact || !clientContact.email || !clientContact.fullName) {
      throw new BadRequestException(
        'No client contact with email + full name — cannot identify the CLIENT signer',
      );
    }

    // 1b. PR-CONTRACT-GATE (Phase A) — consultation-completion + LIA-approval
    //     precondition. Runs BEFORE any assignment/dispatch, for EVERY provider
    //     and EVERY caller (there is only this one send path). Unchanged: it keys
    //     on the LEAD, so it works identically for case-based and lead-based sends.
    await this.assertContractSendAllowed({
      id: resolvedLeadId,
      liaEscalationRequired,
    });

    // 2. Resolve the LIA who becomes the contract's LIA signer.
    let liaId: string;
    if (caseId) {
      // Case-based (legacy): assign to the case (idempotent) + Admission/Finance.
      const assignResult = await this.liaAssignments.assignLiaToCase(caseId);
      if (assignResult.status === 'no_candidates') {
        throw new UnprocessableEntityException(
          'Cannot send contract — no LIA available to assign to this case.',
        );
      }
      if (!assignResult.liaId) {
        throw new InternalServerErrorException(
          `LIA assignment returned status=${assignResult.status} but no liaId — inconsistent state`,
        );
      }
      liaId = assignResult.liaId;

      // Phase 3 — auto-assign the Admission Specialist + Finance officer at the
      // same trigger as the LIA. Placed AFTER the LIA assign so the existing
      // no-LIA UnprocessableException still governs whether the send proceeds.
      // Unlike the LIA, a missing Admission/Finance staffer must NOT block the
      // send — the methods never throw, but each call is try/catch-wrapped as
      // defence-in-depth.
      try {
        const adm = await this.liaAssignments.assignAdmissionToCase(caseId);
        this.logger.log(
          `Admission auto-assign for case ${caseId}: ${adm.status}` +
            (adm.ownerId ? ` → ${adm.ownerId}${adm.replacedStrayOwner ? ' (replaced stray owner)' : ''}` : ''),
        );
      } catch (err: any) {
        this.logger.error(
          `Admission auto-assign failed for case ${caseId} (non-fatal): ${err?.message ?? err}`,
        );
      }
      try {
        const fin = await this.liaAssignments.assignFinanceToCase(caseId);
        this.logger.log(
          `Finance auto-assign for case ${caseId}: ${fin.status}` +
            (fin.financeId ? ` → ${fin.financeId}` : ''),
        );
      } catch (err: any) {
        this.logger.error(
          `Finance auto-assign failed for case ${caseId} (non-fatal): ${err?.message ?? err}`,
        );
      }
    } else {
      // Lead-based (Phase B): pick the least-loaded LIA WITHOUT a case write. The
      // case (auto-created when the client signs) is pointed at this same LIA, and
      // Admission/Finance are assigned at that point / re-asserted at completion.
      const picked = await this.liaAssignments.pickLeastLoadedLia();
      if (picked.status === 'no_candidates' || !picked.liaId) {
        throw new UnprocessableEntityException(
          'Cannot send contract — no LIA available to sign the engagement letter.',
        );
      }
      liaId = picked.liaId;
    }

    // PR-DOCUSIGN-1 step 5 piece 5c — load liaProfile alongside the
    // user so the LIA's IAA licence number can pre-fill the Clause 2.1
    // + page-11 IAA tabs the 5b tab map emits. liaProfile is an
    // optional 1:1 relation on User (a brand-new LIA may not have one
    // yet); iaaLicenceNumber inside it is nullable too. Both missing
    // states are treated the same (blank IAA field, send proceeds, see
    // below).
    const lia = await this.prisma.user.findUnique({
      where: { id: liaId },
      select: {
        id:    true,
        email: true,
        name:  true,
        liaProfile: { select: { iaaLicenceNumber: true } },
      },
    });
    if (!lia) {
      throw new InternalServerErrorException('Assigned LIA user not found in DB');
    }

    // Missing-IAA policy: WARN, do NOT block. The IAA field is an unlocked
    // text field, so the LIA can fill the number at signing time on their
    // device. Blocking the send here would be more disruptive than helpful —
    // the case is already at the contract-dispatch stage, the client is
    // waiting, and the LIA has a separate "complete your profile" path.
    const iaaLicenceNumber = lia.liaProfile?.iaaLicenceNumber ?? null;
    if (!iaaLicenceNumber) {
      this.logger.warn(
        `Contract dispatch for ${caseId ? `case ${caseId}` : `lead ${resolvedLeadId}`}: assigned LIA ${lia.id} (${lia.email}) ` +
        `has no IAA licence number on file — the IAA Licence Number field will be sent blank; ` +
        `the LIA can fill it at signing time. Send proceeds.`,
      );
    }

    // 3. Director identity from env (D5). Refuse if either is missing —
    //    can't construct a valid 3-party envelope without a Director.
    const directorEmail = process.env.CONTRACT_DIRECTOR_EMAIL;
    const directorName  = process.env.CONTRACT_DIRECTOR_NAME;
    if (!directorEmail || !directorName) {
      throw new UnprocessableEntityException(
        'Cannot send contract — director identity not configured. Set CONTRACT_DIRECTOR_EMAIL and CONTRACT_DIRECTOR_NAME in backend/.env',
      );
    }

    return {
      clientContact: {
        email:    clientContact.email,
        fullName: clientContact.fullName,
        userId:   clientContact.userId ?? null,
      },
      lia: { id: lia.id, email: lia.email, name: lia.name },
      iaaLicenceNumber,
      directorEmail,
      directorName,
      resolved: { caseId, leadId },
    };
  }

  async createContract(
    dto: CreateContractDto,
    actor: { id: string; name: string | null; role: string | null },
  ) {
    const { clientContact, lia, iaaLicenceNumber, directorEmail, directorName, resolved } =
      await this.prepareEngagementSend({ caseId: dto.caseId, leadId: dto.leadId });

    // 4. Read the engagement-letter PDF (lazy + cached, static asset)
    //    and stamp the LIA's identity into it BEFORE handing to
    //    DocuSign. After 5g the LIA's name + IAA Licence Number live
    //    in the document's static layer at both occurrences (page 1
    //    Clause 2.1 and page 11 LIA-block) — DocuSign sees them as
    //    document content, not editable tabs. Pure function.
    const engagementLetterBytes = this.getEngagementLetterBytes();
    const stampedBytes = await stampLiaIdentity(engagementLetterBytes, {
      liaName:          lia.name,
      iaaLicenceNumber: iaaLicenceNumber ?? '',
    });

    // 5. Build the signer + document specs. recipientId 1/2/3 mirrors
    //    routingOrder so the matching ContractSigner row's
    //    docusignRecipientId is the same value, simplifying the
    //    piece-3 webhook lookup.
    // Per 5h — each signer carries the DocuSign template roleName
    // (verbatim, case-sensitive — typos break sends with
    // TEMPLATE_ROLE_NOT_FOUND). The template owns all field positions
    // and the visa-checkbox group; the platform supplies only
    // identity + routing.
    const signers: EnvelopeRecipientSpec[] = [
      {
        recipientId:  '1',
        routingOrder: 1,
        templateRole: TEMPLATE_ROLE_CLIENT,
        email:        clientContact.email,
        name:         clientContact.fullName,
      },
      {
        recipientId:  '2',
        routingOrder: 2,
        templateRole: TEMPLATE_ROLE_LIA,
        email:        lia.email,
        name:         lia.name,
      },
      {
        recipientId:  '3',
        routingOrder: 3,
        templateRole: TEMPLATE_ROLE_DIRECTOR,
        email:        directorEmail,
        name:         directorName,
      },
    ];
    const documents: EnvelopeDocumentSpec[] = [{
      documentId:    '1',
      name:          'Engagement letter.pdf',
      fileExtension: 'pdf',
      bytes:         stampedBytes,
    }];

    // 6. Dispatch to DocuSign. Outside the DB transaction — if this
    //    throws (network error, JWT auth, etc.), no DB writes happen.
    //    If this succeeds but the transaction below fails, the
    //    envelope exists in DocuSign with no local row; recovery is
    //    manual (void the envelope or rerun with the existing
    //    envelopeId once we add a recovery path).
    const envelopeId = await this.docuSignService.createEnvelope(
      documents,
      signers,
      {
        emailSubject: 'Sorena Visa engagement letter — signature required',
        emailBlurb:   'Please review and sign the attached engagement letter. The other signers will be notified in order once you complete your signature.',
        // Reference id for DocuSign metadata — the case if we have one, else the
        // lead (Phase B lead-based send, before the case exists).
        caseId:       resolved.caseId ?? resolved.leadId ?? undefined,
      },
    );

    // 7. Persist Contract + 3 ContractSigner rows atomically. Initial
    //    statuses reflect DocuSign's just-issued routing: signer 1 has
    //    received the email (SENT); signers 2 + 3 are queued (PENDING).
    //    docusignRecipientId mirrors recipientId from the envelope.
    const contract = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: {
          // PR-CONTRACT-LEAD (Phase B) — exactly one of these is set: caseId for a
          // legacy case-based send, leadId for a lead-based send (caseId backfilled
          // on client-sign).
          caseId:              resolved.caseId,
          leadId:              resolved.leadId,
          docusignEnvelopeId:  envelopeId,
          status:              ContractStatus.SENT,
        },
      });
      await tx.contractSigner.createMany({
        data: [
          {
            contractId:           c.id,
            role:                 ContractSignerRole.CLIENT,
            routingOrder:         1,
            signerName:           clientContact.fullName,
            signerEmail:          clientContact.email,
            userId:               clientContact.userId ?? null,
            docusignRecipientId:  '1',
            status:               ContractSignerStatus.SENT,
          },
          {
            contractId:           c.id,
            role:                 ContractSignerRole.LIA,
            routingOrder:         2,
            signerName:           lia.name,
            signerEmail:          lia.email,
            userId:               lia.id,
            docusignRecipientId:  '2',
            status:               ContractSignerStatus.PENDING,
          },
          {
            contractId:           c.id,
            role:                 ContractSignerRole.DIRECTOR,
            routingOrder:         3,
            signerName:           directorName,
            signerEmail:          directorEmail,
            // Director has no FK to the User table — env-configured
            // singleton role, not a database-resolved person.
            userId:               null,
            docusignRecipientId:  '3',
            status:               ContractSignerStatus.PENDING,
          },
        ],
      });
      return c;
    });

    // 8. Audit the send, attributed to the acting staff user (who / when /
    //    which case). Mirrors the inline auditLog.create pattern used by the
    //    LEAD→STUDENT promotion below. Written after the contract + signers
    //    are persisted so entityId references a real row.
    await this.prisma.auditLog.create({
      data: {
        userId:            actor.id,
        action:            'CONTRACT_SENT',
        eventType:         'CONTRACT_SENT',
        entityType:        'Contract',
        entityId:          contract.id,
        newValue:          { caseId: resolved.caseId, leadId: resolved.leadId, status: 'SENT' } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name,
        actorRoleSnapshot: actor.role,
      },
    });

    this.logger.log(
      `Contract ${contract.id} created for ${resolved.caseId ? `case ${resolved.caseId}` : `lead ${resolved.leadId}`} ` +
      `with envelope ${envelopeId} (CLIENT → LIA → DIRECTOR)`,
    );
    return contract;
  }

  // PR-DOCUSEAL — the ACTIVE send path. Same prep + persist shape as
  // createContract, but dispatches via DocuSeal (a submission from the template)
  // instead of a DocuSign envelope. Signer rows carry docusealSubmissionId (not
  // docusignRecipientId — the webhook matches signers back by email).
  async createContractViaDocuseal(
    dto: CreateContractDto,
    actor: { id: string; name: string | null; role: string | null },
  ) {
    const { clientContact, lia, iaaLicenceNumber, directorEmail, directorName, resolved } =
      await this.prepareEngagementSend({ caseId: dto.caseId, leadId: dto.leadId });

    // Build the three ordered submitters with the known fields pre-filled and
    // create the submission (send_email=true, order preserved → Client → LIA →
    // Director emailed in turn). Network call OUTSIDE the DB transaction so a
    // failure leaves no orphan rows.
    const submitters = buildEngagementSubmitters({
      client:   { email: clientContact.email, name: clientContact.fullName },
      lia:      { email: lia.email, name: lia.name },
      director: { email: directorEmail, name: directorName },
      iaaLicenceNo: iaaLicenceNumber,
    });
    const { submissionId } = await this.docuseal.createSubmission(submitters, {
      sendEmail: true,
      order: 'preserved',
    });

    // Persist Contract + 3 ContractSigner rows atomically. Client=SENT (emailed
    // first), LIA+DIRECTOR=PENDING. docusealSubmissionId links the webhook back;
    // docusignRecipientId stays null (the DocuSeal webhook matches by email).
    const contract = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: {
          // PR-CONTRACT-LEAD (Phase B) — case-based (legacy) sets caseId;
          // lead-based sets leadId (caseId backfilled on client-sign).
          caseId:               resolved.caseId,
          leadId:               resolved.leadId,
          docusealSubmissionId: submissionId,
          status:               ContractStatus.SENT,
        },
      });
      await tx.contractSigner.createMany({
        data: [
          {
            contractId:   c.id,
            role:         ContractSignerRole.CLIENT,
            routingOrder: 1,
            signerName:   clientContact.fullName,
            signerEmail:  clientContact.email,
            userId:       clientContact.userId ?? null,
            status:       ContractSignerStatus.SENT,
          },
          {
            contractId:   c.id,
            role:         ContractSignerRole.LIA,
            routingOrder: 2,
            signerName:   lia.name,
            signerEmail:  lia.email,
            userId:       lia.id,
            status:       ContractSignerStatus.PENDING,
          },
          {
            contractId:   c.id,
            role:         ContractSignerRole.DIRECTOR,
            routingOrder: 3,
            signerName:   directorName,
            signerEmail:  directorEmail,
            userId:       null,
            status:       ContractSignerStatus.PENDING,
          },
        ],
      });
      return c;
    });

    await this.prisma.auditLog.create({
      data: {
        userId:            actor.id,
        action:            'CONTRACT_SENT',
        eventType:         'CONTRACT_SENT',
        entityType:        'Contract',
        entityId:          contract.id,
        newValue:          { caseId: resolved.caseId, leadId: resolved.leadId, status: 'SENT', provider: 'docuseal', submissionId } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name,
        actorRoleSnapshot: actor.role,
      },
    });

    this.logger.log(
      `Contract ${contract.id} created for ${resolved.caseId ? `case ${resolved.caseId}` : `lead ${resolved.leadId}`} ` +
      `via DocuSeal submission ${submissionId} (CLIENT → LIA → DIRECTOR)`,
    );
    return contract;
  }

  private engagementLetterBytesCache: Buffer | null = null;

  private getEngagementLetterBytes(): Buffer {
    if (this.engagementLetterBytesCache !== null) return this.engagementLetterBytesCache;
    const filePath = path.resolve(ENGAGEMENT_LETTER_PDF_REL_PATH);
    if (!fs.existsSync(filePath)) {
      throw new InternalServerErrorException(
        `Engagement-letter PDF not found at ${filePath} (cwd: ${process.cwd()})`,
      );
    }
    this.engagementLetterBytesCache = fs.readFileSync(filePath);
    return this.engagementLetterBytesCache;
  }

  async getContract(caseId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { caseId },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    return contract;
  }

  // PR-DOCUSIGN-1 step 5 piece 3 — multi-signer webhook handler.
  //
  // TODO PR-DOCUSIGN-N (webhook signature): DocuSign Connect signs
  // the raw body with an HMAC using the Connect HMAC Key set in
  // DocuSign Admin and sends it via the X-DocuSign-Signature-1
  // header. Verification belongs in the controller (before this
  // method runs) and requires the NestJS bootstrap to preserve the
  // raw body before JSON-parsing it. Without this check, any third
  // party can POST envelope IDs to /contracts/webhook and trigger
  // the state transitions below.
  //
  // Flow:
  //   1. Find Contract by envelopeId. Gracefully no-op (return null,
  //      log warn) on miss — webhooks can arrive for voided / stale
  //      envelopes and we don't want to 4xx DocuSign on that.
  //   2. Call DocuSignService.syncStatus(envelopeId) for envelope-level
  //      state (Contract.status / signedAt / declinedAt / expiredAt).
  //   3. Call DocuSignService.listRecipients(envelopeId) — option (b)
  //      re-sync. Authoritative per-recipient state from DocuSign;
  //      don't trust the webhook body.
  //   4. For each recipient: look up the matching ContractSigner row
  //      by docusignRecipientId; update status + timestamps + decline
  //      reason ONLY when at least one field differs from the
  //      current row state.
  //   5. Update Contract row similarly — only when envelope-level
  //      state differs.
  //   6. Fire the existing PR-LIA-2 at-sign trigger (now an idempotent
  //      no-op because case.liaId is set at createContract time per
  //      step 5 piece 2; kept as a safety net for envelopes that
  //      bypassed the new createContract path).
  //
  // Idempotency: a duplicate webhook hits the same listRecipients
  // result, which produces zero diffs on each row (the
  // "only-update-if-changed" predicate is the lock). Contract +
  // ContractSigner rows are not updated, updatedAt does not move.
  // The at-sign trigger short-circuits via 'already_assigned'.
  async handleWebhook(envelopeId: string) {
    // 1. Look up Contract + child signers. Don't throw on miss.
    const contract = await this.prisma.contract.findFirst({
      where: { docusignEnvelopeId: envelopeId },
      include: { signers: true },
    });
    if (!contract) {
      this.logger.warn(
        `handleWebhook: no Contract for envelopeId=${envelopeId} — webhook ignored gracefully (likely voided or stale envelope)`,
      );
      return null;
    }

    // 2. Envelope-level state from DocuSign (existing call).
    const statusData = await this.docuSignService.syncStatus(envelopeId);
    const mappedStatus = docusignToContractStatus(statusData.status);
    if (!mappedStatus) {
      this.logger.warn(
        `handleWebhook: unknown DocuSign envelope status "${statusData.status}" for envelope ${envelopeId} — skipping status update`,
      );
      return contract;
    }

    // 3. Per-recipient authoritative state (option b).
    const recipients = await this.docuSignService.listRecipients(envelopeId);
    const dsSigners = recipients.signers ?? [];
    const signerByRecipientId = new Map<string, (typeof contract.signers)[number]>();
    for (const s of contract.signers) {
      if (s.docusignRecipientId) signerByRecipientId.set(s.docusignRecipientId, s);
    }

    // 4. Update ContractSigner rows idempotently — only when changed.
    for (const dsRec of dsSigners) {
      if (!dsRec.recipientId) continue;
      const row = signerByRecipientId.get(dsRec.recipientId);
      if (!row) {
        this.logger.warn(
          `Envelope ${envelopeId} has recipientId=${dsRec.recipientId} with no matching ContractSigner row — ignoring`,
        );
        continue;
      }
      const newStatus = docusignRecipientStatusToSignerStatus(dsRec.status);
      if (newStatus === null) {
        this.logger.warn(
          `Envelope ${envelopeId} recipientId=${dsRec.recipientId} reports unknown status "${dsRec.status}" — leaving row unchanged`,
        );
        continue;
      }
      const updates: Prisma.ContractSignerUpdateInput = {};
      if (newStatus !== row.status) updates.status = newStatus;
      const viewedAt = dsRec.deliveredDateTime ? new Date(dsRec.deliveredDateTime) : null;
      if (viewedAt && (!row.viewedAt || row.viewedAt.getTime() !== viewedAt.getTime())) {
        updates.viewedAt = viewedAt;
      }
      const signedAt = dsRec.signedDateTime ? new Date(dsRec.signedDateTime) : null;
      if (signedAt && (!row.signedAt || row.signedAt.getTime() !== signedAt.getTime())) {
        updates.signedAt = signedAt;
      }
      const declinedAt = dsRec.declinedDateTime ? new Date(dsRec.declinedDateTime) : null;
      if (declinedAt && (!row.declinedAt || row.declinedAt.getTime() !== declinedAt.getTime())) {
        updates.declinedAt = declinedAt;
      }
      if (dsRec.declinedReason && dsRec.declinedReason !== row.declineReason) {
        updates.declineReason = dsRec.declinedReason;
      }
      if (Object.keys(updates).length > 0) {
        await this.prisma.contractSigner.update({
          where: { id: row.id },
          data: updates,
        });
      }
    }

    // 5. Update Contract row only on envelope-level diffs. We DO NOT
    //    invent a new ContractStatus value for "partially signed" —
    //    the SIGNED state corresponds to DocuSign's envelope-status
    //    "completed", which DocuSign only reports when ALL recipients
    //    have signed. "How far along is the envelope?" is derived
    //    from the child ContractSigner rows (this PR populates them
    //    so the UI can ask later).
    const contractChanges: Prisma.ContractUpdateInput = {};
    if (mappedStatus !== contract.status) contractChanges.status = mappedStatus;
    if (mappedStatus === ContractStatus.SIGNED && statusData.signedAt) {
      const signedAt = new Date(statusData.signedAt);
      if (!contract.signedAt || contract.signedAt.getTime() !== signedAt.getTime()) {
        contractChanges.signedAt = signedAt;
      }
      if (statusData.signedFileUrl && statusData.signedFileUrl !== contract.signedFileUrl) {
        contractChanges.signedFileUrl = statusData.signedFileUrl;
      }
      if (statusData.auditTrailUrl && statusData.auditTrailUrl !== contract.auditTrailUrl) {
        contractChanges.auditTrailUrl = statusData.auditTrailUrl;
      }
    } else if (mappedStatus === ContractStatus.DECLINED && statusData.declinedAt) {
      const declinedAt = new Date(statusData.declinedAt);
      if (!contract.declinedAt || contract.declinedAt.getTime() !== declinedAt.getTime()) {
        contractChanges.declinedAt = declinedAt;
      }
    } else if (mappedStatus === ContractStatus.EXPIRED && statusData.expiredAt) {
      const expiredAt = new Date(statusData.expiredAt);
      if (!contract.expiredAt || contract.expiredAt.getTime() !== expiredAt.getTime()) {
        contractChanges.expiredAt = expiredAt;
      }
    }
    let updated = contract;
    if (Object.keys(contractChanges).length > 0) {
      updated = (await this.prisma.contract.update({
        where: { id: contract.id },
        data: contractChanges,
        include: { signers: true },
      })) as typeof contract;
    }

    // 6. Existing PR-LIA-2 at-sign trigger — now an idempotent safety
    //    net because case.liaId is set at createContract time. Kept
    //    so envelopes created via other paths still get assignment.
    if (mappedStatus === ContractStatus.SIGNED) {
      try {
        const result = await this.liaAssignments.assignLiaToCase(contract.caseId);
        if (result.status === 'assigned') {
          this.logger.log(
            `LIA ${result.liaName} (${result.liaId}) auto-assigned to case ${contract.caseId} on contract sign`,
          );
        } else if (result.status === 'no_candidates') {
          this.logger.warn(
            `Contract for case ${contract.caseId} signed but no active LIAs available — case left unassigned`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `LIA auto-assignment failed for case ${contract.caseId}: ${err?.message ?? err}`,
        );
      }
      // Phase 3 — Admission + Finance auto-assign at the same SIGNED safety-net
      // hook, in lockstep with the LIA above. Idempotent + never-throw; wrapped
      // so a failure never blocks the webhook response.
      try {
        const adm = await this.liaAssignments.assignAdmissionToCase(contract.caseId);
        if (adm.status === 'assigned') {
          this.logger.log(
            `Admission Specialist ${adm.ownerName} (${adm.ownerId}) auto-assigned to case ${contract.caseId} on contract sign` +
              (adm.replacedStrayOwner ? ' (replaced stray owner)' : ''),
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Admission auto-assignment failed for case ${contract.caseId}: ${err?.message ?? err}`,
        );
      }
      try {
        const fin = await this.liaAssignments.assignFinanceToCase(contract.caseId);
        if (fin.status === 'assigned') {
          this.logger.log(
            `Finance officer ${fin.financeName} (${fin.financeId}) auto-assigned to case ${contract.caseId} on contract sign`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Finance auto-assignment failed for case ${contract.caseId}: ${err?.message ?? err}`,
        );
      }

      // PR-CONTRACT-CAPTURE — on full completion, store the flattened signed PDF
      // as a case Document and capture the LIA's visaType selection onto the
      // case. Idempotent + never-throw (a DocuSign/R2 hiccup must not fail the
      // webhook — DocuSign would otherwise retry the whole event).
      await this.captureSignedArtifacts(contract.caseId, envelopeId);
    }

    // 7. PR-CLIENT-STAGE — auto-promote the client LEAD → STUDENT once BOTH
    //    the client party (CLIENT or GUARDIAN) AND the LIA have signed, so
    //    they can reach the /student/* Stage-2 pages. Director signature is
    //    NOT required. Best-effort: never blocks the webhook response.
    await this.maybePromoteClientToStudent(contract.id, contract.caseId);

    // 8. Gap #4 — auto-create the fixed engagement invoice once the CLIENT
    //    party has signed (NOT waiting for the LIA), so the client's Pay-now
    //    (buildNextSteps SENT filter) surfaces with zero staff action.
    //    Best-effort + idempotent: one ENG-<caseId> invoice per case, ever.
    await this.maybeCreateEngagementInvoice(contract.id, contract.caseId);

    return updated;
  }

  // PR-DOCUSEAL — webhook handler for form.completed / submission.completed.
  // The guard (shared secret) runs BEFORE this; here we ADDITIONALLY re-fetch the
  // submission from the DocuSeal API (authoritative) rather than trust the
  // payload. On full completion we mark the contract SIGNED, capture the visaType
  // + signed PDF via the SAME storage helpers the DocuSign path uses, then run
  // the identical downstream (LIA/Admission/Finance safety-net, LEAD→STUDENT
  // promotion, engagement invoice). Idempotent; graceful no-op on stale/unknown.
  async handleDocusealWebhook(payload: any) {
    const eventType: string | undefined = payload?.event_type;
    // form.completed → data.submission_id; submission.completed → data.id.
    const submissionId = payload?.data?.submission_id ?? payload?.data?.id ?? null;
    if (!submissionId) {
      this.logger.warn(
        `handleDocusealWebhook: no submission id in payload (event=${eventType}) — ignored`,
      );
      return null;
    }

    const contract = await this.prisma.contract.findFirst({
      where: { docusealSubmissionId: String(submissionId) },
      include: { signers: true },
    });
    if (!contract) {
      this.logger.warn(
        `handleDocusealWebhook: no Contract for submissionId=${submissionId} — ignored (stale/unknown)`,
      );
      return null;
    }

    // Authoritative re-fetch — never trust the webhook body for state.
    const submission = await this.docuseal.getSubmission(submissionId);
    const submitters: any[] = submission?.submitters ?? [];

    // Update signer rows from the authoritative submitters (matched by email).
    const rowByEmail = new Map<string, (typeof contract.signers)[number]>();
    for (const s of contract.signers) {
      if (s.signerEmail) rowByEmail.set(s.signerEmail.toLowerCase(), s);
    }
    for (const sub of submitters) {
      const email = String(sub?.email ?? '').toLowerCase();
      const row = email ? rowByEmail.get(email) : undefined;
      if (!row) continue;
      const mapped = docusealSubmitterStatus(sub?.status);
      if (!mapped) continue;
      const updates: Prisma.ContractSignerUpdateInput = {};
      if (mapped !== row.status) updates.status = ContractSignerStatus[mapped];
      const completedAt = sub?.completed_at ? new Date(sub.completed_at) : null;
      if (completedAt && (!row.signedAt || row.signedAt.getTime() !== completedAt.getTime())) {
        updates.signedAt = completedAt;
      }
      const openedAt = sub?.opened_at ? new Date(sub.opened_at) : null;
      if (openedAt && (!row.viewedAt || row.viewedAt.getTime() !== openedAt.getTime())) {
        updates.viewedAt = openedAt;
      }
      if (Object.keys(updates).length > 0) {
        await this.prisma.contractSigner.update({ where: { id: row.id }, data: updates });
      }
    }

    // "Fully signed" — the submission is completed (all parties done). DocuSeal
    // reports this on submission.completed; we also derive it from the submitters.
    const allCompleted =
      submission?.status === 'completed' ||
      (submitters.length > 0 && submitters.every((s) => s?.status === 'completed'));
    if (!allCompleted) {
      // Per-submitter timing. The signer rows were just synced above, so read
      // which parties have now signed. DocuSeal preserves the Client → LIA →
      // Director order, so liaSigned necessarily implies clientSigned.
      const signedRows = await this.prisma.contractSigner.findMany({
        where:  { contractId: contract.id, signedAt: { not: null } },
        select: { role: true },
      });
      const clientSigned = signedRows.some(
        (s) => s.role === ContractSignerRole.CLIENT || s.role === ContractSignerRole.GUARDIAN,
      );
      const liaSigned = signedRows.some((s) => s.role === ContractSignerRole.LIA);

      // PR-CONTRACT-LEAD (Phase B) — the moment the CLIENT (first signer) completes,
      // auto-create the Case for a lead-based contract and backfill Contract.caseId.
      // Idempotent: on a retry contract.caseId is already set so ensure* is a no-op
      // create-or-find. Case-based contracts already carry caseId from send time.
      let caseId = contract.caseId;
      if (clientSigned && !caseId && contract.leadId) {
        caseId = await this.ensureCaseForLeadBasedContract(contract.id, contract.leadId);
      }

      // PR-ACCESS-GATE (Phase C) — fire the $200 engagement invoice + the
      // LEAD→STUDENT promotion the moment the LIA has countersigned (the client
      // has necessarily already signed). We deliberately do NOT wait for the
      // Director: their signature is purely the company's own countersignature
      // for the record and unlocks nothing new. Both helpers are internally
      // guarded (invoice: client signed + no existing ENG invoice; promotion:
      // client + LIA signed + role still LEAD) and fully idempotent, so a webhook
      // retry of the LIA-signed event never double-invoices or double-promotes.
      // We still do NOT capture the signed PDF here — that waits for full
      // completion in the allCompleted branch below.
      if (liaSigned && caseId) {
        await this.maybePromoteClientToStudent(contract.id, caseId);
        await this.maybeCreateEngagementInvoice(contract.id, caseId);
      }

      this.logger.log(
        `handleDocusealWebhook: submission ${submissionId} not fully completed (event=${eventType}) — ` +
        `signer rows synced` +
        `${clientSigned ? ' [client signed]' : ''}` +
        `${liaSigned ? ' [LIA signed → invoice/promotion fired]' : ''}; awaiting completion`,
      );
      return contract;
    }

    // PR-CONTRACT-LEAD (Phase B) — a lead-based contract can reach full completion
    // with caseId STILL null (e.g. the first webhook we ever see is
    // submission.completed, with no prior per-signer event). Ensure the case exists
    // and caseId is backfilled BEFORE any downstream runs; skip (loudly) if it can't
    // be created rather than crashing the webhook into a retry storm.
    let caseId = contract.caseId;
    if (!caseId && contract.leadId) {
      caseId = await this.ensureCaseForLeadBasedContract(contract.id, contract.leadId);
    }
    if (!caseId) {
      this.logger.error(
        `handleDocusealWebhook: submission ${submissionId} fully completed but has no caseId ` +
        `(lead ${contract.leadId ?? 'none'}) — downstream skipped, needs manual attention.`,
      );
      return contract;
    }

    // Mark the contract SIGNED (only if changed — idempotent on re-delivery).
    const completedAt = submission?.completed_at ? new Date(submission.completed_at) : new Date();
    if (contract.status !== ContractStatus.SIGNED) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data:  { status: ContractStatus.SIGNED, signedAt: completedAt },
      });
    }

    // Capture visaType (from the LIA's completed values) + the signed PDF, via
    // the SAME provider-agnostic helpers the DocuSign path uses. `caseId` is the
    // resolved (backfilled) case id — guaranteed non-null by the guard above.
    await this.storeCaseVisaType(caseId, String(submissionId), () =>
      Promise.resolve(this.docuseal.extractVisaType(submission)),
    );
    await this.storeSignedContractPdf(caseId, String(submissionId), () =>
      this.docuseal.downloadCompletedPdf(submissionId),
    );

    // Downstream — identical to the DocuSign SIGNED path. All idempotent.
    try {
      await this.liaAssignments.assignLiaToCase(caseId);
    } catch (err: any) {
      this.logger.error(`DocuSeal: LIA assign failed for case ${caseId}: ${err?.message ?? err}`);
    }
    try {
      await this.liaAssignments.assignAdmissionToCase(caseId);
    } catch (err: any) {
      this.logger.error(`DocuSeal: Admission assign failed for case ${caseId}: ${err?.message ?? err}`);
    }
    try {
      await this.liaAssignments.assignFinanceToCase(caseId);
    } catch (err: any) {
      this.logger.error(`DocuSeal: Finance assign failed for case ${caseId}: ${err?.message ?? err}`);
    }

    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ PR-ACCESS-GATE (Phase C) — engagement invoice + student promotion.    │
    // │ Intended timing (see the partial branch above):                       │
    // │   • Case creation      → fires at CLIENT-signed  (Phase B)            │
    // │   • Invoice + promotion → fire at LIA-signed      (Phase C)           │
    // │   • The DIRECTOR's final signature triggers NEITHER — it is purely    │
    // │     the company's own countersignature for the record.                │
    // │ These two calls REMAIN here only as an idempotent SAFETY NET for the  │
    // │ edge case where the very first webhook we ever see is                 │
    // │ submission.completed (all three signatures coalesced), so the partial │
    // │ LIA-signed branch never ran. Both helpers are guarded + idempotent,   │
    // │ so on the normal Director-signed event they are no-ops (invoice       │
    // │ already exists, client already STUDENT). Do not remove this net.      │
    // └──────────────────────────────────────────────────────────────────────┘
    await this.maybePromoteClientToStudent(contract.id, caseId);
    await this.maybeCreateEngagementInvoice(contract.id, caseId);

    this.logger.log(
      `handleDocusealWebhook: submission ${submissionId} completed → contract ${contract.id} SIGNED + downstream run`,
    );
    return contract;
  }

  // PR-CONTRACT-LEAD (Phase B) — ensure a Case exists for a lead-based contract and
  // backfill Contract.caseId. Called the moment the CLIENT signs (and again as a
  // safety net at full completion). Fully idempotent + retry-safe:
  //   • reuses an existing case for the lead if there is one;
  //   • createCase throws "Case already exists" on a concurrent/duplicate webhook —
  //     we catch it and look the case up;
  //   • a genuine createCase failure (e.g. the lead still isn't execution-eligible)
  //     is logged LOUDLY and returns null rather than crashing the webhook into a
  //     DocuSeal retry storm — the contract stays lead-based for manual attention.
  // On success it also points the case at the contract's LIA signer, so the LIA who
  // signed the engagement letter is the LIA assigned to the case (signer == owner).
  private async ensureCaseForLeadBasedContract(
    contractId: string,
    leadId: string,
  ): Promise<string | null> {
    // Idempotency: reuse an existing case for this lead if one is already there.
    const existing = await this.prisma.case.findFirst({
      where: { leadId },
      select: { id: true, liaId: true },
    });

    let caseId: string;
    let caseHasLia: boolean;
    if (existing) {
      caseId = existing.id;
      caseHasLia = existing.liaId !== null;
    } else {
      try {
        const created = await this.cases.createCase({ leadId }, null);
        caseId = created.id;
        caseHasLia = false;
      } catch (err: any) {
        // "Case already exists for this lead" — a concurrent create / webhook retry.
        const race = await this.prisma.case.findFirst({
          where: { leadId },
          select: { id: true, liaId: true },
        });
        if (race) {
          caseId = race.id;
          caseHasLia = race.liaId !== null;
        } else {
          this.logger.error(
            `PhaseB: could NOT create a case for lead-based contract ${contractId} (lead ${leadId}): ` +
            `${err?.message ?? err}. Contract stays lead-based — needs manual attention.`,
          );
          return null;
        }
      }
    }

    // Backfill the contract's caseId (idempotent — same value on every retry).
    await this.prisma.contract.update({
      where: { id: contractId },
      data:  { caseId },
    });

    // Point the case at the contract's LIA signer so signer == case LIA (only if
    // the case doesn't already have an LIA — never overwrite an existing one).
    if (!caseHasLia) {
      const liaSigner = await this.prisma.contractSigner.findFirst({
        where:  { contractId, role: ContractSignerRole.LIA },
        select: { userId: true },
      });
      if (liaSigner?.userId) {
        await this.prisma.case.update({
          where: { id: caseId },
          data:  { liaId: liaSigner.userId, liaAssignedAt: new Date() },
        });
      }
    }

    this.logger.log(
      `PhaseB: case ${caseId} ensured for lead-based contract ${contractId} (lead ${leadId}); caseId backfilled.`,
    );
    return caseId;
  }

  // PR-CONTRACT-CAPTURE — download + persist the signed artifacts once an
  // envelope is fully signed. Two independent, idempotent, best-effort steps:
  //   A. the flattened signed PDF → R2 → a case Document (category
  //      'signed_contract', status UPLOADED) so it appears in the case's
  //      documents list and is downloadable via the existing signed-URL route.
  //   B. the LIA's visaType checkbox selection → Case.visaType.
  // Neither throws: a failure logs and leaves the webhook succeeding.
  private async captureSignedArtifacts(caseId: string, envelopeId: string): Promise<void> {
    // Delegates to the provider-agnostic helpers (shared with the DocuSeal
    // path), supplying DocuSign fetchers for the bytes + visaType.
    await this.storeSignedContractPdf(caseId, envelopeId, () =>
      this.docuSignService.getCombinedDocument(envelopeId),
    );
    await this.storeCaseVisaType(caseId, envelopeId, () =>
      this.docuSignService.getSelectedVisaType(envelopeId),
    );
  }

  // Provider-agnostic: store the fully-signed PDF as a case Document (category
  // signed_contract). `ref` (envelope/submission id) is used in the R2 key +
  // audit. `getBytes` is invoked ONLY when we actually need to store (so an
  // already-stored contract skips the download). Idempotent + never throws.
  private async storeSignedContractPdf(
    caseId: string,
    ref: string,
    getBytes: () => Promise<Buffer>,
  ): Promise<void> {
    try {
      const already = await this.prisma.document.findFirst({
        where: { caseId, category: SIGNED_CONTRACT_CATEGORY },
        select: { id: true },
      });
      if (already) {
        this.logger.log(
          `storeSignedContractPdf: signed contract already stored for case ${caseId} — skipping PDF`,
        );
        return;
      }
      const caseRow = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { liaId: true, ownerId: true },
      });
      // Attribute the system-stored PDF to the responsible LIA (guaranteed set
      // by contract-send + re-asserted on SIGNED); fall back to the owner.
      const uploaderId = caseRow?.liaId ?? caseRow?.ownerId ?? null;
      if (!uploaderId) {
        this.logger.warn(
          `storeSignedContractPdf: case ${caseId} has no LIA/owner to attribute the signed contract — PDF not stored`,
        );
        return;
      }
      const bytes = await getBytes();
      const key = `signed-contracts/${caseId}/${ref}.pdf`;
      await this.r2.putObject(key, bytes, 'application/pdf');
      try {
        await this.prisma.document.create({
          data: {
            caseId,
            uploaderId,
            r2Key:        key,
            originalName: 'Signed engagement letter.pdf',
            mimeType:     'application/pdf',
            sizeBytes:    bytes.length,
            status:       DocumentUploadStatus.UPLOADED,
            category:     SIGNED_CONTRACT_CATEGORY,
          },
        });
        await this.prisma.auditLog.create({
          data: {
            action:     'CONTRACT_SIGNED_PDF_STORED',
            eventType:  'CONTRACT_SIGNED_PDF_STORED',
            entityType: 'CASE',
            entityId:   caseId,
            newValue:   { ref, r2Key: key, sizeBytes: bytes.length } as Prisma.InputJsonValue,
          },
        });
        this.logger.log(
          `storeSignedContractPdf: stored signed contract for case ${caseId} (${bytes.length} bytes)`,
        );
      } catch (err: any) {
        // Unique r2Key backstop — a concurrent webhook already stored it.
        if (err?.code === 'P2002') {
          this.logger.log(
            `storeSignedContractPdf: signed contract row already exists (race) for case ${caseId}`,
          );
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      this.logger.error(
        `storeSignedContractPdf: failed to store signed PDF for case ${caseId}: ${err?.message ?? err}`,
      );
    }
  }

  // Provider-agnostic: capture the LIA's visaType selection onto the case.
  // `getVisaType` is invoked ONLY when the case has none yet. Idempotent + never
  // throws.
  private async storeCaseVisaType(
    caseId: string,
    ref: string,
    getVisaType: () => Promise<string | null>,
  ): Promise<void> {
    try {
      const caseRow = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { visaType: true },
      });
      if (caseRow?.visaType) {
        this.logger.log(
          `storeCaseVisaType: case ${caseId} already has visaType — skipping`,
        );
        return;
      }
      const visaType = await getVisaType();
      if (visaType) {
        await this.prisma.case.update({ where: { id: caseId }, data: { visaType } });
        await this.prisma.auditLog.create({
          data: {
            action:     'CONTRACT_VISA_TYPE_CAPTURED',
            eventType:  'CONTRACT_VISA_TYPE_CAPTURED',
            entityType: 'CASE',
            entityId:   caseId,
            newValue:   { ref, visaType } as Prisma.InputJsonValue,
          },
        });
        this.logger.log(
          `storeCaseVisaType: captured visaType="${visaType}" for case ${caseId}`,
        );
      } else {
        this.logger.warn(
          `storeCaseVisaType: no visaType selection found (ref ${ref}) for case ${caseId}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `storeCaseVisaType: failed to capture visaType for case ${caseId}: ${err?.message ?? err}`,
      );
    }
  }

  // PR-CLIENT-STAGE — promote the case's client user LEAD → STUDENT when the
  // client-party signer AND the LIA signer have both signed. Idempotent
  // (already STUDENT / any other role → no-op), one-directional (only ever
  // promotes LEAD; never demotes), and director-independent. Scoped strictly
  // to the one user tied to this contract (contract → case → lead → contact →
  // userId). Webhook-only path — not client-triggerable.
  private async maybePromoteClientToStudent(contractId: string, caseId: string): Promise<void> {
    try {
      const signers = await this.prisma.contractSigner.findMany({
        where:  { contractId, role: { in: ['CLIENT', 'GUARDIAN', 'LIA'] } },
        select: { role: true, signedAt: true },
      });
      const clientSigned = signers.some(
        (s) => (s.role === 'CLIENT' || s.role === 'GUARDIAN') && s.signedAt !== null,
      );
      const liaSigned = signers.some((s) => s.role === 'LIA' && s.signedAt !== null);
      if (!clientSigned || !liaSigned) return; // director ignored; not yet both-signed

      const c = await this.prisma.case.findUnique({
        where:  { id: caseId },
        select: { lead: { select: { contact: { select: { userId: true } } } } },
      });
      let userId = c?.lead?.contact?.userId ?? null;
      // PR-CONTACT-LINK resilience: a case-bearing contact left unlinked by the
      // staff "Create case" path would otherwise silently block promotion. Try
      // the same email-based auto-link before giving up (best-effort, no throw).
      if (!userId) {
        const link = await linkCaseContactToUser(this.prisma, caseId);
        userId = link.linked ? link.userId : null;
      }
      if (!userId) return; // client has no user account to promote

      const user = await this.prisma.user.findUnique({
        where: { id: userId }, select: { id: true, role: true },
      });
      // One-directional + idempotent: only the pre-contract LEAD is promoted;
      // an already-STUDENT (duplicate webhook) or any staff role is a no-op.
      if (!user || !this.shouldPromoteToStudent(user.role)) return;

      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { role: 'STUDENT' } });
        await tx.auditLog.create({
          data: {
            userId,
            action:            'CLIENT_PROMOTED_TO_STUDENT',
            eventType:         'CLIENT_PROMOTED_TO_STUDENT',
            entityType:        'USER',
            entityId:          userId,
            oldValue:          { role: 'LEAD' } as Prisma.InputJsonValue,
            newValue:          { role: 'STUDENT', reason: 'contract client+LIA signed', caseId } as Prisma.InputJsonValue,
            actorNameSnapshot: 'SYSTEM',
            actorRoleSnapshot: 'SYSTEM',
          },
        });
      });
      this.logger.log(`Client ${userId} promoted LEAD → STUDENT on contract sign (case ${caseId})`);
    } catch (err: any) {
      // Never let a promotion failure break the webhook.
      this.logger.error(
        `Client LEAD→STUDENT promotion check failed for case ${caseId}: ${err?.message ?? err}`,
      );
    }
  }

  // Only the pre-contract client role is promotable. STUDENT (idempotent
  // no-op on duplicate webhooks) and every staff role are left untouched.
  private shouldPromoteToStudent(role: string | null | undefined): boolean {
    return role === 'LEAD';
  }

  // Gap #4 — auto-create the fixed engagement invoice when the client signs.
  //
  // Trigger: a CLIENT/GUARDIAN signer on this contract has signedAt set (the
  // client has signed) — the LIA/director are NOT required. Fee is config-
  // driven (ENGAGEMENT_FEE_CENTS / ENGAGEMENT_FEE_CURRENCY, defaults
  // 20000 / USD) so the number is never hardcoded in the logic body.
  //
  // Idempotent — ONE engagement invoice per case, ever: the invoiceNumber is
  // the deterministic `ENG-<caseId>` and `Invoice.invoiceNumber` is @unique.
  // A fast-path existence check skips (and avoids a duplicate audit row); a
  // concurrent re-delivery that races the create is caught via P2002 and
  // treated as already-done. Best-effort: any failure is logged, never
  // thrown — it must not break the webhook or block the promotion above.
  private async maybeCreateEngagementInvoice(contractId: string, caseId: string): Promise<void> {
    try {
      // Trigger: has the client party signed? (not waiting for LIA)
      const signers = await this.prisma.contractSigner.findMany({
        where:  { contractId, role: { in: ['CLIENT', 'GUARDIAN'] } },
        select: { signedAt: true },
      });
      if (!signers.some((s) => s.signedAt !== null)) return;

      const invoiceNumber = `ENG-${caseId}`;

      // Idempotency fast-path: already created on an earlier signed event.
      const existing = await this.prisma.invoice.findUnique({
        where:  { invoiceNumber },
        select: { id: true },
      });
      if (existing) return;

      // The invoice needs the case's client contact.
      const c = await this.prisma.case.findUnique({
        where:  { id: caseId },
        select: { lead: { select: { contactId: true } } },
      });
      const contactId = c?.lead?.contactId ?? null;
      if (!contactId) {
        this.logger.warn(`Engagement invoice skipped for case ${caseId} — no client contact`);
        return;
      }

      // Config-driven fee (never hardcode the amount in the body).
      const amountCents = Number(process.env.ENGAGEMENT_FEE_CENTS ?? 20000);
      const currency = (process.env.ENGAGEMENT_FEE_CURRENCY ?? 'USD').toUpperCase();
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        this.logger.error(
          `Engagement invoice skipped for case ${caseId} — invalid ENGAGEMENT_FEE_CENTS "${process.env.ENGAGEMENT_FEE_CENTS}"`,
        );
        return;
      }
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      try {
        const inv = await this.prisma.invoice.create({
          data: {
            caseId,
            contactId,
            invoiceNumber,
            description: 'Engagement fee',
            amount:      new Prisma.Decimal(amountCents).div(100),
            currency,
            status:      'SENT',
            dueDate,
          },
          select: { id: true },
        });
        await this.prisma.auditLog.create({
          data: {
            userId:            null,
            action:            'INVOICE_CREATED_ON_SIGN',
            eventType:         'INVOICE_CREATED_ON_SIGN',
            entityType:        'Invoice',
            entityId:          inv.id,
            newValue:          { caseId, amountCents, currency } as Prisma.InputJsonValue,
            actorNameSnapshot: 'SYSTEM',
            actorRoleSnapshot: 'SYSTEM',
          },
        });
        this.logger.log(
          `Engagement invoice ${invoiceNumber} created (SENT, ${currency} ${(amountCents / 100).toFixed(2)}) for case ${caseId} on client sign`,
        );
      } catch (err: any) {
        if (err?.code === 'P2002') {
          // A concurrent signed-event re-delivery created it first — idempotent
          // no-op, and no duplicate audit row.
          this.logger.log(
            `Engagement invoice ${invoiceNumber} already exists (P2002 race) — idempotent skip`,
          );
          return;
        }
        throw err;
      }
    } catch (err: any) {
      this.logger.error(
        `Engagement invoice creation failed for case ${caseId}: ${err?.message ?? err}`,
      );
    }
  }

  async getSigningUrl(caseId: string, returnUrl: string) {
    const contract = await this.getContract(caseId);

    if (!contract.docusignEnvelopeId) {
      throw new NotFoundException('Envelope ID not found');
    }

    const caseRecord = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { lead: { include: { contact: true } } },
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    return this.docuSignService.getSigningUrl(
      contract.docusignEnvelopeId,
      caseRecord.lead.contact.email,
      caseRecord.lead.contact.fullName,
      returnUrl,
    );
  }
}
