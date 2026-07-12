import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StudentDocumentStatusService } from './student-document-status.service';

// Item 1 — student-facing document review status.
//
// GET /students/me/documents/review-status
//   Owner-scoped strictly by the caller's JWT userId (no case id in the path);
//   returns the review verdict for the student's own ADMISSION +
//   VISA_SUPPORTING documents. STUDENT/AGENT only (documents sit behind the
//   payment gate; a LEAD has none). Reviewer identity is never returned and
//   the rejection reason is server-side gated (see the service).
@Controller('students/me/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT', 'AGENT')
export class StudentDocumentStatusController {
  constructor(private readonly service: StudentDocumentStatusService) {}

  @Get('review-status')
  reviewStatus(@Req() req: any) {
    return this.service.listOwnDocumentStatuses(req.user.userId);
  }
}
