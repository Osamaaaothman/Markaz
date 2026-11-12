import {
  Body,
  ConflictException,
  Controller,
  Module,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { MasterDataImportError, MasterDataImportService, type ImportKind } from "@erp/core";
import { Prisma } from "@erp/db";
import { PrismaService } from "../prisma/prisma.service.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";

export class ImportRowDto {
  @IsInt() @Min(2) @Max(100000) rowNumber!: number;
  @IsObject() values!: Record<string, unknown>;
}
export class ImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}
@Controller("v1")
class ImportsController {
  constructor(private readonly imports: MasterDataImportService) {}
  @Post("items/import/preview")
  @RequirePermission("item", "create")
  previewItems(@Body() dto: ImportDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.imports.preview(actor.companyId, "items", dto.rows);
  }
  @Post("parties/import/preview")
  @RequirePermission("party", "create")
  previewParties(@Body() dto: ImportDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.imports.preview(actor.companyId, "parties", dto.rows);
  }
  @Post("items/import/commit")
  @RequirePermission("item", "create")
  commitItems(
    @Body() dto: ImportDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ) {
    return this.commit("items", dto, actor, correlationId);
  }
  @Post("parties/import/commit")
  @RequirePermission("party", "create")
  commitParties(
    @Body() dto: ImportDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ) {
    return this.commit("parties", dto, actor, correlationId);
  }
  private async commit(
    kind: ImportKind,
    dto: ImportDto,
    actor: CurrentUserPayload,
    correlationId: string,
  ) {
    try {
      return await this.imports.commit(kind, dto.rows, actor, correlationId);
    } catch (error) {
      if (error instanceof MasterDataImportError)
        throw new UnprocessableEntityException({ code: "IMPORT_INVALID", rows: error.rows });
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code)
      )
        throw new ConflictException({ code: "IMPORT_CONFLICT" });
      throw error;
    }
  }
}
@Module({
  controllers: [ImportsController],
  providers: [
    {
      provide: MasterDataImportService,
      useFactory: (prisma: PrismaService) => new MasterDataImportService(prisma),
      inject: [PrismaService],
    },
  ],
})
export class ImportsModule {}
