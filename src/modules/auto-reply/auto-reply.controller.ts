import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@common/auth/authenticated-request.interface';
import { AutoReplySettingService } from './auto-reply-setting.service';
import { SetAutoReplyDto } from './dto/set-auto-reply.dto';

@UseGuards(JwtAuthGuard)
@Controller('assistant/auto-reply')
export class AutoReplyController {
  constructor(private readonly settingService: AutoReplySettingService) {}

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':chatId')
  setEnabled(
    @Req() req: AuthenticatedRequest,
    @Param('chatId') chatId: string,
    @Body() dto: SetAutoReplyDto,
  ) {
    return this.settingService.setEnabled(
      req.user.userId,
      chatId,
      dto.enabled,
      dto.customInstructions,
    );
  }

  @Get(':chatId')
  async getEnabled(
    @Req() req: AuthenticatedRequest,
    @Param('chatId') chatId: string,
  ) {
    const { enabled, customInstructions } =
      await this.settingService.getSettings(req.user.userId, chatId);
    return { chatId, enabled, customInstructions };
  }
}
