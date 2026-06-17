import { IsIn, IsString } from 'class-validator';
import { CONSULTATION_TYPES } from './create-payment-link.dto';

// Body DTO for POST /payments/case/:caseId/consultation-link.
//
// The caseId comes from the URL; the body only carries the consultation
// type. leadId is resolved server-side from caseId — staff UIs that
// already have a case context don't need to know about leads.
//
// CONSULTATION_TYPES is imported from create-payment-link.dto.ts (the
// existing public-facing DTO) so both routes stay in lockstep — if we
// add a new consultation type in one place, the other picks it up
// without code duplication.

export class CreateCaseConsultationLinkDto {
  @IsString()
  @IsIn(CONSULTATION_TYPES as readonly string[], {
    message: `consultationType must be one of: ${CONSULTATION_TYPES.join(', ')}`,
  })
  consultationType!: string;
}
