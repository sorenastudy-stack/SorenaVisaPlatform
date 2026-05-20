import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ChatbotService } from './chatbot.service';
import { SendMessageDto } from './dto/send-message.dto';
import { RespondToEscalationDto } from './dto/respond-to-escalation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import {
  ChatbotConversationCreateRateLimitGuard,
  ChatbotMessageRateLimitGuard,
  ChatbotEscalationRateLimitGuard,
} from './guards/chatbot-rate-limit.guards';

// PR-DASH-4 — Student-side chatbot routes.
//
// All routes are STUDENT-only and ownership-checked inside the
// service (404 on not-owned to avoid existence leaks — same pattern
// as PR-DASH-2/PR-DASH-3).
@Controller('api/student/chatbot')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Get('conversations')
  list(@Req() req: any, @Query() query: ListConversationsDto) {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
    return this.chatbot.listConversations(req.user.userId, page, pageSize);
  }

  @Post('conversations')
  @UseGuards(ChatbotConversationCreateRateLimitGuard)
  create(@Req() req: any) {
    return this.chatbot.createConversation(req.user.userId);
  }

  @Get('conversations/:id')
  detail(@Req() req: any, @Param('id') id: string) {
    return this.chatbot.getConversation(req.user.userId, id);
  }

  @Post('conversations/:id/messages')
  @UseGuards(ChatbotMessageRateLimitGuard)
  send(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.chatbot.sendMessage(
      req.user.userId,
      id,
      body.content,
      body.locale ?? 'en',
    );
  }

  @Post('conversations/:id/messages/:messageId/escalate')
  @UseGuards(ChatbotEscalationRateLimitGuard)
  escalate(
    @Req() req: any,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: RespondToEscalationDto,
  ) {
    return this.chatbot.respondToEscalation(
      req.user.userId,
      id,
      messageId,
      body.accept,
      body.additionalContext,
    );
  }

  @Post('conversations/:id/archive')
  archive(@Req() req: any, @Param('id') id: string) {
    return this.chatbot.archiveConversation(req.user.userId, id);
  }
}
