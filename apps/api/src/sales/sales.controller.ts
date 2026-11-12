import { OptionalIdempotencyKey } from "../common/idempotency-key.decorator.js";
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import {
  QuotationService,
  SalesError,
  SalesInvoiceService,
  SalesOrderService,
  UnmappedAccountError,
  type IAuditLogger,
  type QuotationDetail,
  type QuotationListPage,
  type QuotationSummary,
  type SalesInvoiceDetail,
  type SalesInvoiceListPage,
  type SalesInvoiceResult,
  type SalesOrderCreated,
  type SalesOrderDetail,
  type SalesOrderListPage,
  AttachmentService,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { salesInvoiceToPdfHtml } from "./exports/sales-invoice-export.js";
import { quotationToPdfHtml } from "./exports/quotation-export.js";
import { quotationEmailContent } from "./exports/quotation-email-template.js";
import { localizedCompanyName } from "../common/company-name.js";
import { EMAIL_TRANSPORT } from "../notifications/mail.module.js";
import { EmailDeliveryError, redactAddress, type EmailTransport } from "../notifications/email-transport.js";
import {
  ConvertQuotationDto,
  CreateCreditNoteDto,
  CreateDebitNoteDto,
  CreateQuotationDto,
  CreateSalesInvoiceDto,
  CreateSalesOrderDto,
  QuotationEmailPreviewDto,
  QuotationsQueryDto,
  SalesInvoicesQueryDto,
  SalesOrdersQueryDto,
  SendQuotationEmailDto,
} from "./dto/sales-dtos.js";

const COMPANY_DOCUMENT_SELECT = {
  name: true,
  nameAr: true,
  vatNumber: true,
  crNumber: true,
  streetName: true,
  additionalStreetName: true,
  buildingNumber: true,
  additionalNumber: true,
  district: true,
  city: true,
  postalCode: true,
  phone: true,
} as const;

function sellerAddressOf(company: { streetName: string | null; additionalStreetName: string | null; buildingNumber: string | null; additionalNumber: string | null; district: string | null; city: string | null; postalCode: string | null }, language: SupportedDocumentLanguage): string | null {
  const sep = language === "ar" ? "، " : ", ";
  const buildingPart = [company.buildingNumber, company.additionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
  const addressParts = [company.streetName, company.additionalStreetName, company.district, company.city, company.postalCode].filter((p): p is string => Boolean(p?.trim()));
  return [buildingPart, ...addressParts].filter(Boolean).join(sep).trim() || null;
}

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
      case "EGS_UNIT_NOT_FOUND":
        throw new NotFoundException(body);
      case "INVALID_STATE":
      case "INSUFFICIENT_STOCK":
      case "OVER_RETURN":
      case "OVER_INVOICED":
      case "CUSTOMER_MISMATCH":
      case "CREDIT_EXCEEDS_INVOICE":
      case "DEBIT_EXCEEDS_INVOICE":
      case "NOT_AN_INVOICE":
      case "EGS_UNIT_REQUIRED":
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
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
    @Inject(EMAIL_TRANSPORT) private readonly emailTransport: EmailTransport,
    @Inject(AUDIT_LOGGER) private readonly audit: IAuditLogger,
  ) {}

  // Shared by the quotation PDF, preview and send endpoints: the company's own identity as it
  // appears on an outgoing document, and its logo as a data URI (never a remote URL).
  private async loadSellerContext(companyId: string, language: SupportedDocumentLanguage) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: COMPANY_DOCUMENT_SELECT });
    const logo = await this.attachments.getCompanyLogo(companyId).catch(() => null);
    return {
      companyName: localizedCompanyName(company, language),
      logoDataUri: logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : undefined,
      sellerVatNumber: company.vatNumber,
      sellerCrNumber: company.crNumber,
      sellerAddress: sellerAddressOf(company, language),
      sellerPhone: company.phone,
    };
  }

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
  createQuotation(@Body() dto: CreateQuotationDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @OptionalIdempotencyKey() submissionKey?: string): Promise<QuotationSummary> {
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
        submissionKey,
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

  @Get("quotations/:id/pdf")
  @RequirePermission("quotation", "read")
  async quotationPdf(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Query("lang") lang?: string,
  ): Promise<void> {
    const language: SupportedDocumentLanguage = (SUPPORTED_DOCUMENT_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as SupportedDocumentLanguage) : "en";
    const quotation = await mapSalesErrors(this.quotations.get(actor.companyId, id));
    const seller = await this.loadSellerContext(actor.companyId, language);
    const pdf = await renderHtmlToPdf(await quotationToPdfHtml({ quotation, language, ...seller }));
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `attachment; filename="${quotation.number}.pdf"`);
    res.send(pdf);
  }

  // What "Send" will actually mail, rendered up front so the user can check it before anything
  // leaves this server. No attempt is a send — it only reads the quotation and the company profile.
  @Post("quotations/:id/email/preview")
  @RequirePermission("quotation", "read")
  async previewQuotationEmail(
    @Param("id") id: string,
    @Body() dto: QuotationEmailPreviewDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<{ html: string; text: string; subject: string; defaultRecipient: string | null; deliveryConfigured: boolean }> {
    const quotation = await mapSalesErrors(this.quotations.get(actor.companyId, id));
    const seller = await this.loadSellerContext(actor.companyId, dto.language);
    const { html, text, subject } = await quotationEmailContent({ quotation, language: dto.language, companyName: seller.companyName, logoDataUri: seller.logoDataUri, sellerPhone: seller.sellerPhone, sellerAddress: seller.sellerAddress });
    return { html, text, subject, defaultRecipient: quotation.customerEmail, deliveryConfigured: this.emailTransport.configured !== false };
  }

  // A deliberate, human-confirmed send after a preview — sent directly from this request rather
  // than through the notification outbox/job queue (that pattern is for notices tied to a business
  // event in the same DB transaction; this is a one-off action the user just watched and approved).
  @Post("quotations/:id/email/send")
  @RequirePermission("quotation", "create")
  async sendQuotationEmail(
    @Param("id") id: string,
    @Body() dto: SendQuotationEmailDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<{ sentAt: string }> {
    if (this.emailTransport.configured === false) throw new ServiceUnavailableException({ code: "EMAIL_NOT_CONFIGURED" });
    const quotation = await mapSalesErrors(this.quotations.get(actor.companyId, id));
    const seller = await this.loadSellerContext(actor.companyId, dto.language);
    const [{ html, subject, text }, pdf] = await Promise.all([
      quotationEmailContent({ quotation, language: dto.language, companyName: seller.companyName, logoDataUri: seller.logoDataUri, sellerPhone: seller.sellerPhone, sellerAddress: seller.sellerAddress }),
      renderHtmlToPdf(await quotationToPdfHtml({ quotation, language: dto.language, ...seller })),
    ]);
    try {
      await this.emailTransport.send({
      to: dto.to,
      subject,
      html,
      text,
      attachments: [{ filename: `${quotation.number}.pdf`, content: pdf, contentType: "application/pdf" }],
      });
    } catch (error) {
      throw new ServiceUnavailableException({ code: error instanceof EmailDeliveryError ? error.code : "EMAIL_DELIVERY_FAILED" });
    }
    const sentAt = new Date().toISOString();
    await this.audit.log({ actorId: actor.id, action: "quotation.emailed", entityType: "Quotation", entityId: id, after: { to: redactAddress(dto.to), language: dto.language }, correlationId });
    return { sentAt };
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
  createOrder(@Body() dto: CreateSalesOrderDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string, @OptionalIdempotencyKey() submissionKey?: string): Promise<SalesOrderCreated> {
    return mapSalesErrors(
      this.orders.create(
        { customerId: dto.customerId, orderDate: new Date(dto.orderDate), ...(dto.notes !== undefined ? { notes: dto.notes } : {}), lines: dto.lines },
        actor,
        correlationId,
        submissionKey,
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

  // A printable copy of the posted invoice or credit note, in the requested language.
  @Get("sales-invoices/:id/pdf")
  @RequirePermission("sales_invoice", "read")
  async invoicePdf(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Query("lang") lang?: string,
  ): Promise<void> {
    const language: SupportedDocumentLanguage = (SUPPORTED_DOCUMENT_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as SupportedDocumentLanguage) : "en";
    const invoice = await mapSalesErrors(this.invoices.get(actor.companyId, id));
    const issued = await this.prisma.salesInvoice.findFirstOrThrow({ where: { id, companyId: actor.companyId }, select: { actorId: true, createdAt: true } });
    const issuer = await this.prisma.user.findFirst({ where: { id: issued.actorId, companyId: actor.companyId }, select: { email: true } });
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: {
        name: true,
        nameAr: true,
        vatNumber: true,
        crNumber: true,
        streetName: true,
        additionalStreetName: true,
        buildingNumber: true,
        additionalNumber: true,
        district: true,
        city: true,
        postalCode: true,
        phone: true,
      },
    });
    // The company logo, embedded as a data URI so the PDF never fetches anything. No logo is not an error.
    const logo = await this.attachments.getCompanyLogo(actor.companyId).catch(() => null);
    const logoDataUri = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : undefined;
    const addressSeparator = language === "ar" ? "، " : ", ";
    const sellerBuildingPart = [company.buildingNumber, company.additionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
    const sellerAddressParts = [company.streetName, company.additionalStreetName, company.district, company.city, company.postalCode].filter(
      (p): p is string => Boolean(p?.trim()),
    );
    const sellerAddress = [sellerBuildingPart, ...sellerAddressParts].filter(Boolean).join(addressSeparator).trim() || null;
    const pdf = await renderHtmlToPdf(
      await salesInvoiceToPdfHtml({
        invoice,
        issuedBy: issuer?.email ?? null,
        issuedAt: issued.createdAt.toISOString(),
        language,
        companyName: localizedCompanyName(company, language),
        logoDataUri,
        sellerVatNumber: company.vatNumber,
        sellerCrNumber: company.crNumber,
        sellerAddress,
        sellerPhone: company.phone,
      }),
    );
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `attachment; filename="${invoice.number}.pdf"`);
    res.send(pdf);
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
          ...(dto.egsUnitId !== undefined ? { egsUnitId: dto.egsUnitId } : {}),
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
        {
          originalInvoiceId: id,
          creditDate: new Date(dto.creditDate),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.egsUnitId !== undefined ? { egsUnitId: dto.egsUnitId } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }

  @Post("sales-invoices/:id/debit-notes")
  @RequirePermission("debit_note", "create")
  createDebitNote(
    @Param("id") id: string,
    @Body() dto: CreateDebitNoteDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    return mapSalesErrors(
      this.invoices.createDebitNote(
        {
          originalInvoiceId: id,
          debitDate: new Date(dto.debitDate),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.egsUnitId !== undefined ? { egsUnitId: dto.egsUnitId } : {}),
          lines: dto.lines,
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }
}
