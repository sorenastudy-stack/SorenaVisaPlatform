import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WixPaymentsService } from './wix-payments.service';

// PR-SCORECARD-4 — Staff-side Wix payments browser.
//
// Mounted under /staff/wix-payments/*. Visible to OWNER, SUPER_ADMIN,
// ADMIN, and FINANCE — anyone who needs to reconcile payments. The
// raw Wix payload is included on the detail endpoint (audit-logged
// on view).
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('staff/wix-payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WixPaymentsController {
  constructor(private readonly service: WixPaymentsService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'FINANCE')
  list(
    @Query('paymentType') paymentType?: string,
    @Query('status') status?: string,
    @Query('customerEmail') customerEmail?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listPayments({
      paymentType,
      status,
      customerEmail,
      since,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('lead/:leadId')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'FINANCE')
  forLead(@Param('leadId') leadId: string) {
    return this.service.listPaymentsForLead(leadId);
  }

  @Get(':id')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'FINANCE')
  detail(@Param('id') id: string, @Req() req: any) {
    return this.service.getPayment(id, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
