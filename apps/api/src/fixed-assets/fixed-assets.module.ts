import { Module } from "@nestjs/common";
import {
  AccountMappingService,
  AssetCategoryService,
  DepreciationRunService,
  FixedAssetDisposalService,
  FixedAssetReportsService,
  FixedAssetService,
  PrismaAccountingEngine,
  PrismaNumberingService,
  type IAccountingEngine,
  type IAuditLogger,
} from "@erp/core";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FixedAssetsController } from "./fixed-assets.controller.js";
import { FIXED_ASSETS_ENGINE, FIXED_ASSETS_NUMBERING } from "./fixed-assets.tokens.js";

// Same shape as HrModule: stateless core services over PrismaService with a module-local accounting engine.
@Module({
  controllers: [FixedAssetsController],
  providers: [
    { provide: FIXED_ASSETS_NUMBERING, useFactory: () => new PrismaNumberingService() },
    {
      provide: FIXED_ASSETS_ENGINE,
      useFactory: (prisma: PrismaService, numbering: PrismaNumberingService) => new PrismaAccountingEngine(prisma, numbering),
      inject: [PrismaService, FIXED_ASSETS_NUMBERING],
    },
    {
      provide: AssetCategoryService,
      useFactory: (prisma: PrismaService, audit: IAuditLogger) => new AssetCategoryService(prisma, audit),
      inject: [PrismaService, AUDIT_LOGGER],
    },
    {
      provide: FixedAssetService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) => new FixedAssetService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, FIXED_ASSETS_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: DepreciationRunService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) => new DepreciationRunService(prisma, engine, audit),
      inject: [PrismaService, FIXED_ASSETS_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: FixedAssetDisposalService,
      useFactory: (prisma: PrismaService, engine: IAccountingEngine, audit: IAuditLogger) => new FixedAssetDisposalService(prisma, engine, new AccountMappingService(prisma, audit), audit),
      inject: [PrismaService, FIXED_ASSETS_ENGINE, AUDIT_LOGGER],
    },
    {
      provide: FixedAssetReportsService,
      useFactory: (prisma: PrismaService) => new FixedAssetReportsService(prisma),
      inject: [PrismaService],
    },
  ],
})
export class FixedAssetsModule {}
