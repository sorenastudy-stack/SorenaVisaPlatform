import { Controller, Get, Post, Body, Query, Headers, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // Meta's WhatsApp Cloud API verification challenge (one-time at
  // webhook configuration) and message-delivery callbacks. A 429
  // breaks the integration end-to-end; opting out of the global
  // throttler is the safe default.
  @SkipThrottle()
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    return this.whatsappService.verifyWebhook(mode, challenge, verifyToken);
  }

  @SkipThrottle()
  @Post('webhook')
  handleWebhook(@Body() body: any, @Headers() headers: any) {
    return this.whatsappService.handleInboundMessage(body, headers);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'SUPER_ADMIN', 'ADMIN')
  @Post('send')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.whatsappService.sendMessage(dto.to, dto.message);
  }
}