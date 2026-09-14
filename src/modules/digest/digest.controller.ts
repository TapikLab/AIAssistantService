import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@common/auth/authenticated-request.interface';
import { DigestService } from './digest.service';

@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class DigestController {
  constructor(private readonly digestService: DigestService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('digest')
  async getDigest(@Req() req: AuthenticatedRequest) {
    return this.digestService.getDigest(req.user.userId);
  }
}
