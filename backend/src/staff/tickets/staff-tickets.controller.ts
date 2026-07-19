import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MulterExceptionFilter } from '../../students/admission/multer-exception.filter';
import { StaffTicketsService } from './staff-tickets.service';
import {
  AddStaffMessageDto,
  AssignTicketDto,
  UpdateTicketStatusDto,
} from './dto/staff-tickets.dto';
import { StaffTicketMessageRateLimitGuard } from './guards/staff-ticket-message-rate-limit.guard';

// Attachment upload: image + PDF, 10 MB, held in memory then streamed to R2 in
// the service. Type rejected at multer AND re-validated on the bytes server-side.
const ATTACH_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const attachMulter = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (ATTACH_MIMES.includes(file.mimetype)) cb(null, true);
    else { req.fileTypeRejected = true; cb(null, false); }
  },
};

// All ticket-access staff roles — the read/reply/status/assign surface. "Any
// staff member can reassign" (target is still restricted to the case cycle in
// the service), so assign now shares this set instead of the old tighter one.
const TICKET_STAFF_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA'] as const;

// PR-SUPPORT-1 — Staff-side ticket endpoints.
//
// Mounted under /staff/tickets/*. Class-level JwtAuthGuard +
// RolesGuard mirror the leads staff controller. Per-route @Roles
// pins exactly which UserRole values pass.
//
// The 6 staff roles allowed on the read + reply + status endpoints
// (OWNER / SUPER_ADMIN / ADMIN / SUPPORT / CONSULTANT / LIA) are the
// roles that can legitimately read a case's tickets — this is the
// support team plus the management tier. Reassignment is tighter
// (drops CONSULTANT and LIA) because reassignment is a workload-
// allocation decision, not a casework decision.
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('staff/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffTicketsController {
  constructor(private readonly service: StaffTicketsService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  list(
    @Req() req: any,
    @Query('status')     status?: string,
    @Query('department') department?: string,
    @Query('assigned')   assigned?: string,
    @Query('search')     search?: string,
    @Query('limit')      limit?: string,
    @Query('offset')     offset?: string,
  ) {
    return this.service.list(
      {
        status, department, assigned, search,
        limit:  limit  ? parseInt(limit, 10)  : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      },
      this.actor(req),
    );
  }

  // Candidates are scoped to THIS ticket's case cycle, so the route is per-ticket.
  @Get(':id/assignees')
  @Roles(...TICKET_STAFF_ROLES)
  assignees(@Param('id') id: string) {
    return this.service.listAssignees(id);
  }

  @Get(':id')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  detail(@Param('id') id: string, @Req() req: any) {
    return this.service.detail(id, this.actor(req));
  }

  @Post(':id/messages')
  @Roles(...TICKET_STAFF_ROLES)
  @UseGuards(StaffTicketMessageRateLimitGuard)
  addMessage(
    @Param('id') id: string,
    @Body() body: AddStaffMessageDto,
    @Req() req: any,
  ) {
    return this.service.addStaffMessage(id, body, this.actor(req));
  }

  // Upload one attachment (image/PDF) for a ticket → returns { key, name, mime,
  // size } which the composer includes in its subsequent message POST.
  @Post(':id/attachments')
  @Roles(...TICKET_STAFF_ROLES)
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', attachMulter))
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    if (req.fileTypeRejected) {
      throw new UnsupportedMediaTypeException('Allowed: JPG, PNG, WebP, or PDF.');
    }
    if (!file) throw new BadRequestException('A file is required.');
    return this.service.uploadAttachment(id, file, this.actor(req));
  }

  @Patch(':id/status')
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateTicketStatusDto,
    @Req() req: any,
  ) {
    return this.service.updateStatus(id, body, this.actor(req));
  }

  // "Any staff member can reassign" — widened from the old admin-tighter set.
  // The target is still restricted to the ticket's case cycle in the service.
  @Patch(':id/assign')
  @Roles(...TICKET_STAFF_ROLES)
  assign(
    @Param('id') id: string,
    @Body() body: AssignTicketDto,
    @Req() req: any,
  ) {
    return this.service.assign(id, body, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
