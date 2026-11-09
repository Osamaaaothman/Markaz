import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query } from "@nestjs/common";
import { CashExpenseError, CashExpenseService, type CashExpenseListPage, type CashExpenseResult } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { IdempotencyKey } from "../common/idempotency-key.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
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
  constructor(private readonly cashExpenses: CashExpenseService) {}

  @Get()
  @RequirePermission("cash_expense", "read")
  list(@CurrentUser() actor: CurrentUserPayload, @Query() query: CashExpensesQueryDto): Promise<CashExpenseListPage> {
    return this.cashExpenses.list(actor.companyId, query);
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
          amount: dto.amount,
          cashAccountId: dto.cashAccountId,
          expenseAccountId: dto.expenseAccountId,
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
