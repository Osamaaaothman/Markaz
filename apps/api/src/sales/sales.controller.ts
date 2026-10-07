import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import {
  QuotationService,
  SalesError,
  SalesInvoiceService,
  SalesOrderService,
  UnmappedAccountError,
  type QuotationDetail,
  type QuotationListPage,
  type QuotationSummary,
  type SalesInvoiceDetail,
  type SalesInvoiceListPage,
  type SalesInvoiceResult,
  type SalesOrderCreated,
  type SalesOrderDetail,
  type SalesOrderListPage,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import {
  ConvertQuotationDto,
  CreateCreditNoteDto,
  CreateQuotationDto,
  CreateSalesInvoiceDto,
  CreateSalesOrderDto,
  QuotationsQueryDto,
  SalesInvoicesQueryDto,
  SalesOrdersQueryDto,
} from "./dto/sales-dtos.js";

// Maps a sales rule that failed to an HTTP status. The body carries the rule's own code (and the
// line it is about) so the screen can say exactly what went wrong; the error filter passes it through.
async function mapSalesErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
    if (!(error instanceof SalesError)) throw error;
    const body = { message: error.message, code: error.code, ...(error.lineNumber !== undefined ? { lineNumber: error.lineNumber } : {}) };
    switch (error.code) {
      case "NOT_FOUND":
      case "CUSTOMER_NOT_FOUND":
      case "ITEM_NOT_FOUND":
      case "TAX_CODE_NOT_FOUND":
      case "WAREHOUSE_NOT_FOUND":
      case "ORDER_LINE_NOT_FOUND":
      case "ACCOUNT_NOT_FOUND":
        throw new NotFoundException(body);
      case "INVALID_STATE":
      case "INSUFFICIENT_STOCK":
      case "OVER_INVOICED":
      case "CUSTOMER_MISMATCH":
      case "CREDIT_EXCEEDS_INVOICE":
      case "NOT_AN_INVOICE":
        throw new ConflictException(body);
      default:
        throw new BadRequestException(body);
    }
  }
}

@Controller("v1")
export class SalesController {
  constructor(
    private readonly quotations: QuotationService,
    private readonly orders: SalesOrderService,
    private readonly invoices: SalesInvoiceService,
  ) {}

  // ── Quotations ──────────────────────────────────────────────────────────────

  @Get("quotations")
  @RequirePermission("quotation", "read")
  listQuotations(@CurrentUser() actor: CurrentUserPayload, @Query() query: QuotationsQueryDto): Promise<QuotationListPage> {
    return this.quotations.list(actor.companyId, query);
  }

  @Get("quotations/:id")
  @RequirePermission("quotation", "read")
  getQuotation(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<QuotationDetail> {
    return mapSalesErrors(this.quotations.get(actor.companyId, id));
  }

  @Post("quotations")
  @RequirePermission("quotation", "create")
  createQuotation(@Body() dto: CreateQuotationDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<QuotationSummary> {
    return mapSalesErrors(
      this.quotations.create(
        {
          customerId: dto.customerId,
          quotationDate: new Date(dto.quotationDate),
          ...(dto.validUntil !== undefined ? { validUntil: new Date(dto.validUntil) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
      ),
    );
  }

  @Post("quotations/:id/convert")
  @RequirePermission("sales_order", "create")
  convertQuotation(
    @Param("id") id: string,
    @Body() dto: ConvertQuotationDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<SalesOrderCreated> {
    return mapSalesErrors(this.orders.createFromQuotation(id, dto.orderDate ? new Date(dto.orderDate) : new Date(), actor, correlationId));
  }

  @Post("quotations/:id/reject")
  @RequirePermission("quotation", "update")
  rejectQuotation(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<QuotationSummary> {
    return mapSalesErrors(this.quotations.reject(id, actor, correlationId));
  }

  @Post("quotations/:id/cancel")
  @RequirePermission("quotation", "update")
  cancelQuotation(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<QuotationSummary> {
    return mapSalesErrors(this.quotations.cancel(id, actor, correlationId));
  }

  // ── Sales orders ────────────────────────────────────────────────────────────

  @Get("sales-orders")
  @RequirePermission("sales_order", "read")
  listOrders(@CurrentUser() actor: CurrentUserPayload, @Query() query: SalesOrdersQueryDto): Promise<SalesOrderListPage> {
    return this.orders.list(actor.companyId, query);
  }

  @Get("sales-orders/:id")
  @RequirePermission("sales_order", "read")
  getOrder(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<SalesOrderDetail> {
    return mapSalesErrors(this.orders.get(actor.companyId, id));
  }

  @Post("sales-orders")
  @RequirePermission("sales_order", "create")
  createOrder(@Body() dto: CreateSalesOrderDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<SalesOrderCreated> {
    return mapSalesErrors(
      this.orders.create(
        { customerId: dto.customerId, orderDate: new Date(dto.orderDate), ...(dto.notes !== undefined ? { notes: dto.notes } : {}), lines: dto.lines },
        actor,
        correlationId,
      ),
    );
  }

  @Post("sales-orders/:id/cancel")
  @RequirePermission("sales_order", "cancel")
  cancelOrder(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<SalesOrderCreated> {
    return mapSalesErrors(this.orders.cancel(id, actor, correlationId));
  }

  // ── Invoices and credit notes ───────────────────────────────────────────────

  @Get("sales-invoices")
  @RequirePermission("sales_invoice", "read")
  listInvoices(@CurrentUser() actor: CurrentUserPayload, @Query() query: SalesInvoicesQueryDto): Promise<SalesInvoiceListPage> {
    return this.invoices.list(actor.companyId, query);
  }

  @Get("sales-invoices/:id")
  @RequirePermission("sales_invoice", "read")
  getInvoice(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<SalesInvoiceDetail> {
    return mapSalesErrors(this.invoices.get(actor.companyId, id));
  }

  @Post("sales-invoices")
  @RequirePermission("sales_invoice", "create")
  createInvoice(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    return mapSalesErrors(
      this.invoices.createInvoice(
        {
          customerId: dto.customerId,
          invoiceDate: new Date(dto.invoiceDate),
          ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  @Post("sales-invoices/:id/credit-notes")
  @RequirePermission("credit_note", "create")
  createCreditNote(
    @Param("id") id: string,
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    return mapSalesErrors(
      this.invoices.createCreditNote(
        { originalInvoiceId: id, creditDate: new Date(dto.creditDate), ...(dto.notes !== undefined ? { notes: dto.notes } : {}), lines: dto.lines },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }
}
