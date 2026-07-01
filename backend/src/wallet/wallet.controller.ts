import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WalletService } from './wallet.service';

// PR-WALLET slice 1 — client wallet view. Same guard set as the booking
// endpoints (clients are LEAD/STUDENT). The acting client is ALWAYS the JWT
// user — a caller can only ever read their OWN wallet.
@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LEAD', 'STUDENT')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  // GET /wallet — balance (Int cents) + recent ledger for the signed-in client.
  @Get()
  mine(@Req() req: any) {
    return this.wallet.getBalanceAndLedger(req.user?.userId ?? req.user?.id);
  }
}
