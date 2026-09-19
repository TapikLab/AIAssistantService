import { Test, TestingModule } from '@nestjs/testing';
import { AutoReplyTriggerController } from './auto-reply-trigger.controller';
import { AutoReplyGeneratorService } from './auto-reply-generator.service';
describe('AutoReplyTriggerController', () => {
  let controller: AutoReplyTriggerController;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutoReplyTriggerController],
      providers: [
        {
          provide: AutoReplyGeneratorService,
          useValue: { handleMessageSent: jest.fn() },
        },
      ],
    }).compile();
    controller = module.get<AutoReplyTriggerController>(
      AutoReplyTriggerController,
    );
  });
  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
