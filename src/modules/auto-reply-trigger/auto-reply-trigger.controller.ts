import { Controller, UsePipes, ValidationPipe } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AutoReplyGeneratorService } from './auto-reply-generator.service';
import { MessageSentEventDto } from './dto/message-sent-event.dto';

@Controller()
export class AutoReplyTriggerController {
  constructor(private readonly generator: AutoReplyGeneratorService) {}

  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @EventPattern('message.sent')
  async handleMessageSent(@Payload() event: MessageSentEventDto) {
    await this.generator.handleMessageSent(event);
  }
}
