import { Controller, Get, Post, Body, Query, Headers, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { WhatsappService } from './whatsapp.service';
import { WhatsappSignatureGuard } from './guards/whatsapp-signature.guard';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // Meta's WhatsApp Cloud API verification challenge — a one-time handshake
  // at webhook configuration time, authenticated by WHATSAPP_VERIFY_TOKEN
  // (not HMAC — there is no body on a GET to sign). Low frequency, Meta-
  // initiated; opting out of the global throttler remains the safe default
  // here so a slow config retry never breaks the handshake.
  @SkipThrottle()
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    return this.whatsappService.verifyWebhook(mode, challenge, verifyToken);
  }

  // PR-WHATSAPP-SEC-1: X-Hub-Signature-256 verification (WhatsappSignatureGuard)
  // is the auth for this route — no JWT, matching every other inbound webhook
  // in this codebase. Deliberately still rate-limited (not @SkipThrottle, the
  // convention Stripe/DocuSign webhooks use once signed) per explicit
  // instruction: signature verification proves the caller is Meta, it does not
  // bound how fast Meta (or a compromised/misbehaving sender) can call us.
  @UseGuards(WhatsappSignatureGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
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