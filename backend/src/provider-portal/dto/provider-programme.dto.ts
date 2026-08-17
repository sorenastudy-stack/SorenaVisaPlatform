import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional,
  IsString, IsUrl, Max, MaxLength, Min,
} from 'class-validator';

// PR-PROVIDER-PORTAL slice D — what an institution may say about its OWN programmes.
//
// The model has ~50 columns. Most of them are not the institution's to write, and
// the split is not "how sensitive does it look" — it is one question asked of each
// field: WHOSE STATEMENT IS THIS?
//
// INCLUDED — the institution's own published academic content (21):
//   name, level, nzqfLevel, intakeMonths            — the required core
//   durationMonths, durationText                    — how long it runs
//   campusCity, deliveryMode, studentVisaSuitable    — where and how it runs
//   majorStrand, qualificationType, subjectAreaRaw   — what it is, in their words
//   tuitionFeeNZD, currency, feeBasis, feeYear       — the fee they publish
//   descriptionEn                                    — their own blurb
//   academicPrerequisites, englishRequirementRaw,
//   otherRequirements                                — their entry requirements
//   programmeUrl                                     — their own page
//
// EXCLUDED, and why. Each is either Sorena's judgement, Sorena's money, system
// state, or another party's words:
//   id, providerId          — identity. providerId comes from the guard; accepting
//                             one here is how "their own programme" stops meaning
//                             anything.
//   reviewStatus            — the review decision itself. Set by the system on
//                             create/edit and by staff on approve; never stated.
//   isActive                — its own route, deliberately: activation is not
//                             content and must not trigger re-review.
//   source, sourceRef       — provenance. "Where did this row come from" is not
//                             something the row's subject gets to answer.
//   isEnglishLanguageCourse — selects which COMMISSION rate Sorena pays itself
//                             (PR-ENGLISH-COMMISSION). Money, not academia.
//   facultyId               — a foreign key an institution could point at another
//                             institution's faculty. Nothing here accepts an id.
//   scholarshipNote         — free text that would advertise a scholarship
//                             around the reviewed ProviderScholarship path.
//   descriptionFa           — Sorena's translation, not their words.
//   careerOutcomes, highlights — AI-seeded, staff-approved recommendation
//                             enrichment (PR-PHASE32).
//   manualVideoIds          — a staff override by definition.
//   coverImageUrl           — written only by the signed-upload path.
//   verificationSourceUrl, verifiedAt, verificationStatus — Sorena's own
//                             verification of this institution's claims. Letting
//                             the subject mark itself verified is the whole
//                             problem.
//   notes                   — internal staff notes.
//   aiPopulated, aiLastRunAt, tuitionFeeRaw, tuitionParseNote — machine
//                             provenance.
//   remaining2026Intakes, published2027Intakes, projected2027Intakes,
//   intakeBasis2027, intakes2027Planning, fee2027Status — verbatim importer
//                             columns. `intakeMonths` is the structured field
//                             everything actually reads.
//   createdAt, updatedAt     — system.
//
// The global ValidationPipe runs `forbidNonWhitelisted`, so a body carrying any
// excluded field — `providerId` and `reviewStatus` included — is REJECTED with
// 400 rather than quietly dropped.

const LEVELS = [
  'CERTIFICATE', 'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
  'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD',
];
const NZQF = ['LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10'];

/**
 * The 17 fields that are optional on BOTH create and edit.
 *
 * The four catalogue-critical ones are deliberately NOT here. They are declared
 * separately on each subclass, because class-validator merges a parent's
 * decorators into the child: an `@IsOptional()` on the parent would keep
 * applying to a field the child means to require, and the requirement would
 * silently do nothing. (The first attempt used `declare` to re-type them, which
 * is worse still — a `declare` field emits no runtime property, so its
 * decorators never register and NOTHING is validated. That reached a live server
 * and turned a missing name into a 500 from Prisma.)
 */
class ProgrammeContentDto {
  @IsOptional() @IsInt() @Min(1) @Max(120) @Type(() => Number)
  durationMonths?: number;

  @IsOptional() @IsString() @MaxLength(120)
  durationText?: string;

  @IsOptional() @IsString() @MaxLength(120)
  campusCity?: string;

  @IsOptional() @IsString() @MaxLength(60)
  deliveryMode?: string;

  @IsOptional() @IsBoolean()
  studentVisaSuitable?: boolean;

  @IsOptional() @IsString() @MaxLength(200)
  majorStrand?: string;

  @IsOptional() @IsString() @MaxLength(160)
  qualificationType?: string;

  @IsOptional() @IsString() @MaxLength(160)
  subjectAreaRaw?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) @Type(() => Number)
  tuitionFeeNZD?: number;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @IsOptional() @IsString() @MaxLength(80)
  feeBasis?: string;

  @IsOptional() @IsInt() @Min(2020) @Max(2100) @Type(() => Number)
  feeYear?: number;

  @IsOptional() @IsString() @MaxLength(4000)
  descriptionEn?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  academicPrerequisites?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  englishRequirementRaw?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  otherRequirements?: string;

  @IsOptional() @IsUrl({}, { message: 'The programme link must be a valid URL.' }) @MaxLength(500)
  programmeUrl?: string;
}

/** Edit — everything optional, because an edit states only what changed. */
export class UpdateOwnProgrammeDto extends ProgrammeContentDto {
  @IsOptional() @IsString() @MaxLength(300)
  name?: string;

  @IsOptional() @IsEnum(LEVELS, { message: 'Study level is not one we recognise.' })
  level?: string;

  @IsOptional() @IsEnum(NZQF, { message: 'NZQF level must be between 3 and 10.' })
  nzqfLevel?: string;

  /** Calendar months, 1–12. The structured intake field the matcher reads. */
  @IsOptional()
  @IsArray() @ArrayMinSize(1, { message: 'Choose at least one intake month.' }) @ArrayMaxSize(12)
  @IsInt({ each: true }) @Min(1, { each: true }) @Max(12, { each: true }) @Type(() => Number)
  intakeMonths?: number[];
}

/**
 * Create — the same content fields, with the four the catalogue cannot function
 * without made mandatory. A programme with no level or no intake cannot be
 * matched to a student, so it would sit in the review queue as an unanswerable
 * question.
 */
export class CreateOwnProgrammeDto extends ProgrammeContentDto {
  @IsString({ message: 'Give the programme a name.' }) @MaxLength(300)
  name!: string;

  @IsEnum(LEVELS, { message: 'Study level is not one we recognise.' })
  level!: string;

  @IsEnum(NZQF, { message: 'NZQF level must be between 3 and 10.' })
  nzqfLevel!: string;

  @IsArray() @ArrayMinSize(1, { message: 'Choose at least one intake month.' }) @ArrayMaxSize(12)
  @IsInt({ each: true }) @Min(1, { each: true }) @Max(12, { each: true }) @Type(() => Number)
  intakeMonths!: number[];
}

/** The activation toggle. Nothing but the switch — see the controller. */
export class SetOwnProgrammeActiveDto {
  @IsBoolean()
  active!: boolean;
}
