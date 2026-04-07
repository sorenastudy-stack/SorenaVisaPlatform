import { Controller, Get, Post, Body, Query, Headers } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    return this.whatsappService.verifyWebhook(mode, challenge, verifyToken);
  }

  @Post('webhook')
  handleWebhook(@Body() body: any, @Headers() headers: any) {
    return this.whatsappService.handleInboundMessage(body, headers);
  }

  @Post('send')
  sendMessage(@Body() body: { to: string; message: string }) {
    return this.whatsappService.sendMessage(body.to, body.message);
  }
}