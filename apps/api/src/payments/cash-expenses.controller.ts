import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AttachmentService,
  CashExpenseError,
  CashExpenseService,
  type CashExpenseDetail,
  type CashExpenseListPage,
  type CashExpenseResult,
} from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { CompanyDocumentService } from "../documents/company-document.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { localizedCompanyName } from "../common/company-name.js";
import { cashExpenseToPdfHtml } from "./exports/cash-expense-export.js";
import { CashExpensesQueryDto, CreateCashExpenseDto } from "./dto/payment-dtos.js";

async function mapCashExpenseErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof CashExpenseError)) throw error;
    const body = { message: error.message, code: error.code };
    switch (error.code) {
      case "CASH_ACCOUNT_NOT_FOUND":
      case "EXPENSE_ACCOUNT_NOT_FOUND":
        throw new NotFoundException(body);
      default:
        throw new BadRequestException(body);
    }
  }
}

// A cash outlay straight to an expense — no supplier, no invoice. Its own permission (not
// payment:create): recording petty-cash spend is a different grant than running payments.
@Controller("v1/cash-expenses")
export class CashExpensesController {
  constructor(
    private readonly cashExpenses: CashExpenseService,
    private readonly documents: CompanyDocumentService,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
  ) {}

  @Get()
  @RequirePermission("cash_expense", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: CashExpensesQueryDto): Promise<CashExpenseListPage> {
    return this.cashExpenses.list(actor.companyId, query);
  }

  @Get(":id")
  @RequirePermission("cash_expense", "read")
  async get(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload): Promise<CashExpenseDetail> {
    const expense = await this.cashExpenses.get(id, actor.companyId);
    if (!expense) throw new NotFoundException("Cash expense not found");
    return expense;
  }

  @Get(":id/pdf")
  @RequirePermission("cash_expense", "read")
  async pdf(
    @Param("id") id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) res: Response,
    @Query("lang") lang?: string,
  ): Promise<void> {
    const language: SupportedDocumentLanguage = (SUPPORTED_DOCUMENT_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as SupportedDocumentLanguage) : "en";
    const expense = await this.cashExpenses.get(id, actor.companyId);
    if (!expense) throw new NotFoundException("Cash expense not found");
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
    const pdf = await this.documents.render(
      actor.companyId,
      language,
      await cashExpenseToPdfHtml({
        expense,
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
    res.header("Content-Disposition", `attachment; filename="${expense.number}.pdf"`);
    res.send(pdf);
  }

  @Post()
  @RequirePermission("cash_expense", "create")
  create(
    @Body() dto: CreateCashExpenseDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<CashExpenseResult> {
    return mapCashExpenseErrors(
      this.cashExpenses.create(
        {
          expenseDate: new Date(dto.expenseDate),
          cashAccountId: dto.cashAccountId,
          lines: dto.lines.map((l) => ({
            expenseAccountId: l.expenseAccountId,
            amount: l.amount,
            ...(l.costCenterId !== undefined ? { costCenterId: l.costCenterId } : {}),
            ...(l.costCenterRef !== undefined ? { costCenterRef: l.costCenterRef } : {}),
            ...(l.description !== undefined ? { description: l.description } : {}),
          })),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        },
        actor,
        correlationId,
        idempotencyKey,
      ),
    );
  }
}
