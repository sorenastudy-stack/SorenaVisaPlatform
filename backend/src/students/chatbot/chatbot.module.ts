import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { AnthropicClient } from './anthropic.client';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { TicketsModule } from '../tickets/tickets.module';

// PR-DASH-4 — Chatbot module.
//
// Imports TicketsModule so the escalation accept path can call
// TicketsService.createTicket() — that's the Pattern 1 escalation
// pathway from chat → support ticket. Reuses Prisma + Crypto +
// Config like every other module in this project.
@Module({
  imports:   [PrismaModule, CryptoModule, ConfigModule, TicketsModule],
  controllers: [ChatbotController],
  providers: [ChatbotService, AnthropicClient],
  exports:   [ChatbotService],
})
export class ChatbotModule {}
