import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { DocusignWebhookGuard } from './docusign-webhook.guard';
import { DocusealWebhookGuard } from './docuseal-webhook.guard';

// PR-DOCUSIGN-N (webhook signature) — guards are applied PER-ROUTE, not
// class-wide. The two staff-facing routes keep JwtAuthGuard + RolesGuard
// (POST / also pins @Roles); the webhook route swaps to DocusignWebhookGuard,
// which verifies DocuSign's HMAC over the raw body. DocuSign sends no JWT, so
// the HMAC is that route's sole authentication — a class-wide JwtAuthGuard
// would have 401'd every legitimate DocuSign delivery.
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  // PR-CONTRACT-LEAD (Phase B) — CLIENT_CONSULTANT (Client Officer) added: they
  // originate lead-based sends from the lead detail page (and read the case-side
  // status). Applies to both send + read; the Phase A gate is unchanged.
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CLIENT_CONSULTANT')
  create(@Body() dto: CreateContractDto, @Req() req: any) {
    // JwtStrategy.validate returns { userId, email, role } — there is no
    // `req.user.id` and no guaranteed `name`. Build the actor object the
    // same way cases.controller.ts does so the send can be attributed.
    const actor = {
      id:   req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
    // PR-DOCUSEAL — provider switch. DocuSeal is the active default; set
    // CONTRACT_PROVIDER=docusign to roll back to the (intact) DocuSign flow with
    // no code change.
    const provider = (process.env.CONTRACT_PROVIDER ?? 'docuseal').toLowerCase();
    return provider === 'docusign'
      ? this.contractsService.createContract(dto, actor)
      : this.contractsService.createContractViaDocuseal(dto, actor);
  }

  // Legal contract data (DocuSign envelope, signer details) for a case. Was
  // JwtAuthGuard+RolesGuard with NO @Roles → allow-all (any authed user could
  // read any case's contract by id). Gated to the same staff set that may send
  // a contract (matches @Post above).
  @Get(':caseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  // PR-CONTRACT-LEAD (Phase B) — CLIENT_CONSULTANT (Client Officer) added: they
  // originate lead-based sends from the lead detail page (and read the case-side
  // status). Applies to both send + read; the Phase A gate is unchanged.
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CLIENT_CONSULTANT')
  getContract(@Param('caseId') caseId: string) {
    return this.contractsService.getContract(caseId);
  }

  // DocuSign Connect retries on 4xx/5xx; a 429 from the global
  // ThrottlerGuard would back up envelope status sync.
  // DocusignWebhookGuard verifies the X-DocuSign-Signature-* HMAC on the raw
  // body BEFORE this handler runs — a forged/unsigned POST gets 401 and never
  // reaches the state machine below.
  @SkipThrottle()
  @UseGuards(DocusignWebhookGuard)
  @Post('webhook')
  handleWebhook(@Body() body: any) {
    // DocuSign webhook payload contains envelopeId
    const envelopeId = body.envelopeId || body.data?.envelopeId;
    if (!envelopeId) {
      throw new Error('Envelope ID not found in webhook payload');
    }
    return this.contractsService.handleWebhook(envelopeId);
  }

  // PR-DOCUSEAL — DocuSeal completion webhook. DocusealWebhookGuard verifies the
  // shared-secret header before this runs; the handler then re-fetches the
  // submission from the DocuSeal API (authoritative) before acting. SkipThrottle
  // so a 429 never backs up DocuSeal's retries.
  @SkipThrottle()
  @UseGuards(DocusealWebhookGuard)
  @Post('docuseal/webhook')
  handleDocusealWebhook(@Body() body: any) {
    return this.contractsService.handleDocusealWebhook(body);
  }
}
