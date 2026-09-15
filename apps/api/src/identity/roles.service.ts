import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AUDIT_LOGGER } from "./identity.tokens.js";
import type { CreateRoleDto } from "./dto/create-role.dto.js";

export interface PermissionEntry {
  readonly code: string;
  readonly description: string | null;
}

export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOGGER) private readonly audit: IAuditLogger,
  ) {}

  async listPermissions(): Promise<PermissionEntry[]> {
    const rows = await this.prisma.permission.findMany({ orderBy: { code: "asc" } });
    return rows.map((r) => ({ code: r.code, description: r.description }));
  }

  async listRoles(companyId: string): Promise<RoleSummary[]> {
    const roles = await this.prisma.role.findMany({
      where: { companyId },
      select: { id: true, name: true, permissions: { select: { permission: { select: { code: true } } } } },
      orderBy: { name: "asc" },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions.map((p) => p.permission.code),
    }));
  }

  async createRole(dto: CreateRoleDto, actorId: string, companyId: string, correlationId: string): Promise<RoleSummary> {
    const existing = await this.prisma.role.findUnique({ where: { companyId_name: { companyId, name: dto.name } } });
    if (existing) throw new ConflictException("A role with this name already exists");

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissionCodes } },
    });

    const id = newId();
    await this.prisma.role.create({
      data: {
        id,
        companyId,
        name: dto.name,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });

    await this.audit.log({
      actorId,
      action: "role.created",
      entityType: "Role",
      entityId: id,
      after: { name: dto.name, permissionCodes: dto.permissionCodes },
      correlationId,
    });

    return { id, name: dto.name, permissions: permissions.map((p) => p.code) };
  }
}
