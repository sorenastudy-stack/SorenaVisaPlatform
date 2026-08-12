import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { StaffRoles } from '../roles/staff-roles.decorator';
import { StaffPaymentsService } from './staff-payments.service';
import { ExchangeRateService } from '../../payments/exchange-rate.service';
import { SetExchangeRateDto } from './dto/set-exchange-rate.dto';
import { AccountingOverviewService } from './accounting-overview.service';

// Finance portal — read-only overview + confirmed-payments ledger.
//
// FINANCE (the accountant) + OWNER only, enforced server-side by
// StaffRolesGuard against req.user.role. Every other staff role and every
// client is 403. Additive — no existing route or role is altered.
const CONFIRMERS = ['OWNER', 'FINANCE'] as const;

@Controller('staff/finance')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffFinanceController {
  constructor(
    private readonly service: StaffPaymentsService,
    private readonly exchangeRates: ExchangeRateService,
    private readonly accounting: AccountingOverviewService,
  ) {}

  // GET /staff/finance/accounting-overview → the counts behind the accounting
  // dashboard. Same gate as the rest of this controller: the page is the
  // accountant's, and everything on it is money.
  //
  // Note `pendingPaymentCount` here answers a DIFFERENT question from
  // `pendingCount` on /dashboard above: this one counts PAYMENTS a person must
  // verify, that one counts INVOICES whose receipt is waiting on review. Both
  // are real queues; they are labelled differently on screen for that reason.
  @Get('accounting-overview')
  @StaffRoles(...CONFIRMERS)
  accountingOverview() {
    return this.accounting.overview();
  }

  // GET /staff/finance/dashboard → { pendingCount, confirmedThisWeek, confirmedAllTime }
  @Get('dashboard')
  @StaffRoles(...CONFIRMERS)
  dashboard() {
    return this.service.financeDashboard();
  }

  // GET /staff/finance/finalised → confirmed-payments ledger.
  @Get('finalised')
  @StaffRoles(...CONFIRMERS)
  finalised() {
    return this.service.listFinalised();
  }

  // PR-PHASE40 — the USD→NZD rate every invoice is stamped with.
  //
  // Same FINANCE/OWNER gate as the ledger above: the person who reconciles the
  // GST is the person who sets the rate it is computed from. No external
  // provider is involved — this endpoint pair IS the source of the number.
  //
  // GET /staff/finance/exchange-rate → current rate + who set it, and the trail.
  @Get('exchange-rate')
  @StaffRoles(...CONFIRMERS)
  exchangeRate() {
    return this.exchangeRates.getCurrentAndHistory();
  }

  // POST /staff/finance/exchange-rate → append a new rate. Never edits a row:
  // the previous rate stays readable because issued invoices were stamped with it.
  @Post('exchange-rate')
  @StaffRoles(...CONFIRMERS)
  async setExchangeRate(@Body() dto: SetExchangeRateDto, @Req() req: any) {
    await this.exchangeRates.recordManualRate(dto.rate, {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
    });
    return this.exchangeRates.getCurrentAndHistory();
  }
}
