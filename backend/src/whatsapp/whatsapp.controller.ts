import { Controller, Get, Post, Body, Query, Headers } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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

  @Post('send')
  sendMessage(@Body() body: { to: string; message: string }) {
    return this.whatsappService.sendMessage(body.to, body.message);
  }
}