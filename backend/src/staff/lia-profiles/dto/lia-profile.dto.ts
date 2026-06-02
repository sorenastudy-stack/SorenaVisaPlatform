import { IsString, Matches, MinLength, MaxLength } from 'class-validator';

// PR-DOCUSIGN-1 step 3 — IAA licence number set/update DTO.
//
// IAA register numbers are numeric per the public register. 6-12 digits
// is a permissive starting range; tune to the real format as we observe
// production numbers. Trim happens at the service layer.
export class UpdateLicenceNumberDto {
  @IsString()
  @Matches(/^[0-9]{6,12}$/, {
    message: 'iaaLicenceNumber must be 6-12 digits, numeric only.',
  })
  iaaLicenceNumber!: string;
}

// PR-DOCUSIGN-1 step 3 — OWNER/ADMIN rejection DTO.
//
// 10-1000 char ceiling: under 10 chars is too curt to be useful to the
// LIA; over 1000 risks unbounded text in audit_logs. Plaintext (not
// encrypted) because IAA licence rejection commentary references the
// LIA's own credential — no third-party PII in scope.
export class RejectLicenceDto {
  @IsString()
  @MinLength(10, { message: 'reason must be at least 10 characters.' })
  @MaxLength(1000, { message: 'reason must be at most 1000 characters.' })
  reason!: string;
}
