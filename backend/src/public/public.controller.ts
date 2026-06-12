import {
  Body,
  Controller,
  Get,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicService } from './public.service';
import { SubmitIntakeDto } from './dto/submit-intake.dto';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('test')
  getTest() {
    return { status: 'test-2026-04-13-0810' };
  }

  // PR-AUDIT-4 — route-level ValidationPipe override. Global pipe
  // (main.ts) sets forbidNonWhitelisted:true, which would 400 any
  // unknown property and risk rejecting live lead traffic from
  // Wix forms / marketing pages that send extra envelope fields
  // (UTM params, formId, submittedAt, etc.). For an unauth
  // lead-capture endpoint, dropping a real lead is worse than
  // accepting unknown extras. We still validate known fields
  // strictly (types, length caps) and whitelist:true drops the
  // unknowns before they reach the service.
  @Post('intake')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async submitIntake(@Body() body: SubmitIntakeDto) {
    return this.publicService.submitIntakeForm(body);
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