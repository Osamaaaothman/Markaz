import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

export class PageContextDto {
  @IsString()
  @MaxLength(200)
  route!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @IsIn(["ask", "review", "auto"])
  mode!: "ask" | "review" | "auto";

  @IsIn(["ar", "en"])
  locale!: "ar" | "en";

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  page?: PageContextDto;
}

export class DecideDto {
  // { "c1": "approve", "c2": "reject" } — validated per value in the controller.
  @IsObject()
  decisions!: Record<string, string>;

  // { "c2": { "basicSalary": "3500.00" } } — every value is validated again by the tool's schema.
  @IsOptional()
  @IsObject()
  edits?: Record<string, Record<string, unknown>>;

  @IsIn(["ar", "en"])
  locale!: "ar" | "en";
}

export class ReviseItemDto {
  // The whole corrected argument object of one waiting card; the tool's own schema validates it.
  @IsObject()
  args!: Record<string, unknown>;

  @IsIn(["ar", "en"])
  locale!: "ar" | "en";
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class AiSettingsDto {
  @IsIn(["google", "anthropic", "openai", "openai-compatible", "ollama"])
  provider!: "google" | "anthropic" | "openai" | "openai-compatible" | "ollama";

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string | null;

  // Write-only. Omitted = keep the stored key; "" = remove it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string | null;

  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  autoModeEnabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  monthlyTokenLimit?: number | null;

  @IsInt()
  @Min(0)
  version!: number;
}

export class CreateAccessTokenDto {
  // A label so the user can tell their tokens apart ("Claude Desktop on my laptop").
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}
