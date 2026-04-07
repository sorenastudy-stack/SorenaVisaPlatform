import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  create(@Body() dto: CreateContractDto) {
    return this.contractsService.createContract(dto);
  }

  @Get(':caseId')
  getContract(@Param('caseId') caseId: string) {
    return this.contractsService.getContract(caseId);
  }

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
