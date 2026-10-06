import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Query } from "@nestjs/common";
import {
  APPROVABLE_SUBJECT_TYPES,
  AlreadyDecidedError,
  ApprovalPolicyError,
  ApprovalPolicyService,
  GoodsReceiptError,
  PurchaseOrderError,
  PurchaseOrderService,
  PurchaseReceiptError,
  PurchaseReceiptService,
  PurchaseRequestError,
  PurchaseRequestService,
  UnmappedAccountError,
  type ApprovableSubjectType,
  type ApprovalPolicyEntry,
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
import { RequirePermission } from "../identity/require-permission.decorator.js";
import {
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  DecidePurchaseOrderDto,
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
    private readonly policies: ApprovalPolicyService,
  ) {}

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
      this.requests.create({ ...(dto.notes !== undefined ? { notes: dto.notes } : {}), lines: dto.lines }, actor, correlationId),
    );
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
        case "ITEM_NOT_FOUND":
        case "REQUEST_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "REQUEST_NOT_PENDING":
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
}
