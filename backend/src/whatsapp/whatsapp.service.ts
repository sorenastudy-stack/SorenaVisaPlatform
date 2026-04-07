import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import axios from 'axios';
import { LeadStatus } from '@prisma/client';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  verifyWebhook(mode: string, challenge: string, verifyToken: string): string | null {
    if (mode === 'subscribe' && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  async handleInboundMessage(body: any, headers: any): Promise<void> {
    try {
      // Verify webhook signature (optional for demo)
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field === 'messages') {
            const messages = change.value.messages || [];
            for (const message of messages) {
              await this.processInboundMessage(message);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling inbound WhatsApp message', error);
    }
  }

  private async processInboundMessage(message: any): Promise<void> {
    const phoneNumber = message.from; // Already in E.164 format
    const content = message.text?.body || '';

    // Find existing contact by phone or whatsapp
    let contact = await this.prisma.contact.findFirst({
      where: {
        OR: [
          { phone: phoneNumber },
          { whatsapp: phoneNumber },
        ],
      },
    });

    if (!contact) {
      // Create new contact
      contact = await this.prisma.contact.create({
        data: {
          fullName: `WhatsApp User ${phoneNumber}`,
          whatsapp: phoneNumber,
        },
      });

      // Create new lead
      const lead = await this.prisma.lead.create({
        data: {
          contactId: contact.id,
          sourceChannel: 'WHATSAPP',
          leadStatus: LeadStatus.NEW,
        },
      });

      // Emit LEAD_CREATED event
      await this.eventsService.emit(
        'LEAD_CREATED',
        'LEAD',
        lead.id,
        lead.id,
        'SYSTEM',
        null,
        { source: 'WHATSAPP', phoneNumber },
      );
    }

    // Find or create conversation
    let conversation = await this.prisma.whatsAppConversation.findFirst({
      where: { phoneNumber },
    });

    if (!conversation) {
      conversation = await this.prisma.whatsAppConversation.create({
        data: {
          contactId: contact.id,
          phoneNumber,
          status: 'NEW',
        },
      });
    }

    // Store inbound message
    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        content,
        messageType: message.type || 'text',
        waMessageId: message.id,
        timestamp: new Date(parseInt(message.timestamp) * 1000),
      },
    });

    // Update conversation last message time
    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  async sendMessage(to: string, message: string): Promise<any> {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        },
      );

      // Find conversation
      let conversation = await this.prisma.whatsAppConversation.findFirst({
        where: { phoneNumber: to },
      });

      if (!conversation) {
        // Create conversation if not exists
        conversation = await this.prisma.whatsAppConversation.create({
          data: { phoneNumber: to },
        });
      }

      // Store outbound message
      await this.prisma.whatsAppMessage.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          content: message,
          waMessageId: response.data.messages?.[0]?.id,
          status: 'SENT',
        },
      });

      return response.data;
    } catch (error) {
      this.logger.error('Error sending WhatsApp message', error);
      throw error;
    }
  }
}