import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AcquisitionService } from './acquisition.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateHandoffDto } from './dto/create-handoff.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { Request } from 'express';

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ip.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

@Controller('acquisition')
export class AcquisitionController {
  constructor(private readonly svc: AcquisitionService) {}

  @Post('visitors')
  @HttpCode(HttpStatus.CREATED)
  createVisitor(@Body() dto: CreateVisitorDto, @Req() req: Request) {
    return this.svc.createVisitor(dto, getClientIp(req));
  }

  @Post('events')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @HttpCode(HttpStatus.CREATED)
  createEvent(@Body() dto: CreateEventDto, @Req() req: Request) {
    return this.svc.createEvent(dto, getClientIp(req));
  }

  @Post('leads')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.CREATED)
  createLead(@Body() dto: CreateLeadDto, @Req() req: Request) {
    return this.svc.createLead(dto, getClientIp(req), req.headers['user-agent'] || '');
  }

  @Get('leads/:id')
  @UseGuards(ApiKeyGuard)
  getLead(@Param('id') id: string) {
    return this.svc.getLead(id);
  }

  @Post('handoffs/:id')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  createHandoff(@Param('id') id: string, @Body() dto: CreateHandoffDto) {
    return this.svc.createHandoff(id, dto);
  }

  @Get('handoffs/:id')
  @UseGuards(ApiKeyGuard)
  getHandoff(@Param('id') id: string) {
    return this.svc.getHandoff(id);
  }

  @Get('verify-email')
  verifyEmail(@Query('token') token: string) {
    return this.svc.verifyEmail(token);
  }
}
