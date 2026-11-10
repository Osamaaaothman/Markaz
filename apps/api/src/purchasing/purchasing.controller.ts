import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  APPROVABLE_SUBJECT_TYPES,
  AlreadyDecidedError,
  ApprovalPolicyError,
  ApprovalPolicyService,
  AttachmentService,
  GoodsReceiptError,
  GoodsReturnError,
  GoodsReturnService,
  PurchaseOrderError,
  PurchaseOrderService,
  PurchaseReceiptError,
  PurchaseReceiptService,
  PurchaseRequestError,
  PurchaseRequestService,
  PurchasingQueueService,
  UnmappedAccountError,
  type ApprovableSubjectType,
  type ApprovalPolicyEntry,
  type IPermissionService,
  type PurchasingQueueCounts,
  type GoodsReturnDetail,
  type GoodsReturnListPage,
  type GoodsReturnResult,
  type PurchaseOrderCreated,
  type PurchaseOrderDetail,
  type PurchaseOrderListPage,
  type PurchaseReceiptResult,
  type PurchaseRequestDetail,
  type PurchaseRequestListPage,
  type PurchaseRequestSummary,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { AuthenticatedOnly } from "../identity/authenticated-only.decorator.js";
import { PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { purchaseOrderToPdfHtml } from "./exports/purchase-order-export.js";
import { goodsReturnToPdfHtml } from "./exports/goods-return-export.js";
import { localizedCompanyName } from "../common/company-name.js";
import {
  CreateGoodsReturnDto,
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  DecidePurchaseOrderDto,
  GoodsReturnsQueryDto,
  PurchaseOrdersQueryDto,
  PurchaseRequestsQueryDto,
  ReceivePurchaseOrderDto,
  RejectPurchaseRequestDto,
  SetApprovalPolicyDto,
} from "./dto/purchasing-dtos.js";

@Controller("v1")
export class PurchasingController {
  constructor(
    private readonly requests: PurchaseRequestService,
    private readonly orders: PurchaseOrderService,
    private readonly receiving: PurchaseReceiptService,
    private readonly goodsReturns: GoodsReturnService,
    private readonly policies: ApprovalPolicyService,
    private readonly queue: PurchasingQueueService,
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
  ) {}

  // What waits on the signed-in user in purchasing, for the badges in the menu. Each number is returned only if the user
  // may act on it: reviewing requests, making orders from accepted requests, approving orders.
  @Get("purchasing/pending-counts")
  @AuthenticatedOnly()
  async pendingCounts(@CurrentUser() actor: CurrentUserPayload): Promise<PurchasingQueueCounts> {
    const [review, orders, approvals] = await Promise.all([
      this.permissions.can(actor.id, "review", "purchase_request"),
      this.permissions.can(actor.id, "create", "purchase_order"),
      this.permissions.can(actor.id, "approve", "purchase_order"),
    ]);
    return this.queue.counts(actor.companyId, { review, orders, approvals });
  }

  // ── Purchase requests ───────────────────────────────────────────────────────

  @Get("purchase-requests")
  @RequirePermission("purchase_request", "read")
  listRequests(@CurrentUser() actor: CurrentUserPayload, @Query() query: PurchaseRequestsQueryDto): Promise<PurchaseRequestListPage> {
    return this.requests.list(actor.companyId, query);
  }

  @Get("purchase-requests/:id")
  @RequirePermission("purchase_request", "read")
  getRequest(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<PurchaseRequestDetail> {
    return this.mapRequestErrors(this.requests.get(actor.companyId, id));
  }

  @Post("purchase-requests")
  @RequirePermission("purchase_request", "create")
  createRequest(
    @Body() dto: CreatePurchaseRequestDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseRequestSummary> {
    return this.mapRequestErrors(
      this.requests.create({ warehouseId: dto.warehouseId, ...(dto.notes !== undefined ? { notes: dto.notes } : {}), lines: dto.lines }, actor, correlationId),
    );
  }

  // The review step: accept a pending request so a buyer can make an order from it.
  @Post("purchase-requests/:id/accept")
  @RequirePermission("purchase_request", "review")
  acceptRequest(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseRequestSummary> {
    return this.mapRequestErrors(this.requests.accept(id, actor, correlationId));
  }

  @Post("purchase-requests/:id/reject")
  @RequirePermission("purchase_request", "reject")
  rejectRequest(
    @Param("id") id: string,
    @Body() dto: RejectPurchaseRequestDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseRequestSummary> {
    return this.mapRequestErrors(this.requests.reject(id, dto.reason, actor, correlationId));
  }

  private async mapRequestErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (!(error instanceof PurchaseRequestError)) throw error;
      switch (error.code) {
        case "REQUEST_NOT_FOUND":
        case "ITEM_NOT_FOUND":
        case "WAREHOUSE_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "NOT_PENDING":
          throw new ConflictException(error.message);
        case "EMPTY_REQUEST":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Purchase orders ─────────────────────────────────────────────────────────

  @Get("purchase-orders")
  @RequirePermission("purchase_order", "read")
  listOrders(@CurrentUser() actor: CurrentUserPayload, @Query() query: PurchaseOrdersQueryDto): Promise<PurchaseOrderListPage> {
    return this.orders.list(actor.companyId, query);
  }

  @Get("purchase-orders/:id")
  @RequirePermission("purchase_order", "read")
  getOrder(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<PurchaseOrderDetail> {
    return this.mapOrderErrors(this.orders.get(actor.companyId, id));
  }

  @Post("purchase-orders")
  @RequirePermission("purchase_order", "create")
  createOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseOrderCreated> {
    return this.mapOrderErrors(
      this.orders.create(
        {
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          orderDate: new Date(dto.orderDate),
          ...(dto.expectedDate !== undefined ? { expectedDate: new Date(dto.expectedDate) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.purchaseRequestId !== undefined ? { purchaseRequestId: dto.purchaseRequestId } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
      ),
    );
  }

  @Post("purchase-orders/:id/approve")
  @RequirePermission("purchase_order", "approve")
  approveOrder(
    @Param("id") id: string,
    @Body() dto: DecidePurchaseOrderDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseOrderCreated> {
    return this.mapOrderErrors(this.orders.decide(id, "APPROVED", actor, correlationId, dto.reason));
  }

  @Post("purchase-orders/:id/reject")
  @RequirePermission("purchase_order", "approve")
  rejectOrder(
    @Param("id") id: string,
    @Body() dto: DecidePurchaseOrderDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseOrderCreated> {
    return this.mapOrderErrors(this.orders.decide(id, "REJECTED", actor, correlationId, dto.reason));
  }

  @Post("purchase-orders/:id/cancel")
  @RequirePermission("purchase_order", "cancel")
  cancelOrder(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<PurchaseOrderCreated> {
    return this.mapOrderErrors(this.orders.cancel(id, actor, correlationId));
  }

  private async mapOrderErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof AlreadyDecidedError) throw new ConflictException(error.message);
      if (!(error instanceof PurchaseOrderError)) throw error;
      switch (error.code) {
        case "ORDER_NOT_FOUND":
        case "SUPPLIER_NOT_FOUND":
        case "WAREHOUSE_NOT_FOUND":
        case "ITEM_NOT_FOUND":
        case "TAX_CODE_NOT_FOUND":
        case "REQUEST_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "REQUEST_NOT_ACCEPTED":
        case "NOT_PENDING_APPROVAL":
        case "NOT_CANCELLABLE":
          throw new ConflictException(error.message);
        case "EMPTY_ORDER":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Receiving against an order (the M4 goods receipt, linked to the order) ──

  @Post("purchase-orders/:id/receive")
  @RequirePermission("goods_receipt", "create")
  receive(
    @Param("id") id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<PurchaseReceiptResult> {
    return this.mapReceiptErrors(
      this.receiving.receive(
        id,
        {
          warehouseId: dto.warehouseId,
          documentDate: new Date(dto.documentDate),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  private async mapReceiptErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (error instanceof GoodsReceiptError) {
        if (error.code === "WAREHOUSE_NOT_FOUND" || error.code === "ITEM_NOT_FOUND") throw new NotFoundException(error.message);
        throw new BadRequestException(error.message);
      }
      if (!(error instanceof PurchaseReceiptError)) throw error;
      switch (error.code) {
        case "ORDER_NOT_FOUND":
        case "LINE_NOT_ON_ORDER":
          throw new NotFoundException(error.message);
        case "ORDER_NOT_RECEIVABLE":
        case "OVER_RECEIPT":
          throw new ConflictException(error.message);
        case "EMPTY_RECEIPT":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Returning goods to the supplier (before the supplier invoice is matched) ─

  @Get("goods-returns")
  @RequirePermission("goods_return", "read")
  listGoodsReturns(@CurrentUser() actor: CurrentUserPayload, @Query() query: GoodsReturnsQueryDto): Promise<GoodsReturnListPage> {
    return this.goodsReturns.list(actor.companyId, query);
  }

  @Get("goods-returns/:id")
  @RequirePermission("goods_return", "read")
  async getGoodsReturn(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<GoodsReturnDetail> {
    const goodsReturn = await this.goodsReturns.get(id, actor.companyId);
    if (!goodsReturn) throw new NotFoundException("Goods return not found");
    return goodsReturn;
  }

  @Post("goods-returns")
  @RequirePermission("goods_return", "create")
  createGoodsReturn(
    @Body() dto: CreateGoodsReturnDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<GoodsReturnResult> {
    return this.mapReturnErrors(
      this.goodsReturns.create(
        {
          purchaseOrderId: dto.purchaseOrderId,
          warehouseId: dto.warehouseId,
          documentDate: new Date(dto.documentDate),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  private async mapReturnErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof GoodsReturnError)) throw error;
      switch (error.code) {
        case "ORDER_NOT_FOUND":
        case "WAREHOUSE_NOT_FOUND":
        case "LINE_NOT_ON_ORDER":
          throw new NotFoundException(error.message);
        case "ORDER_NOT_RETURNABLE":
        case "OVER_RETURN":
        case "INSUFFICIENT_STOCK":
          throw new ConflictException(error.message);
        case "NO_OPEN_PERIOD":
        case "EMPTY_RETURN":
          throw new BadRequestException(error.message);
      }
    }
  }

  // ── Approval policy (settings) ──────────────────────────────────────────────

  @Get("approval-policies")
  @RequirePermission("approval_policy", "read")
  listPolicies(@CurrentUser() actor: CurrentUserPayload): Promise<ApprovalPolicyEntry[]> {
    return this.policies.list(actor.companyId);
  }

  @Put("approval-policies/:subjectType")
  @RequirePermission("approval_policy", "update")
  async setPolicy(
    @Param("subjectType") subjectType: string,
    @Body() dto: SetApprovalPolicyDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<ApprovalPolicyEntry> {
    if (!(APPROVABLE_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
      throw new NotFoundException("Unknown document type");
    }
    try {
      return await this.policies.set(subjectType as ApprovableSubjectType, dto.thresholdAmount, actor, correlationId);
    } catch (error) {
      if (error instanceof ApprovalPolicyError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  // ── PDF exports ─────────────────────────────────────────────────────────────

  @Get("purchase-orders/:id/pdf")
  @RequirePermission("purchase_order", "read")
  async purchaseOrderPdf(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Query("lang") lang?: string,
  ): Promise<void> {
    const language: SupportedDocumentLanguage = (SUPPORTED_DOCUMENT_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as SupportedDocumentLanguage) : "en";
    let order: PurchaseOrderDetail;
    try {
      order = await this.orders.get(actor.companyId, id);
    } catch {
      throw new NotFoundException("Purchase order not found");
    }
    const rawPo = await this.prisma.purchaseOrder.findUnique({ where: { id }, select: { requestedBy: true } }).catch(() => null);
    const [company, logo, issuer] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { name: true, nameAr: true, vatNumber: true, crNumber: true, buildingNumber: true, additionalNumber: true, streetName: true, additionalStreetName: true, district: true, city: true, postalCode: true, phone: true } }),
      this.attachments.getCompanyLogo(actor.companyId).catch(() => null),
      rawPo?.requestedBy ? this.prisma.user.findUnique({ where: { id: rawPo.requestedBy }, select: { email: true } }).catch(() => null) : Promise.resolve(null),
    ]);
    const logoDataUri = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : undefined;
    const sep = language === "ar" ? "، " : ", ";
    const building = [company.buildingNumber, company.additionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
    const sellerAddress = [building, company.streetName, company.additionalStreetName, company.district, company.city, company.postalCode].filter(Boolean).join(sep).trim() || null;
    const pdf = await renderHtmlToPdf(await purchaseOrderToPdfHtml({ order, language, companyName: localizedCompanyName(company, language), logoDataUri, sellerVatNumber: company.vatNumber, sellerCrNumber: company.crNumber, sellerAddress, sellerPhone: company.phone, issuedBy: issuer?.email ?? null, issuedAt: order.createdAt }));
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `attachment; filename="${order.number}.pdf"`);
    res.send(pdf);
  }

  @Get("goods-returns/:id/pdf")
  @RequirePermission("goods_return", "read")
  async goodsReturnPdf(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Query("lang") lang?: string,
  ): Promise<void> {
    const language: SupportedDocumentLanguage = (SUPPORTED_DOCUMENT_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as SupportedDocumentLanguage) : "en";
    const gr = await this.goodsReturns.get(id, actor.companyId);
    if (!gr) throw new NotFoundException("Goods return not found");
    const [company, logo, raw] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { name: true, nameAr: true, vatNumber: true, crNumber: true, buildingNumber: true, additionalNumber: true, streetName: true, additionalStreetName: true, district: true, city: true, postalCode: true, phone: true } }),
      this.attachments.getCompanyLogo(actor.companyId).catch(() => null),
      this.prisma.goodsReturn.findUnique({ where: { id }, select: { actorId: true, createdAt: true } }).catch(() => null),
    ]);
    const logoDataUri = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : undefined;
    const sep = language === "ar" ? "، " : ", ";
    const building = [company.buildingNumber, company.additionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
    const sellerAddress = [building, company.streetName, company.additionalStreetName, company.district, company.city, company.postalCode].filter(Boolean).join(sep).trim() || null;
    const issuer = raw?.actorId ? await this.prisma.user.findUnique({ where: { id: raw.actorId }, select: { email: true } }).catch(() => null) : null;
    const pdf = await renderHtmlToPdf(await goodsReturnToPdfHtml({ gr, language, companyName: localizedCompanyName(company, language), logoDataUri, sellerVatNumber: company.vatNumber, sellerCrNumber: company.crNumber, sellerAddress, sellerPhone: company.phone, issuedBy: issuer?.email ?? null, issuedAt: raw?.createdAt.toISOString() ?? null }));
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `attachment; filename="${gr.number}.pdf"`);
    res.send(pdf);
  }
}
