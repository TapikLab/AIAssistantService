import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AssistantService } from './assistant.service';
import { SuggestReplyDto } from './dto/suggest-reply.dto';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@common/auth/authenticated-request.interface';

@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('suggest-replies')
  async suggestReplies(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SuggestReplyDto,
  ): Promise<string[]> {
    return this.assistantService.suggestReplies(dto, req.user.userId);
  }
}
