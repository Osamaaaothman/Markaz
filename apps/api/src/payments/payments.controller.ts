import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AttachmentService,
  PaymentError,
  PaymentService,
  UnmappedAccountError,
  type OpenInvoiceView,
  type PaymentDetail,
  type PaymentDirection,
  type PaymentListPage,
  type PaymentResult,
  type ReversePaymentResult,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { renderHtmlToPdf } from "../documents/pdf-renderer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { paymentToPdfHtml } from "./exports/payment-export.js";
import { localizedCompanyName } from "../common/company-name.js";
import { CreatePaymentDto, OpenInvoicesQueryDto, PaymentsQueryDto } from "./dto/payment-dtos.js";

async function mapPaymentErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof UnmappedAccountError) throw new BadRequestException(error.message);
    if (!(error instanceof PaymentError)) throw error;
    const body = { message: error.message, code: error.code };
    switch (error.code) {
      case "PARTY_NOT_FOUND":
      case "CASH_ACCOUNT_NOT_FOUND":
      case "INVOICE_NOT_FOUND":
      case "NOT_FOUND":
        throw new NotFoundException(body);
      case "OVER_ALLOCATED":
      case "ALREADY_VOIDED":
        throw new ConflictException(body);
      default:
        throw new BadRequestException(body);
    }
  }
}

// Money in and money out are separate endpoints with separate permissions: paying a supplier is a
// right worth granting more carefully than recording a customer's receipt.
@Controller("v1")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
  ) {}

  @Get("payments")
  @RequirePermission("payment", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: PaymentsQueryDto): Promise<PaymentListPage> {
    return this.payments.list(actor.companyId, query);
  }

  // Invoices a payment to/from this party can still settle. Needs the right to record that payment.
  @Get("payments/open-invoices")
  @RequirePermission("payment", "read")
  openInvoices(@CurrentUser() actor: CurrentUserPayload, @Query() query: OpenInvoicesQueryDto): Promise<OpenInvoiceView[]> {
    return this.payments.openInvoices(actor.companyId, query.partyId, query.direction);
  }

  @Get("payments/:id")
  @RequirePermission("payment", "read")
  async get(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<PaymentDetail> {
    const payment = await this.payments.get(id, actor.companyId);
    if (!payment) throw new NotFoundException("Payment not found");
    return payment;
  }

  @Get("payments/:id/pdf")
  @RequirePermission("payment", "read")
  async pdf(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Query("lang") lang?: string,
  ): Promise<void> {
    const language: SupportedDocumentLanguage = (SUPPORTED_DOCUMENT_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as SupportedDocumentLanguage) : "en";
    const payment = await this.payments.get(id, actor.companyId);
    if (!payment) throw new NotFoundException("Payment not found");
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
    const logo = await this.attachments.getCompanyLogo(actor.companyId).catch(() => null);
    const logoDataUri = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : undefined;
    const addressSeparator = language === "ar" ? "، " : ", ";
    const sellerBuildingPart = [company.buildingNumber, company.additionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
    const sellerAddressParts = [company.streetName, company.additionalStreetName, company.district, company.city, company.postalCode].filter(
      (p): p is string => Boolean(p?.trim()),
    );
    const sellerAddress = [sellerBuildingPart, ...sellerAddressParts].filter(Boolean).join(addressSeparator).trim() || null;
    const pdf = await renderHtmlToPdf(
      await paymentToPdfHtml({
        payment,
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
    res.header("Content-Disposition", `attachment; filename="${payment.number}.pdf"`);
    res.send(pdf);
  }

  @Post("customer-receipts")
  @RequirePermission("customer_receipt", "create")
  createReceipt(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<PaymentResult> {
    return mapPaymentErrors(this.payments.create(toInput("RECEIPT", dto), actor, correlationId, idempotencyKey));
  }

  @Post("supplier-payments")
  @RequirePermission("supplier_payment", "create")
  createPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<PaymentResult> {
    return mapPaymentErrors(this.payments.create(toInput("PAYMENT", dto), actor, correlationId, idempotencyKey));
  }

  @Post("payments/:id/reverse")
  @RequirePermission("payment", "create")
  reversePayment(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<ReversePaymentResult> {
    return mapPaymentErrors(this.payments.reverse({ paymentId: id, reversalDate: new Date() }, actor, correlationId, idempotencyKey));
  }
}

function toInput(direction: PaymentDirection, dto: CreatePaymentDto) {
  return {
    direction,
    partyId: dto.partyId,
    paymentDate: new Date(dto.paymentDate),
    amount: dto.amount,
    cashAccountId: dto.cashAccountId,
    method: dto.method,
    ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    allocations: dto.allocations,
  };
}
