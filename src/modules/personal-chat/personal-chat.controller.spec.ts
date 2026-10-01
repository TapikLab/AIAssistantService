import { Test, TestingModule } from '@nestjs/testing';
import { PersonalChatController } from './personal-chat.controller';
import { PersonalChatService } from './personal-chat.service';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';

describe('PersonalChatController', () => {
  let controller: PersonalChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PersonalChatController],
      providers: [
        {
          provide: PersonalChatService,
          useValue: { sendMessage: jest.fn(), getHistory: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<PersonalChatController>(PersonalChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
