import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  AgingService,
  ApprovalService,
  AttachmentService,
  DashboardService,
  ItemService,
  PartyService,
  PartyStatementService,
  PurchaseOrderService,
  SalesInvoiceService,
  StockLevelService,
  type IAuditLogger,
  type IPermissionService,
} from "@erp/core";
import { AttachmentsModule } from "../attachments/attachments.module.js";
import { parseAttachmentConfig } from "../attachments/attachments.config.js";
import { CompanyDocumentService } from "../documents/company-document.service.js";
import { AUDIT_LOGGER, PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { workerLogger } from "../jobs/worker-logger.js";
import { ReceivablesExportService } from "../payments/receivables-reports.controller.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SalesInvoicePdfService } from "../sales/sales-invoice-pdf.service.js";
import { SalesModule } from "../sales/sales.module.js";
import { BotMeController, BotsController } from "./api/bots.controller.js";
import { BotWebhooksController } from "./api/bot-webhooks.controller.js";
import { AdapterRegistry, BotVault } from "./application/bot-core.js";
import { BotConnectionService } from "./application/bot-connection.service.js";
import { BotLinkService } from "./application/bot-link.service.js";
import { BotRuntime } from "./application/bot-runtime.js";
import { BotScheduler } from "./application/bot-scheduler.js";
import { parseBotsConfig, type BotsConfig } from "./bots.config.js";
import { BOT_SERVICES, BOTS_CONFIG } from "./bots.tokens.js";
import { BotDeliveryQueueProxy, BotInboundQueue, BotsRuntimeHost } from "./bots-runtime.host.js";
import type { BotServices } from "./features/feature-kit.js";
import { createApprovalsFeature } from "./features/approvals.feature.js";
import { createDocumentsFeature } from "./features/documents.feature.js";
import { createLookupsFeature } from "./features/lookups.feature.js";
import { createMenuFeature } from "./features/menu.feature.js";
import { createReceiptsFeature } from "./features/receipts.feature.js";
import { createReportsFeature } from "./features/reports.feature.js";

// Chat bots (docs/BOTS-INTEGRATION-PLAN.md). The features use the same core services as the web
// endpoints, built here the same way their own modules build them.
@Module({
  imports: [SalesModule, AttachmentsModule],
  controllers: [BotsController, BotMeController, BotWebhooksController],
  providers: [
    { provide: BOTS_CONFIG, useFactory: (): BotsConfig => parseBotsConfig(process.env) },
    { provide: AdapterRegistry, useFactory: () => new AdapterRegistry() },
    { provide: BotVault, useFactory: () => new BotVault() },
    {
      provide: BotConnectionService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger, registry: AdapterRegistry, vault: BotVault, config: BotsConfig) => new BotConnectionService(prisma, audit, registry, vault, config),
      inject: [PrismaService, AUDIT_LOGGER, AdapterRegistry, BotVault, BOTS_CONFIG],
    },
    {
      provide: BotLinkService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new BotLinkService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: BOT_SERVICES,
      useFactory: (
        prisma: PrismaService,
        audit: IAuditLogger,
        invoices: SalesInvoiceService,
        invoicePdfs: SalesInvoicePdfService,
        documents: CompanyDocumentService,
        attachments: AttachmentService,
        links: BotLinkService,
      ): BotServices => {
        const aging = new AgingService(prisma, new AccountMappingService(prisma, audit));
        return {
          prisma,
          purchaseOrders: new PurchaseOrderService(prisma, new ApprovalService(), audit),
          parties: new PartyService(prisma, audit),
          statements: new PartyStatementService(prisma),
          aging,
          items: new ItemService(prisma, audit),
          stock: new StockLevelService(prisma),
          invoices,
          dashboard: new DashboardService(prisma, aging),
          invoicePdfs,
          receivablesExport: new ReceivablesExportService(documents, prisma),
          attachments,
          links,
          runtime: null,
          maxInboundFileBytes: parseAttachmentConfig(process.env).maxBytes,
        };
      },
      inject: [PrismaService, AUDIT_LOGGER, SalesInvoiceService, SalesInvoicePdfService, CompanyDocumentService, AttachmentService, BotLinkService],
    },
    {
      provide: BotRuntime,
      useFactory: (
        prisma: PrismaService,
        permissions: IPermissionService,
        audit: IAuditLogger,
        registry: AdapterRegistry,
        vault: BotVault,
        config: BotsConfig,
        services: BotServices,
      ) => {
        const features = [
          createMenuFeature(services),
          createApprovalsFeature(services),
          createLookupsFeature(services),
          createDocumentsFeature(services),
          createReportsFeature(services),
          createReceiptsFeature(services),
        ];
        const runtime = new BotRuntime(prisma, permissions, audit, registry, vault, config, workerLogger, features);
        services.runtime = runtime;
        return runtime;
      },
      inject: [PrismaService, PERMISSION_SERVICE, AUDIT_LOGGER, AdapterRegistry, BotVault, BOTS_CONFIG, BOT_SERVICES],
    },
    BotDeliveryQueueProxy,
    {
      provide: BotScheduler,
      useFactory: (prisma: PrismaService, runtime: BotRuntime, services: BotServices, queue: BotDeliveryQueueProxy) => new BotScheduler(prisma, runtime, services, queue, workerLogger),
      inject: [PrismaService, BotRuntime, BOT_SERVICES, BotDeliveryQueueProxy],
    },
    BotInboundQueue,
    BotsRuntimeHost,
  ],
})
export class BotsModule {}
