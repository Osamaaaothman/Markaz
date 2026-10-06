import { Controller, Get, Inject } from "@nestjs/common";
import { DashboardService, type DashboardData, type DashboardSections, type IPermissionService } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { AuthenticatedOnly } from "../identity/authenticated-only.decorator.js";
import { PERMISSION_SERVICE } from "../identity/identity.tokens.js";

// Each dashboard section is shown only to a user who may read the report behind it, so the first
// screen is never a side door around a permission. Every user can open the dashboard itself; a user
// with no report rights simply gets an empty set of cards.
@Controller("v1")
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
  ) {}

  @Get("dashboard")
  @AuthenticatedOnly()
  async get(@CurrentUser() actor: CurrentUserPayload): Promise<DashboardData> {
    const can = (resource: string): Promise<boolean> => this.permissions.can(actor.id, "read", resource);
    const [agingReport, incomeStatement, balanceSheet, stock, salesInvoice, purchaseOrder] = await Promise.all([
      can("aging_report"),
      can("income_statement"),
      can("balance_sheet"),
      can("stock"),
      can("sales_invoice"),
      can("purchase_order"),
    ]);
    const sections: DashboardSections = {
      receivables: agingReport,
      payables: agingReport,
      profit: incomeStatement,
      cash: balanceSheet,
      stock,
      sales: salesInvoice,
      purchasing: purchaseOrder,
    };
    return this.dashboard.compute(actor.companyId, sections);
  }
}
