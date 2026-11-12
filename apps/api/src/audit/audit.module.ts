import { Module } from "@nestjs/common";
import { AuditQueryService, type IPermissionService } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { PERMISSION_SERVICE } from "../identity/identity.tokens.js";
import { AuditController } from "./audit.controller.js";

@Module({
  controllers: [AuditController],
  providers: [{ provide: AuditQueryService, useFactory: (prisma: PrismaService, permissions: IPermissionService) => new AuditQueryService(prisma, permissions), inject: [PrismaService, PERMISSION_SERVICE] }],
})
export class AuditModule {}
