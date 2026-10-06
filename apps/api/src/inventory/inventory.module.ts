import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  GoodsReceiptService,
  ItemService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  StockCountService,
  StockIssueService,
  StockLevelService,
  WarehouseService,
  type IAccountingEngine,
  type IAuditLogger,
} from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { INVENTORY_ENGINE, INVENTORY_NUMBERING } from "./inventory.tokens.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryExportService } from "./inventory-export.service.js";

@Module({
  controllers: [InventoryController],
  providers: [
    { provide: INVENTORY_NUMBERING, useFactory: () => new PrismaNumberingService() },
    {
      provide: INVENTORY_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) => new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, INVENTORY_NUMBERING],
    },
    {
      provide: WarehouseService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new WarehouseService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: ItemService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new ItemService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: AccountMappingService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new AccountMappingService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: StockLevelService,
      useFactory: (prisma: PrismaService) => new StockLevelService(prisma),
      inject: [PrismaService],
    },
    {
      provide: GoodsReceiptService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, mappings: AccountMappingService, audit: IAuditLogger) =>
        new GoodsReceiptService(prisma, engine, mappings, audit),
      inject: [PrismaService, INVENTORY_ENGINE, AccountMappingService, AUDIT_LOGGER],
    },
    {
      provide: StockIssueService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, mappings: AccountMappingService, audit: IAuditLogger) =>
        new StockIssueService(prisma, engine, mappings, audit),
      inject: [PrismaService, INVENTORY_ENGINE, AccountMappingService, AUDIT_LOGGER],
    },
    {
      provide: StockCountService,
      useFactory: (
        prisma: PrismaService,
        engine: IAccountingEngine,
        numbering: PrismaNumberingService,
        mappings: AccountMappingService,
        audit: IAuditLogger,
      ) => new StockCountService(prisma, engine, numbering, mappings, audit),
      inject: [PrismaService, INVENTORY_ENGINE, INVENTORY_NUMBERING, AccountMappingService, AUDIT_LOGGER],
    },
    InventoryExportService,
  ],
})
export class InventoryModule {}
