import { ConflictException, Inject, Injectable } from "@nestjs/common";
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
}
