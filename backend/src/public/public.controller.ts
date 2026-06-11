import { Controller, Post, Get, Body } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('test')
  getTest() {
    return { status: 'test-2026-04-13-0810' };
  }

  @Post('intake')
  async submitIntake(@Body() body: any) {
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