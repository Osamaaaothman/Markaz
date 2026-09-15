import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "@node-rs/argon2";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AUDIT_LOGGER } from "./identity.tokens.js";
import type { CreateUserDto } from "./dto/create-user.dto.js";

export interface SafeUser {
  readonly id: string;
  readonly email: string;
  readonly isActive: boolean;
}

export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly isActive: boolean;
  readonly roles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface CurrentUserProfile {
  readonly id: string;
  readonly email: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly companyDefaultCurrency: string;
  // Permission codes ("<resource>:<action>") this user currently holds — the
  // frontend uses these ONLY to show/hide UI (docs/09-SECURITY-RULES.md §3:
  // authorization itself is always re-checked server-side by PermissionGuard,
  // never trusted from this list alone).
  readonly permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOGGER) private readonly audit: IAuditLogger,
  ) {}

  async create(
    dto: CreateUserDto,
    actorId: string,
    actorCompanyId: string,
    correlationId: string,
  ): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException("A user with this email already exists");
    }

    const passwordHash = await argon2.hash(dto.password);
    const id = newId();

    await this.prisma.user.create({
      data: {
        id,
        companyId: actorCompanyId,
        email: dto.email,
        passwordHash,
        createdBy: actorId,
        updatedBy: actorId,
        ...(dto.roleIds
          ? { roles: { create: dto.roleIds.map((roleId) => ({ roleId })) } }
          : {}),
      },
    });

    await this.audit.log({
      actorId,
      action: "user.created",
      entityType: "User",
      entityId: id,
      after: { email: dto.email },
      correlationId,
    });

    return { id, email: dto.email, isActive: true };
  }

  async listUsers(companyId: string): Promise<UserSummary[]> {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        isActive: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { email: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      isActive: u.isActive,
      roles: u.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    }));
  }

  async assignUserRoles(
    userId: string,
    roleIds: string[],
    actorId: string,
    companyId: string,
    correlationId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException("User not found");

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      ...(roleIds.length > 0
        ? [this.prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })) })]
        : []),
    ]);

    await this.audit.log({
      actorId,
      action: "user.roles_assigned",
      entityType: "User",
      entityId: userId,
      after: { roleIds },
      correlationId,
    });
  }

  async getCurrentUserProfile(userId: string): Promise<CurrentUserProfile> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        companyId: true,
        company: { select: { name: true, defaultCurrency: true } },
        roles: {
          select: {
            role: {
              select: { permissions: { select: { permission: { select: { code: true } } } } },
            },
          },
        },
      },
    });

    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.code);
      }
    }

    return {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      companyName: user.company.name,
      companyDefaultCurrency: user.company.defaultCurrency,
      permissions: [...permissions].sort(),
    };
  }
}
