import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import {
  SupplierInvoiceError,
  SupplierInvoiceService,
  TaxCodeError,
  TaxCodeService,
  UnmappedAccountError,
  type InvoiceableLine,
  type InvoicePreview,
  type SupplierInvoiceInput,
  type SupplierInvoiceListPage,
  type SupplierInvoiceResult,
  type TaxCodeSummary,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import {
  CreateTaxCodeDto,
  InvoiceableQueryDto,
  SupplierInvoiceDto,
  SupplierInvoicesQueryDto,
  TaxCodesQueryDto,
  UpdateTaxCodeDto,
} from "./dto/invoice-dtos.js";

function toInput(dto: SupplierInvoiceDto): SupplierInvoiceInput {
  return {
    supplierId: dto.supplierId,
    supplierInvoiceNumber: dto.supplierInvoiceNumber,
    invoiceDate: new Date(dto.invoiceDate),
    ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    ...(dto.acceptPriceVariance !== undefined ? { acceptPriceVariance: dto.acceptPriceVariance } : {}),
    lines: dto.lines,
  };
}

@Controller("v1")
export class InvoicingController {
  constructor(
    private readonly invoices: SupplierInvoiceService,
    private readonly taxCodes: TaxCodeService,
  ) {}

  // ── Supplier invoices ───────────────────────────────────────────────────────

  @Get("supplier-invoices")
  @RequirePermission("supplier_invoice", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: SupplierInvoicesQueryDto): Promise<SupplierInvoiceListPage> {
    return this.invoices.list(actor.companyId, query);
  }

  // Order lines with goods received and not yet invoiced — what an invoice can be matched to.
  @Get("supplier-invoices/invoiceable")
  @RequirePermission("supplier_invoice", "create")
  invoiceable(@CurrentUser() actor: CurrentUserPayload, @Query() query: InvoiceableQueryDto): Promise<InvoiceableLine[]> {
    return this.invoices.listInvoiceable(actor.companyId, query.supplierId);
  }

  // Runs the match and the arithmetic without posting, so the buyer sees variances before accepting.
  @Post("supplier-invoices/preview")
  @RequirePermission("supplier_invoice", "create")
  preview(@Body() dto: SupplierInvoiceDto, @CurrentUser() actor: CurrentUserPayload): Promise<InvoicePreview> {
    return this.mapInvoiceErrors(this.invoices.preview(toInput(dto), actor));
  }

  @Post("supplier-invoices")
  @RequirePermission("supplier_invoice", "create")
  create(
    @Body() dto: SupplierInvoiceDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SupplierInvoiceResult> {
    return this.mapInvoiceErrors(this.invoices.create(toInput(dto), actor, correlationId, idempotencyKey));
  }

  private async mapInvoiceErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
      if (!(error instanceof SupplierInvoiceError)) throw error;
      // The code and line number let the screen point at the offending line.
      const body = { message: error.message, code: error.code, ...(error.lineNumber !== undefined ? { lineNumber: error.lineNumber } : {}) };
      switch (error.code) {
        case "SUPPLIER_NOT_FOUND":
        case "PO_LINE_NOT_FOUND":
        case "TAX_CODE_NOT_FOUND":
        case "ACCOUNT_NOT_FOUND":
        case "INVOICE_NOT_FOUND":
          throw new NotFoundException(body);
        case "QTY_EXCEEDS_RECEIVED":
        case "PRICE_VARIANCE_NOT_ACCEPTED":
        case "DUPLICATE_INVOICE":
        case "SUPPLIER_MISMATCH":
          throw new ConflictException(body);
        case "EMPTY_INVOICE":
        case "ACCOUNT_NOT_POSTABLE":
        case "NO_OPEN_PERIOD":
        case "ZERO_INVOICE":
          throw new BadRequestException(body);
      }
    }
  }

  // ── Tax codes (settings) ────────────────────────────────────────────────────

  @Get("tax-codes")
  @RequirePermission("tax_code", "read")
  listTaxCodes(@CurrentUser() actor: CurrentUserPayload, @Query() query: TaxCodesQueryDto): Promise<TaxCodeSummary[]> {
    return this.taxCodes.list(actor.companyId, query.includeInactive === "true");
  }

  @Post("tax-codes")
  @RequirePermission("tax_code", "create")
  createTaxCode(
    @Body() dto: CreateTaxCodeDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<TaxCodeSummary> {
    return this.mapTaxErrors(this.taxCodes.create(dto, actor, correlationId));
  }

  // Adds the standard Saudi VAT codes the company does not have yet. Owner-triggered, never automatic.
  @Post("tax-codes/saudi-defaults")
  @RequirePermission("tax_code", "create")
  addSaudiDefaults(@CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<TaxCodeSummary[]> {
    return this.mapTaxErrors(this.taxCodes.addSaudiDefaults(actor, correlationId));
  }

  @Patch("tax-codes/:id")
  @RequirePermission("tax_code", "update")
  updateTaxCode(
    @Param("id") id: string,
    @Body() dto: UpdateTaxCodeDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<TaxCodeSummary> {
    return this.mapTaxErrors(this.taxCodes.update(id, dto, actor, correlationId));
  }

  private async mapTaxErrors<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (!(error instanceof TaxCodeError)) throw error;
      switch (error.code) {
        case "DUPLICATE_CODE":
          throw new ConflictException(error.message);
        case "TAX_CODE_NOT_FOUND":
          throw new NotFoundException(error.message);
        case "INVALID_RATE":
          throw new BadRequestException(error.message);
      }
    }
  }
}
