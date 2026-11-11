import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
} from "@nestjs/common";
import { IsInt, IsObject, IsString, MaxLength, Min } from "class-validator";
import { DocumentDraftError, DocumentDraftService } from "@erp/core";
import type { Prisma } from "@erp/db";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { AuthenticatedOnly } from "../identity/authenticated-only.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";

class VersionDto {
  @IsInt() @Min(0) version!: number;
}
class SaveDraftDto extends VersionDto {
  @IsString() @MaxLength(40) kind!: string;
  @IsObject() payload!: Prisma.InputJsonObject;
}
async function mapError<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof DocumentDraftError)) throw error;
    const body = { code: error.code, message: error.code };
    if (error.code === "DRAFT_CONFLICT") throw new ConflictException(body);
    if (error.code === "DRAFT_NOT_FOUND") throw new NotFoundException(body);
    if (error.code === "DRAFT_FORBIDDEN") throw new ForbiddenException(body);
    throw new BadRequestException(body);
  }
}
@Controller("v1/document-drafts")
export class DocumentDraftsController {
  constructor(private readonly drafts: DocumentDraftService) {}
  @Get() @AuthenticatedOnly() list(@CurrentUser() actor: CurrentUserPayload) {
    return this.drafts.list(actor);
  }
  @Get(":id") @AuthenticatedOnly() get(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return mapError(this.drafts.get(id, actor));
  }
  @Put(":id") @AuthenticatedOnly() save(
    @Param("id") id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new BadRequestException("Invalid draft id");
    return mapError(this.drafts.save(id, dto.kind, dto.version, dto.payload, actor));
  }
  @Delete(":id") @HttpCode(204) @AuthenticatedOnly() discard(
    @Param("id") id: string,
    @Body() dto: VersionDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ) {
    return mapError(this.drafts.discard(id, dto.version, actor, correlationId));
  }
}
