import { Controller, Post, Get, Body } from '@nestjs/common';
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

  @Get('health')
  getHealth() {
    return { status: 'ok' };
  }
}