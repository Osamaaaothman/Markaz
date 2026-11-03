import { Module } from "@nestjs/common";
import { AuditQueryService } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditController } from "./audit.controller.js";

@Module({
  controllers: [AuditController],
  providers: [{ provide: AuditQueryService, useFactory: (prisma: PrismaService) => new AuditQueryService(prisma), inject: [PrismaService] }],
})
export class AuditModule {}
