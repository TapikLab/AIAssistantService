import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetAutoReplyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customInstructions?: string;
}
