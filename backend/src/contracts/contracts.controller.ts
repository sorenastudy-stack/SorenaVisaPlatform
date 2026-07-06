import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { DocusignWebhookGuard } from './docusign-webhook.guard';

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
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA')
  create(@Body() dto: CreateContractDto, @Req() req: any) {
    // JwtStrategy.validate returns { userId, email, role } — there is no
    // `req.user.id` and no guaranteed `name`. Build the actor object the
    // same way cases.controller.ts does so the send can be attributed.
    return this.contractsService.createContract(dto, {
      id:   req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    });
  }

  @Get(':caseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
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
}
