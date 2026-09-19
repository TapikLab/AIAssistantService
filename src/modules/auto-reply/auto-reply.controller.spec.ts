import { Test, TestingModule } from '@nestjs/testing';
import { AutoReplyController } from './auto-reply.controller';
import { AutoReplySettingService } from './auto-reply-setting.service';
import { JwtAuthGuard } from '@common/auth/jwt-auth.guard';
describe('AutoReplyController', () => {
  let controller: AutoReplyController;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutoReplyController],
      providers: [
        {
          provide: AutoReplySettingService,
          useValue: { setEnabled: jest.fn(), isEnabled: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<AutoReplyController>(AutoReplyController);
  });
  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
