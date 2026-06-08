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
  Prisma,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  DocuSignService,
  EnvelopeDocumentSpec,
  EnvelopeRecipientSpec,
  TEMPLATE_ROLE_CLIENT,
  TEMPLATE_ROLE_LIA,
  TEMPLATE_ROLE_DIRECTOR,
} from './docusign.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { LiaAssignmentService } from '../cases/lia-assignment.service';
import { docusignToContractStatus } from './contract-status';
import { stampLiaIdentity } from './engagement-letter-stamp';

// PR-DOCUSIGN-1 step 5 piece 5a/5b — real engagement-letter PDF.
// Lives at backend/assets/contract-templates/. Read lazily on first
// createContract() call and cached for the rest of the process
// lifetime (it's static content committed with the code). The earlier
// placeholder-v1 file stays alongside this one as an artifact —
// referenced by nothing in code, kept in case anyone wants to compare
// the multi-signer scaffolding shape against the real document.
const ENGAGEMENT_LETTER_PDF_REL_PATH = 'assets/contract-templates/engagement-letter-v1.pdf';

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
    private notificationsService: NotificationsService,
    // PR-LIA-2 — auto-assign an LIA the moment the client signs.
    // The injection is one-directional (Contracts -> Cases-side
    // LiaAssignmentService); no circular import risk.
    private liaAssignments: LiaAssignmentService,
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
  async createContract(dto: CreateContractDto) {
    // 1. Validate case + no existing contract + client identity present.
    const caseRecord = await this.prisma.case.findUnique({
      where: { id: dto.caseId },
      include: { contract: true, lead: { include: { contact: true } } },
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    if (caseRecord.contract) {
      throw new BadRequestException('Contract already exists for this case');
    }
    const clientContact = caseRecord.lead?.contact;
    if (!clientContact || !clientContact.email || !clientContact.fullName) {
      throw new BadRequestException(
        'Case has no client contact with email + full name — cannot identify the CLIENT signer',
      );
    }

    // 2. Auto-pick the LIA. assignLiaToCase is idempotent on
    //    already-assigned cases (returns 'already_assigned' with the
    //    existing liaId), so it's safe to call unconditionally.
    const assignResult = await this.liaAssignments.assignLiaToCase(dto.caseId);
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
    // PR-DOCUSIGN-1 step 5 piece 5c — load liaProfile alongside the
    // user so the LIA's IAA licence number can pre-fill the Clause 2.1
    // + page-11 IAA tabs the 5b tab map emits. liaProfile is an
    // optional 1:1 relation on User (a brand-new LIA may not have one
    // yet); iaaLicenceNumber inside it is nullable too. Both missing
    // states are treated the same (blank IAA tab, send proceeds, see
    // below).
    const lia = await this.prisma.user.findUnique({
      where: { id: assignResult.liaId },
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

    // Missing-IAA policy: WARN, do NOT block. 5b made the IAA tabs
    // unlocked text fields, so the LIA can fill the number at signing
    // time on their device. Blocking the send here would be more
    // disruptive than helpful — the case is already at the contract-
    // dispatch stage, the client is waiting, and the LIA has a
    // separate "complete your profile" path to backfill the DB row.
    const iaaLicenceNumber = lia.liaProfile?.iaaLicenceNumber ?? null;
    if (!iaaLicenceNumber) {
      this.logger.warn(
        `Contract dispatch for case ${dto.caseId}: assigned LIA ${lia.id} (${lia.email}) ` +
        `has no IAA licence number on file — the IAA Licence Number tab will be sent blank; ` +
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
        caseId:       dto.caseId,
      },
    );

    // 7. Persist Contract + 3 ContractSigner rows atomically. Initial
    //    statuses reflect DocuSign's just-issued routing: signer 1 has
    //    received the email (SENT); signers 2 + 3 are queued (PENDING).
    //    docusignRecipientId mirrors recipientId from the envelope.
    const contract = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: {
          caseId:              dto.caseId,
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

    this.logger.log(
      `Contract ${contract.id} created for case ${dto.caseId} with envelope ${envelopeId} (CLIENT → LIA → DIRECTOR)`,
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
    }

    return updated;
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
