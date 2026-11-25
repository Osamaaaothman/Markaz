import { Module } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
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
  QuotationService,
  TrialBalanceService,
  StockLevelService,
  DashboardService,
  EmployeeService,
  ItemService,
  PartyService,
  AttachmentService,
  SupplierInvoiceService,
  type IAuditLogger,
  type IPermissionService,
} from "@erp/core";
import { AttachmentsModule } from "../attachments/attachments.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PurchasingModule } from "../purchasing/purchasing.module.js";
import { AUDIT_LOGGER, PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiChatService } from "./ai-chat.service.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { AiController } from "./ai.controller.js";
import { AiMcpController } from "./mcp/ai-mcp.controller.js";
import { AiAccessTokenController } from "./mcp/ai-access-token.controller.js";
import { AI_TOOLS } from "./ai.tokens.js";
import { buildErpTools } from "./tools/erp-tools.js";
import { buildReportTools } from "./tools/report-tools.js";
import { buildDocumentTools } from "./tools/document-tools.js";
import { buildSalesTools } from "./tools/sales-tools.js";
import { buildPurchasingTools } from "./tools/purchasing-tools.js";
import { buildActionTools } from "./tools/action-tools.js";

// AI assistant (docs/Planning/ai-assistant-plan.md). The tools use the same core services the web
// endpoints use, built here the same way their own modules build them.
@Module({
  // AuthModule provides AccessTokenService for the token routes.
  imports: [AttachmentsModule, PurchasingModule, AuthModule],
  controllers: [AiController, AiMcpController, AiAccessTokenController],
  providers: [
    {
      provide: AiSettingsService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new AiSettingsService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: AI_TOOLS,
      useFactory: (prisma: PrismaService, audit: IAuditLogger, invoices: SupplierInvoiceService, attachments: AttachmentService, moduleRef: ModuleRef) => {
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
          ...buildSalesTools({ prisma, quotations: new QuotationService(prisma, audit) }),
          ...buildDocumentTools({ prisma, trialBalance: new TrialBalanceService(prisma) }),
          ...buildPurchasingTools({ prisma, invoices, attachments }),
          // Actions that run through the same controller methods as the web pages (resolved when used).
          ...buildActionTools({ prisma, moduleRef }),
        ];
      },
      inject: [PrismaService, AUDIT_LOGGER, SupplierInvoiceService, AttachmentService, ModuleRef],
    },
    {
      provide: AiChatService,
      useFactory: (prisma: PrismaService, permissions: IPermissionService, audit: IAuditLogger, settings: AiSettingsService, tools: ReturnType<typeof buildErpTools>, attachments: AttachmentService) =>
        new AiChatService(prisma, permissions, audit, settings, tools, undefined, undefined, attachments),
      inject: [PrismaService, PERMISSION_SERVICE, AUDIT_LOGGER, AiSettingsService, AI_TOOLS, AttachmentService],
    },
  ],
})
export class AiModule {}
