import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { InzDataService } from './inz-data.service';

// PR-LIA-6 — Consolidated INZ application data viewer (read-only).
//
// Every view writes an audit row (LIA_INZ_DATA_VIEWED). PII is
// surfaced in plaintext to the LIA — the audit log is the compliance
// trail for who accessed what and when.

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
export class InzDataController {
  constructor(
    private readonly service: InzDataService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':caseId/inz-data')
  async get(@Param('caseId') caseId: string, @Req() req: any) {
    const payload = await this.service.getInzDataForCase(caseId);
    // Audit AFTER the service has resolved (so we don't log a viewing
    // event for a 404 caseId). Best-effort — a failed audit log
    // shouldn't fail the read.
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: req.user?.userId ?? req.user?.id ?? null,
          action: 'VIEW',
          eventType: 'LIA_INZ_DATA_VIEWED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { caseId } as Prisma.InputJsonValue,
          actorNameSnapshot: req.user?.name ?? null,
          actorRoleSnapshot: req.user?.role ?? null,
        },
      });
    } catch {
      /* swallow — read succeeds even if audit fails */
    }
    return payload;
  }
}
