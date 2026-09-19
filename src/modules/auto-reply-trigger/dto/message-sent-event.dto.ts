import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class MessageSentEventDto {
  @IsString()
  chatId!: string;

  @IsString()
  senderId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  recipientIds!: string[];

  @IsOptional()
  @IsBoolean()
  viaAssistant?: boolean;
}
