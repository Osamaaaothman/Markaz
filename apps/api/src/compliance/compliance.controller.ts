// HTTP surface for the ZATCA compliance pack's admin/back-office operations (docs/zatca/HANDOFF.md
// "Finish Phase 7a"). All the real logic lives in ComplianceAdminService — this file only maps
// HTTP <-> that service, same shape as setup.controller.ts / hr.controller.ts.
import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Query, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import {
  ComplianceAdminService,
  ComplianceError,
  type ComplianceErrorCode,
  type EgsUnitView,
  type InvoiceRecordView,
  type OnboardingStepResult,
  type SellerProfileView,
} from "./compliance-admin.service.js";
import { CreateEgsUnitDto, OnboardingOtpDto, UpdateSellerProfileDto } from "./compliance.dto.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";

const NOT_FOUND_CODES = new Set<ComplianceErrorCode>(["EGS_NOT_FOUND", "INVOICE_RECORD_NOT_FOUND"]);

@Controller("v1/compliance")
export class ComplianceController {
  constructor(private readonly admin: ComplianceAdminService) {}

  // ── overview ────────────────────────────────────────────────────────────────────────────────

  @Get("overview")
  @RequirePermission("compliance", "read")
  overview(@CurrentUser() actor: CurrentUserPayload) {
    return mapErrors(this.admin.overview(actor.companyId));
  }

  // ── seller profile ─────────────────────────────────────────────────────────────────────────

  @Get("seller-profile")
  @RequirePermission("compliance", "read")
  sellerProfile(@CurrentUser() actor: CurrentUserPayload): Promise<SellerProfileView> {
    return mapErrors(this.admin.sellerProfile(actor.companyId));
  }

  @Put("seller-profile")
  @RequirePermission("compliance", "manage")
  updateSellerProfile(@Body() dto: UpdateSellerProfileDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<SellerProfileView> {
    return mapErrors(this.admin.updateSellerProfile(dto, actor, correlationId));
  }

  // ── EGS units ───────────────────────────────────────────────────────────────────────────────

  @Get("egs-units")
  @RequirePermission("compliance", "read")
  listEgsUnits(@CurrentUser() actor: CurrentUserPayload): Promise<readonly EgsUnitView[]> {
    return mapErrors(this.admin.listEgsUnits(actor.companyId));
  }

  @Get("egs-units/:id")
  @RequirePermission("compliance", "read")
  getEgsUnit(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<EgsUnitView> {
    return mapErrors(this.admin.getEgsUnit(actor.companyId, id));
  }

  @Post("egs-units")
  @RequirePermission("compliance", "manage")
  createEgsUnit(@Body() dto: CreateEgsUnitDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<EgsUnitView> {
    return mapErrors(this.admin.createEgsUnit(dto, actor, correlationId));
  }

  // ── onboarding ──────────────────────────────────────────────────────────────────────────────
  // Every step here touches cryptographic material or an OTP — docs/06-COMPLIANCE-PACK-RULES.md
  // §5: "access to key material is a separately audited privilege." Hence `manage`, not `read`,
  // for all four; ComplianceAdminService itself writes the audit row for each attempt.

  @Post("egs-units/:id/onboarding/start")
  @RequirePermission("compliance", "manage")
  startOnboarding(@Param("id") id: string, @Body() dto: OnboardingOtpDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<OnboardingStepResult> {
    return mapErrors(this.admin.startOnboarding(id, dto.otp, actor, correlationId));
  }

  @Post("egs-units/:id/onboarding/compliance-checks")
  @RequirePermission("compliance", "manage")
  runComplianceChecks(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<OnboardingStepResult> {
    return mapErrors(this.admin.runComplianceChecks(id, actor, correlationId));
  }

  @Post("egs-units/:id/onboarding/production-csid")
  @RequirePermission("compliance", "manage")
  requestProductionCsid(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<OnboardingStepResult> {
    return mapErrors(this.admin.requestProductionCsid(id, actor, correlationId));
  }

  @Post("egs-units/:id/onboarding/renew")
  @RequirePermission("compliance", "manage")
  renew(@Param("id") id: string, @Body() dto: OnboardingOtpDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<OnboardingStepResult> {
    return mapErrors(this.admin.renew(id, dto.otp, actor, correlationId));
  }

  // ── invoices ────────────────────────────────────────────────────────────────────────────────

  @Get("invoices/statuses")
  @RequirePermission("compliance", "read")
  async invoiceStatuses(@Query("ids") ids: string | undefined, @CurrentUser() actor: CurrentUserPayload) {
    const list = (ids ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    return mapErrors(this.admin.invoiceStatuses(actor.companyId, list));
  }

  @Get("invoices/:salesInvoiceId")
  @RequirePermission("compliance", "read")
  async invoiceRecord(@Param("salesInvoiceId") salesInvoiceId: string, @CurrentUser() actor: CurrentUserPayload): Promise<InvoiceRecordView> {
    const record = await mapErrors(this.admin.invoiceRecord(actor.companyId, salesInvoiceId));
    if (!record) throw new NotFoundException("This invoice has no ZATCA record yet");
    return record;
  }

  @Get("invoices/:salesInvoiceId/xml")
  @RequirePermission("compliance", "read")
  async invoiceXml(
    @Param("salesInvoiceId") salesInvoiceId: string,
    @Query("kind") kind: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const resolvedKind = kind === "cleared" ? "cleared" : "signed";
    const xml = await mapErrors(this.admin.xml(actor.companyId, salesInvoiceId, resolvedKind));
    res.header("Content-Type", "application/xml");
    res.header("Content-Disposition", `attachment; filename="${salesInvoiceId}-${resolvedKind}.xml"`);
    return xml;
  }

  @Post("invoices/:salesInvoiceId/resubmit")
  @RequirePermission("compliance", "manage")
  resubmit(@Param("salesInvoiceId") salesInvoiceId: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<InvoiceRecordView> {
    return mapErrors(this.admin.resubmit(actor.companyId, salesInvoiceId, actor, correlationId));
  }
}

async function mapErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof ComplianceError)) throw error;
    if (NOT_FOUND_CODES.has(error.code)) throw new NotFoundException({ message: error.message, code: error.code });
    if (error.code === "ENCRYPTION_KEY_MISSING") throw new ServiceUnavailableException({ message: error.message, code: error.code });
    // WRONG_STATUS, SELLER_LOCKED, SELLER_PROFILE_INCOMPLETE, SUBMISSION_NOT_WIRED, EGS_DUPLICATE.
    throw new ConflictException({ message: error.message, code: error.code, details: error.details });
  }
}
