import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  AgingService,
  ApprovalService,
  BalanceSheetService,
  CashFlowService,
  ChartOfAccountsService,
  GeneralLedgerService,
  IncomeStatementService,
  PartyStatementService,
  PurchaseOrderService,
  StockLevelService,
  DashboardService,
  EmployeeService,
  ItemService,
  PartyService,
  type IAuditLogger,
  type IPermissionService,
} from "@erp/core";
import { AUDIT_LOGGER, PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiChatService } from "./ai-chat.service.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { AiController } from "./ai.controller.js";
import { AiMcpController } from "./mcp/ai-mcp.controller.js";
import { AI_TOOLS } from "./ai.tokens.js";
import { buildErpTools } from "./tools/erp-tools.js";
import { buildReportTools } from "./tools/report-tools.js";

// AI assistant (docs/Planning/ai-assistant-plan.md). The tools use the same core services the web
// endpoints use, built here the same way their own modules build them.
@Module({
  controllers: [AiController, AiMcpController],
  providers: [
    {
      provide: AiSettingsService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new AiSettingsService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: AI_TOOLS,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => {
        const aging = new AgingService(prisma, new AccountMappingService(prisma, audit));
        return [
          ...buildErpTools({
            prisma,
            parties: new PartyService(prisma, audit),
            employees: new EmployeeService(prisma, audit),
            items: new ItemService(prisma, audit),
            accounts: new ChartOfAccountsService(prisma, audit),
            dashboard: new DashboardService(prisma, aging),
          }),
          ...buildReportTools({
            prisma,
            stock: new StockLevelService(prisma),
            incomeStatement: new IncomeStatementService(prisma),
            balanceSheet: new BalanceSheetService(prisma),
            cashFlow: new CashFlowService(prisma),
            aging,
            partyStatements: new PartyStatementService(prisma),
            ledger: new GeneralLedgerService(prisma),
            // Read-only use (list); approvals are never decided through the assistant.
            purchaseOrders: new PurchaseOrderService(prisma, new ApprovalService(), audit),
          }),
        ];
      },
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: AiChatService,
      useFactory: (prisma: PrismaService, permissions: IPermissionService, audit: IAuditLogger, settings: AiSettingsService, tools: ReturnType<typeof buildErpTools>) =>
        new AiChatService(prisma, permissions, audit, settings, tools),
      inject: [PrismaService, PERMISSION_SERVICE, AUDIT_LOGGER, AiSettingsService, AI_TOOLS],
    },
  ],
})
export class AiModule {}
