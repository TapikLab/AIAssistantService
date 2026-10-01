import { Type } from "class-transformer";
import {
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUrl,
    IsUUID,
    Length,
    Min,
    ValidateNested,
} from "class-validator";

export enum AttachmentType {
    IMAGE = "IMAGE",
    DOCUMENT = "DOCUMENT",
    AUDIO = "AUDIO",
    VIDEO = "VIDEO",
}

export class AttachmentDto {
    @IsEnum(AttachmentType)
    type!: AttachmentType;

    @IsUrl()
    url!: string;

    @IsString()
    mimeType!: string;

    @IsInt()
    @Min(0)
    sizeBytes!: number;
}

export class SendAssistantMessageDto {
    @IsString()
    @Length(1, 4000)
    content!: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AttachmentDto)
    attachments?: AttachmentDto[];

    // Идемпотентность повторной отправки одного и того же сообщения с клиента
    // (retry после потери ответа) — см. @@unique([userId, clientMessageId]).
    @IsOptional()
    @IsUUID()
    clientMessageId?: string;
}
