import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Post, Query } from "@nestjs/common";
import {
  PaymentError,
  PaymentService,
  UnmappedAccountError,
  type OpenInvoiceView,
  type PaymentDirection,
  type PaymentListPage,
  type PaymentResult,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
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
  constructor(private readonly payments: PaymentService) {}

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
