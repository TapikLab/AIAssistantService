import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@common/auth/authenticated-request.interface';
import { PersonalChatService } from './personal-chat.service';
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto';

@UseGuards(JwtAuthGuard)
@Controller('assistant/chat')
export class PersonalChatController {
  constructor(private readonly personalChatService: PersonalChatService) {}

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('message')
  sendMessage(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendAssistantMessageDto,
  ) {
    return this.personalChatService.sendMessage(req.user.userId, dto);
  }

  @Get('history')
  getHistory(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
  ) {
    return this.personalChatService.getHistory(req.user.userId, cursor);
  }
}
