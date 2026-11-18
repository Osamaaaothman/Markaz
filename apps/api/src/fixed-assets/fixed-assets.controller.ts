import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AssetCategoryService,
  DepreciationRunService,
  FixedAssetDisposalService,
  FixedAssetError,
  FixedAssetReportsService,
  FixedAssetService,
  UnmappedAccountError,
  type AssetCategorySummary,
  type DepreciationPreview,
  type DepreciationRunDetail,
  type DepreciationRunSummary,
  type DisposalPreview,
  type DisposalResult,
  type FixedAssetDetail,
  type FixedAssetListPage,
  type FixedAssetSummary,
  type MovementReport,
  type PostedAssetResult,
  type ReconciliationReport,
  type RegisterReport,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { localizedCompanyName } from "../common/company-name.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { CompanyDocumentService } from "../documents/company-document.service.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  AsOfQueryDto,
  CapitalizeAssetDto,
  CreateAssetCategoryDto,
  DepreciationPeriodDto,
  DisposalPreviewQueryDto,
  DisposeAssetDto,
  FixedAssetDetailsDto,
  FixedAssetsQueryDto,
  MovementExportQueryDto,
  MovementQueryDto,
  OpeningAssetDto,
  RegisterExportQueryDto,
  ReverseRunDto,
  TransferAssetDto,
  UpdateAssetCategoryDto,
  UpdateAssetInfoDto,
} from "./dto/fixed-asset-dtos.js";
import { movementToCsv, movementToPdfHtml, registerToCsv, registerToPdfHtml } from "./exports/fixed-asset-exports.js";

const date = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
const todayUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

function detailsInput(dto: FixedAssetDetailsDto) {
  return {
    name: dto.name,
    nameAr: dto.nameAr ?? null,
    description: dto.description ?? null,
    categoryId: dto.categoryId,
    acquisitionDate: date(dto.acquisitionDate),
    inServiceDate: date(dto.inServiceDate),
    acquisitionCost: dto.acquisitionCost,
    residualValue: dto.residualValue ?? null,
    usefulLifeMonths: dto.usefulLifeMonths ?? null,
    supplierPartyId: dto.supplierPartyId || null,
    custodianEmployeeId: dto.custodianEmployeeId || null,
    costCenterId: dto.costCenterId || null,
    location: dto.location ?? null,
    serialNumber: dto.serialNumber ?? null,
    barcode: dto.barcode ?? null,
  };
}

// Fixed assets: categories, the register, monthly depreciation runs, disposals and reports (docs/Planning/fixed-assets-plan.md).
// Every posting endpoint takes an Idempotency-Key (docs/07 §5); every error carries a stable code the web app translates.
@Controller("v1")
export class FixedAssetsController {
  constructor(
    private readonly categories: AssetCategoryService,
    private readonly assets: FixedAssetService,
    private readonly runs: DepreciationRunService,
    private readonly disposals: FixedAssetDisposalService,
    private readonly reports: FixedAssetReportsService,
    private readonly documents: CompanyDocumentService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Categories ──────────────────────────────────────────────────────────────

  @Get("fixed-asset-categories")
  @RequirePermission("fixed_asset_category", "read")
  listCategories(@CurrentUser() actor: CurrentUserPayload, @Query("includeInactive") includeInactive?: string): Promise<AssetCategorySummary[]> {
    return this.categories.list(actor.companyId, includeInactive === "true");
  }

  @Post("fixed-asset-categories")
  @RequirePermission("fixed_asset_category", "manage")
  createCategory(@Body() dto: CreateAssetCategoryDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<AssetCategorySummary> {
    return this.mapErrors(this.categories.create(dto, actor, correlationId));
  }

  @Patch("fixed-asset-categories/:id")
  @RequirePermission("fixed_asset_category", "manage")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateAssetCategoryDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<AssetCategorySummary> {
    return this.mapErrors(this.categories.update(id, dto, actor, correlationId));
  }

  // ── Reports (declared before ":id" routes so "reports" is never read as an id) ─

  @Get("fixed-assets/reports/register")
  @RequirePermission("fixed_asset", "read")
  register(@CurrentUser() actor: CurrentUserPayload, @Query() query: AsOfQueryDto): Promise<RegisterReport> {
    return this.reports.register(actor.companyId, query.asOf ? date(query.asOf) : todayUtc());
  }

  @Get("fixed-assets/reports/register/export")
  @RequirePermission("fixed_asset", "read")
  async exportRegister(@CurrentUser() actor: CurrentUserPayload, @Query() query: RegisterExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    const lang = query.lang ?? "en";
    const report = await this.reports.register(actor.companyId, query.asOf ? date(query.asOf) : todayUtc());
    if (query.format === "csv") return this.send(res, registerToCsv(report, lang), "text/csv; charset=utf-8", "fixed-asset-register.csv");
    const html = await registerToPdfHtml({ report, language: lang, companyName: await this.companyName(actor.companyId, lang) });
    this.send(res, await this.documents.render(actor.companyId, lang, html), "application/pdf", "fixed-asset-register.pdf");
  }

  @Get("fixed-assets/reports/movement")
  @RequirePermission("fixed_asset", "read")
  movement(@CurrentUser() actor: CurrentUserPayload, @Query() query: MovementQueryDto): Promise<MovementReport> {
    return this.reports.movement(actor.companyId, date(query.from), date(query.to));
  }

  @Get("fixed-assets/reports/movement/export")
  @RequirePermission("fixed_asset", "read")
  async exportMovement(@CurrentUser() actor: CurrentUserPayload, @Query() query: MovementExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    const lang = query.lang ?? "en";
    const report = await this.reports.movement(actor.companyId, date(query.from), date(query.to));
    if (query.format === "csv") return this.send(res, movementToCsv(report, lang), "text/csv; charset=utf-8", "fixed-asset-movement.csv");
    const html = await movementToPdfHtml({ report, language: lang, companyName: await this.companyName(actor.companyId, lang) });
    this.send(res, await this.documents.render(actor.companyId, lang, html), "application/pdf", "fixed-asset-movement.pdf");
  }

  @Get("fixed-assets/reports/reconciliation")
  @RequirePermission("fixed_asset", "read")
  reconciliation(@CurrentUser() actor: CurrentUserPayload, @Query() query: AsOfQueryDto): Promise<ReconciliationReport> {
    return this.reports.reconciliation(actor.companyId, query.asOf ? date(query.asOf) : todayUtc());
  }

  // ── Register ────────────────────────────────────────────────────────────────

  @Get("fixed-assets")
  @RequirePermission("fixed_asset", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: FixedAssetsQueryDto): Promise<FixedAssetListPage> {
    return this.assets.list(actor.companyId, query);
  }

  @Post("fixed-assets")
  @RequirePermission("fixed_asset", "create")
  createDraft(@Body() dto: FixedAssetDetailsDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<FixedAssetSummary> {
    return this.mapErrors(this.assets.createDraft(detailsInput(dto), actor, correlationId));
  }

  @Post("fixed-assets/opening")
  @RequirePermission("fixed_asset", "capitalize")
  registerOpening(@Body() dto: OpeningAssetDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @IdempotencyKey() idempotencyKey: string): Promise<PostedAssetResult> {
    return this.mapErrors(
      this.assets.registerOpening({ ...detailsInput(dto), openingAccumulatedDepreciation: dto.openingAccumulatedDepreciation, openingAsOfDate: date(dto.openingAsOfDate) }, actor, correlationId, idempotencyKey),
    );
  }

  @Get("fixed-assets/:id")
  @RequirePermission("fixed_asset", "read")
  async get(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<FixedAssetDetail> {
    const asset = await this.assets.get(id, actor.companyId);
    if (!asset) throw new NotFoundException({ message: "Asset not found", code: "ASSET_NOT_FOUND" });
    return asset;
  }

  @Patch("fixed-assets/:id/draft")
  @RequirePermission("fixed_asset", "create")
  updateDraft(@Param("id") id: string, @Body() dto: FixedAssetDetailsDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<FixedAssetSummary> {
    return this.mapErrors(this.assets.updateDraft(id, detailsInput(dto), actor, correlationId));
  }

  @Patch("fixed-assets/:id")
  @RequirePermission("fixed_asset", "update")
  updateInfo(@Param("id") id: string, @Body() dto: UpdateAssetInfoDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<FixedAssetSummary> {
    return this.mapErrors(this.assets.updateInfo(id, dto, actor, correlationId));
  }

  @Delete("fixed-assets/:id")
  @HttpCode(204)
  @RequirePermission("fixed_asset", "create")
  async deleteDraft(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await this.mapErrors(this.assets.deleteDraft(id, actor, correlationId));
  }

  @Post("fixed-assets/:id/capitalize")
  @RequirePermission("fixed_asset", "capitalize")
  capitalize(@Param("id") id: string, @Body() dto: CapitalizeAssetDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @IdempotencyKey() idempotencyKey: string): Promise<PostedAssetResult> {
    return this.mapErrors(this.assets.capitalize(id, dto.sourceAccountId, actor, correlationId, idempotencyKey));
  }

  @Post("fixed-assets/:id/transfer")
  @RequirePermission("fixed_asset", "update")
  transfer(@Param("id") id: string, @Body() dto: TransferAssetDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<FixedAssetSummary> {
    return this.mapErrors(
      this.assets.transfer(
        id,
        {
          transferDate: date(dto.transferDate),
          ...(dto.location !== undefined ? { location: dto.location } : {}),
          ...(dto.custodianEmployeeId !== undefined ? { custodianEmployeeId: dto.custodianEmployeeId } : {}),
          ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
          reason: dto.reason ?? null,
        },
        actor,
        correlationId,
      ),
    );
  }

  @Get("fixed-assets/:id/disposal-preview")
  @RequirePermission("fixed_asset", "dispose")
  disposalPreview(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @Query() query: DisposalPreviewQueryDto): Promise<DisposalPreview> {
    return this.mapErrors(this.disposals.preview(id, date(query.disposalDate), actor.companyId));
  }

  @Post("fixed-assets/:id/dispose")
  @RequirePermission("fixed_asset", "dispose")
  dispose(@Param("id") id: string, @Body() dto: DisposeAssetDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @IdempotencyKey() idempotencyKey: string): Promise<DisposalResult> {
    return this.mapErrors(this.disposals.dispose(id, { disposalDate: date(dto.disposalDate), disposalType: dto.disposalType, reason: dto.reason }, actor, correlationId, idempotencyKey));
  }

  // ── Depreciation runs ───────────────────────────────────────────────────────

  @Get("depreciation-runs")
  @RequirePermission("depreciation_run", "read")
  listRuns(@CurrentUser() actor: CurrentUserPayload): Promise<DepreciationRunSummary[]> {
    return this.runs.list(actor.companyId);
  }

  @Get("depreciation-runs/preview")
  @RequirePermission("depreciation_run", "post")
  previewRun(@CurrentUser() actor: CurrentUserPayload, @Query() query: DepreciationPeriodDto): Promise<DepreciationPreview> {
    return this.mapErrors(this.runs.preview({ periodYear: query.periodYear, periodMonth: query.periodMonth }, actor.companyId));
  }

  @Get("depreciation-runs/:id")
  @RequirePermission("depreciation_run", "read")
  async getRun(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<DepreciationRunDetail> {
    const run = await this.runs.get(id, actor.companyId);
    if (!run) throw new NotFoundException({ message: "Depreciation run not found", code: "RUN_NOT_FOUND" });
    return run;
  }

  @Post("depreciation-runs")
  @RequirePermission("depreciation_run", "post")
  postRun(@Body() dto: DepreciationPeriodDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @IdempotencyKey() idempotencyKey: string): Promise<DepreciationRunDetail> {
    return this.mapErrors(this.runs.post({ periodYear: dto.periodYear, periodMonth: dto.periodMonth }, actor, correlationId, idempotencyKey));
  }

  @Post("depreciation-runs/:id/reverse")
  @RequirePermission("depreciation_run", "reverse")
  reverseRun(@Param("id") id: string, @Body() dto: ReverseRunDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @IdempotencyKey() idempotencyKey: string): Promise<DepreciationRunDetail> {
    return this.mapErrors(this.runs.reverse(id, dto.reason, actor, correlationId, idempotencyKey));
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private send(res: Response, content: string | Buffer, contentType: string, filename: string): void {
    res.header("Content-Type", contentType);
    res.header("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  }

  private async companyName(companyId: string, lang: "en" | "ar"): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, nameAr: true } });
    return localizedCompanyName(company, lang);
  }

  private async mapErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException({ message: error.message, code: "MAPPING_MISSING", key: error.key });
      if (!(error instanceof FixedAssetError)) throw error;
      const body = { message: error.message, code: error.code };
      switch (error.code) {
        case "CATEGORY_NOT_FOUND":
        case "ASSET_NOT_FOUND":
        case "RUN_NOT_FOUND":
        case "EMPLOYEE_NOT_FOUND":
        case "COST_CENTER_NOT_FOUND":
        case "SUPPLIER_NOT_FOUND":
          throw new NotFoundException(body);
        case "CATEGORY_CODE_TAKEN":
        case "PREFIX_TAKEN":
        case "CATEGORY_IN_USE":
        case "ASSET_NOT_DRAFT":
        case "ASSET_NOT_IN_SERVICE":
        case "RUN_EXISTS":
        case "RUN_BEFORE_LATEST":
        case "RUN_NOT_LATEST":
        case "RUN_ALREADY_REVERSED":
        case "RUN_HAS_DISPOSED_ASSET":
        case "DISPOSAL_BEFORE_DEPRECIATED":
          throw new ConflictException(body);
        default:
          throw new BadRequestException(body);
      }
    }
  }
}
