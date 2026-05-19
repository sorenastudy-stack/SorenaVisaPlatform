import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { decryptPiiFields } from '../admission/admission-encryption.util';

// PR-VISA1: only two PII fields on the new table — keep the encryption helpers
// inline rather than building a generic util for two values. Both write to the
// sibling `<field>Encrypted` BYTEA column.
const VISA_ENCRYPTED_FIELDS = new Set(['otherNames', 'nationalId']);

// PATCH allow-list. Fields are stored as-is on the row except the two PII
// fields above, which go through CryptoService.encrypt and land in their
// `<field>Encrypted` column. middleNames has a max-30-char length cap to match
// the INZ form; passportGender is restricted to the three INZ values.
const PATCHABLE_VISA_FIELDS: Record<string, 'text' | 'boolean' | 'int' | 'datetime'> = {
  hasMononym:             'boolean',
  middleNames:            'text',
  hasUsedOtherNames:      'boolean',
  otherNames:             'text',
  countryWhenSubmitting:  'text',
  prevAppliedNzVisa:      'boolean',
  prevRequestedNzeta:     'boolean',
  everTravelledNz:        'boolean',
  totalNzTime24Plus:      'boolean',
  passportIssueDate:      'datetime',
  passportExpiryDate:     'datetime',
  passportCountryOfIssue: 'text',
  passportGender:         'text',
  stateOfBirth:           'text',
  cityOfBirth:            'text',
  hasNationalId:          'boolean',
  nationalId:             'text',
  nationalIdCountry:      'text',
  currentStep:            'int',
};

const VALID_GENDERS = new Set(['MALE', 'FEMALE', 'GENDER_DIVERSE']);
const MIDDLE_NAMES_MAX = 30;

function coerceField(
  key: string,
  value: unknown,
  type: 'text' | 'boolean' | 'int' | 'datetime',
): unknown {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'text':
      return String(value);
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new BadRequestException(`Field '${key}' must be a boolean`);
    case 'int': {
      const n = parseInt(String(value), 10);
      if (isNaN(n)) throw new BadRequestException(`Field '${key}' must be an integer`);
      return n;
    }
    case 'datetime': {
      const d = new Date(value as string);
      if (isNaN(d.getTime())) throw new BadRequestException(`Field '${key}' must be a valid ISO date`);
      return d;
    }
  }
}

@Injectable()
export class VisaService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  // ── Auth helper — same shape as AdmissionService.resolveContactAndCase ──
  // Resolves the admission_applications row the student owns, which is the
  // anchor every visa_applications row hangs off. Throws Forbidden if the
  // caller does not own a matching admission application.
  private async resolveAdmissionApplication(userId: string) {
    const contact = await this.prisma.contact.findUnique({ where: { userId } });
    if (!contact) throw new NotFoundException('Student profile not found');

    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) throw new NotFoundException('No lead found for this student');

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!caseRecord) throw new NotFoundException('No case found for this student');

    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!admission) {
      throw new NotFoundException(
        'No admission application found. Please complete admission before starting the visa section.',
      );
    }

    return { contact, admission };
  }

  // Pull the values that the Visa Section displays read-only — these are
  // collected during admission and must not be re-asked here (per
  // docs/VISA_FIELD_INVENTORY.md). passportNumber comes back decrypted.
  private buildReadonlySnapshot(
    contact: { fullName: string },
    admission: Record<string, unknown>,
  ) {
    const decryptedAdmission = decryptPiiFields(
      this.crypto,
      admission as Record<string, unknown>,
    );
    return {
      fullName:        contact.fullName,
      passportNumber:  (decryptedAdmission.passportNumber as string | null) ?? null,
      citizenship:     (admission.citizenship as string | null) ?? null,
      dateOfBirth:     (admission.dateOfBirth as Date | null) ?? null,
      countryOfBirth:  (admission.countryOfBirth as string | null) ?? null,
    };
  }

  // Decrypt the two PII fields back into plaintext keys for the API response.
  private decryptVisaRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'otherNamesEncrypted') {
        out.otherNames = value
          ? this.crypto.decrypt(Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array))
          : null;
      } else if (key === 'nationalIdEncrypted') {
        out.nationalId = value
          ? this.crypto.decrypt(Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array))
          : null;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  // GET — returns { exists, visaApplication?, readonly }. Does not auto-create
  // the row; the client POSTs explicitly. This mirrors the admission pattern.
  async getApplication(userId: string) {
    const { contact, admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });

    const readonly = this.buildReadonlySnapshot(contact, admission as Record<string, unknown>);

    if (!visa) {
      return { exists: false as const, readonly };
    }
    return {
      exists: true as const,
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly,
    };
  }

  // POST — idempotent get-or-create. Returns the row plus the readonly snapshot.
  async getOrCreateApplication(userId: string) {
    const { contact, admission } = await this.resolveAdmissionApplication(userId);
    let visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      visa = await this.prisma.visaApplication.create({
        data: { applicationId: admission.id, currentStep: 1 },
      });
    }
    return {
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly: this.buildReadonlySnapshot(contact, admission as Record<string, unknown>),
    };
  }

  // PATCH — allow-listed field update with per-type coercion and PII
  // encryption. Plaintext PII keys (`otherNames`, `nationalId`) are encrypted
  // and written to their `<field>Encrypted` BYTEA column.
  async updateApplication(userId: string, body: Record<string, unknown>) {
    const { contact, admission } = await this.resolveAdmissionApplication(userId);

    // Coerce + allow-list filter
    const sanitized: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(body)) {
      const type = PATCHABLE_VISA_FIELDS[key];
      if (!type) continue;
      sanitized[key] = coerceField(key, rawValue, type);
    }

    // Per-field validation
    if (
      typeof sanitized.middleNames === 'string' &&
      sanitized.middleNames.length > MIDDLE_NAMES_MAX
    ) {
      throw new BadRequestException(
        `middleNames must be ${MIDDLE_NAMES_MAX} characters or fewer`,
      );
    }
    if (
      sanitized.passportGender !== null &&
      sanitized.passportGender !== undefined &&
      !VALID_GENDERS.has(sanitized.passportGender as string)
    ) {
      throw new BadRequestException(
        'passportGender must be one of MALE, FEMALE, GENDER_DIVERSE',
      );
    }

    // PII encryption — move plaintext keys to `<field>Encrypted: Buffer | null`
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sanitized)) {
      if (VISA_ENCRYPTED_FIELDS.has(key)) {
        if (value === null) {
          data[`${key}Encrypted`] = null;
        } else if (typeof value === 'string') {
          data[`${key}Encrypted`] = this.crypto.encrypt(value);
        }
      } else {
        data[key] = value;
      }
    }

    // Upsert keyed on applicationId. The row is owned by the admission
    // application we already verified belongs to this caller — no extra
    // ownership check needed at the DB layer.
    const visa = await this.prisma.visaApplication.upsert({
      where:  { applicationId: admission.id },
      create: { applicationId: admission.id, ...data },
      update: data,
    });

    return {
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly: this.buildReadonlySnapshot(contact, admission as Record<string, unknown>),
    };
  }
}
