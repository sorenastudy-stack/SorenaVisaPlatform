import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicService } from './public.service';
import { SubmitIntakeDto } from './dto/submit-intake.dto';

// PR-AUDIT-4 (fix-2) — belt-and-suspenders strip list. Drives the
// explicit key-pick that runs AFTER validate() so we don't depend
// on class-validator's whitelist behaviour mutating the dto
// in-place (version-specific in 0.14, may change in 0.15+).
//
// `satisfies Record<keyof SubmitIntakeDto, true>` enforces TWO
// invariants at compile time:
//   1. Every key here is a real SubmitIntakeDto field (typo → TS error)
//   2. EVERY SubmitIntakeDto field is present here (missing key →
//      TS error, so adding a new DTO field forces an update here
//      instead of silently stripping it at runtime)
// We then iterate Object.keys(...) to do the actual pick.
const KNOWN_INTAKE_FIELDS = {
  fullName: true,
  email: true,
  destination: true,
  preferredLevel: true,
  phone: true,
  whatsapp: true,
  nationality: true,
  preferredLanguage: true,
  highestQualification: true,
  fieldOfStudy: true,
  englishTestType: true,
  englishOverallScore: true,
  financialLevel: true,
  estimatedBudgetNZD: true,
  visaRejectionCount: true,
  studyIntent: true,
  preferredStartDate: true,
  englishTestSpecify: true,
  gpa: true,
  preferredField: true,
  englishComponentScores: true,
} as const satisfies Record<keyof SubmitIntakeDto, true>;

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('test')
  getTest() {
    return { status: 'test-2026-04-13-0810' };
  }

  // PR-AUDIT-4 (fix-2) — TEST 2 in the post-deploy verification
  // (Wix-style payload with utm_source / formId / submittedAt)
  // 400'd because the prior route-level @UsePipes attempt did not
  // override the global ValidationPipe. NestJS pipes are
  // cumulative, not replacing — the global pipe (main.ts) with
  // forbidNonWhitelisted:true ran first and rejected the unknown
  // properties before the route-level relaxed pipe ever executed.
  //
  // Fix: accept @Body() body: any so the global pipe skips this
  // route entirely. ValidationPipe.toValidate() returns false for
  // the primitive `Object` metatype that `any` compiles to under
  // emitDecoratorMetadata, so the body passes through untouched
  // with UTM extras intact. We then run validation manually with
  // the loose-field config the route actually needs:
  //   - plainToInstance constructs the DTO instance with implicit
  //     numeric coercion ("8.0" → 8)
  //   - validate({whitelist:true}) strips unknown keys IN-PLACE
  //     (class-validator 0.14 behaviour) so the service only
  //     sees declared fields
  //   - forbidNonWhitelisted:false means the strip is silent —
  //     no 400 for utm_source / formId / submittedAt
  //
  // Net effect: Wix lead traffic accepted, known fields are
  // length-capped + type-checked, unknowns dropped before
  // reaching the service.
  @Post('intake')
  async submitIntake(@Body() body: any) {
    const dto = plainToInstance(SubmitIntakeDto, body, {
      enableImplicitConversion: true,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errors.length) {
      const messages = errors.flatMap((e) =>
        e.constraints ? Object.values(e.constraints) : [],
      );
      throw new BadRequestException(
        messages.length ? messages : 'Invalid request body',
      );
    }
    // Explicit pick — do not trust class-validator's whitelist to
    // mutate `dto` in place. Build a fresh payload containing
    // ONLY the keys declared in KNOWN_INTAKE_FIELDS (compile-time
    // checked against keyof SubmitIntakeDto). Any UTM/envelope
    // field the caller sent that survived into `dto` is dropped
    // here regardless of class-validator version behaviour.
    // Builder is typed as Record<string, unknown> so the indexed
    // assignment is well-typed; the final cast at the call site
    // is sound because validate() guarantees fullName is set.
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(
      KNOWN_INTAKE_FIELDS,
    ) as (keyof SubmitIntakeDto)[]) {
      const value = dto[key];
      if (value !== undefined) {
        clean[key] = value;
      }
    }
    return this.publicService.submitIntakeForm(
      clean as unknown as SubmitIntakeDto,
    );
  }

  // Uptime probes (Railway healthcheck, monitoring) hit this
  // constantly; the global 60/min limit would 429 them on a hot
  // deploy. Skip throttling — the endpoint is read-only and
  // returns a fixed shape.
  @SkipThrottle()
  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('programmes')
  listProgrammes() {
    return this.publicService.listProgrammes();
  }
}