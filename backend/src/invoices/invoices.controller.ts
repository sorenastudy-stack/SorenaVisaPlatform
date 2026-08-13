import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InvoicesService, INVOICE_STAFF_ROLES } from './invoices.service';

// PR-TAX-INVOICE — downloading the document.
//
// Two routes because they answer different questions. The client route asks
// "is this yours"; the staff route asks "are you the money tier". They are not
// one route with a branch, because a branch is where the two rules eventually
// drift into each other.
//
// The bytes are streamed to the authenticated caller. There is no stored file
// and no signed link — sponsor access (somebody without a login holding a
// forwarded payment link) is deliberately out of scope, so nothing here can be
// reached without a session.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id ?? null,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
      secondaryRoles: req.user?.secondaryRoles ?? [],
    };
  }

  /** The caller's OWN invoice. Ownership from the JWT; a foreign one 404s. */
  @Get('portal/me/invoices/:invoiceId/pdf')
  @Roles('LEAD', 'STUDENT')
  async clientPdf(@Param('invoiceId') invoiceId: string, @Req() req: any, @Res() res: Response) {
    const actor = this.actor(req);
    const { buffer, filename } = await this.invoices.renderForClient(actor.id, invoiceId, actor);
    this.send(res, buffer, filename);
  }

  /** Any invoice, for the money tier. */
  @Get('staff/invoices/:invoiceId/pdf')
  @Roles(...INVOICE_STAFF_ROLES)
  async staffPdf(@Param('invoiceId') invoiceId: string, @Req() req: any, @Res() res: Response) {
    const { buffer, filename } = await this.invoices.renderForStaff(invoiceId, this.actor(req));
    this.send(res, buffer, filename);
  }

  private send(res: Response, buffer: Buffer, filename: string) {
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', buffer.length)
      // Never cached: the document states a status that can change, and a cached
      // "UNPAID" surviving the payment is the thing this design avoids.
      .setHeader('Cache-Control', 'no-store, max-age=0')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }
}
