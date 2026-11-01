import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { OWNER_TYPES } from "@erp/core";

// A record id: letters, digits, dash and underscore only. UUIDs for almost everything, but a company id is not
// guaranteed to be one (the seeded company is "default-company"), so this is a safe-characters check, not IsUUID.
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Multipart form fields that come with the file. The file itself is read by the upload interceptor, not here.
export class UploadAttachmentDto {
  @IsIn([...OWNER_TYPES])
  ownerType!: string;

  @Matches(RECORD_ID)
  ownerId!: string;
}

// docs/07-API-RULES.md section 6: filters are whitelisted. With both ownerType and ownerId the answer is the
// files of that one record; otherwise it is the company-wide, paged list.
export class AttachmentsQueryDto {
  @IsOptional()
  @IsIn([...OWNER_TYPES])
  ownerType?: string;

  @IsOptional()
  @Matches(RECORD_ID)
  ownerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class AttachmentContentQueryDto {
  @IsOptional()
  @IsIn(["true", "false"])
  download?: "true" | "false";
}
