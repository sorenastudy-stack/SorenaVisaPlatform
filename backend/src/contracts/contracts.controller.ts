import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';

// PR-DOCUSIGN-1 step 5 piece 2 — RolesGuard added class-wide so
// per-route @Roles() metadata can pin down who reaches each endpoint.
// RolesGuard returns true when a route has no @Roles() metadata, so
// existing routes without the decorator are unchanged. POST / now
// requires staff roles only (D6: pre-existing security hole closed).
// The webhook route is still un-roled — DocuSign POSTs there with no
// JWT, which Piece 3 will replace with HMAC signature verification.
@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA')
  create(@Body() dto: CreateContractDto) {
    return this.contractsService.createContract(dto);
  }

  @Get(':caseId')
  getContract(@Param('caseId') caseId: string) {
    return this.contractsService.getContract(caseId);
  }

  // DocuSign Connect retries on 4xx/5xx; a 429 from the global
  // ThrottlerGuard would back up envelope status sync.
  @SkipThrottle()
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
