import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";

export interface AccountPartyRef {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
}

export interface ChartOfAccountEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
  readonly isPostable: boolean;
  readonly parentId: string | null;
  readonly partyId: string | null;
  // #RRGGBB, set on top-level accounts only.
  readonly color: string | null;
  readonly party: AccountPartyRef | null;
}

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface CreateAccountInput {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | undefined;
  readonly type: AccountType;
  readonly isPostable: boolean;
  readonly parentId?: string | undefined;
  readonly partyId?: string | undefined;
  readonly color?: string | undefined;
}

// Only these can change on an existing account — never the code, type, parent or postable
// flag: an account that has postings must not be retyped or moved
// (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4). A field left out (undefined) is kept; null or ""
// clears nameAr, the party link or the colour.
export interface UpdateAccountInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly partyId?: string | null | undefined;
  readonly color?: string | null | undefined;
}

export interface AccountActor {
  readonly id: string;
  readonly companyId: string;
}

export type ChartOfAccountsErrorCode =
  | "DUPLICATE_CODE"
  | "ACCOUNT_NOT_FOUND"
  | "PARENT_NOT_FOUND"
  | "PARENT_NOT_GROUP"
  | "COLOR_ON_CHILD"
  | "PARTY_NOT_FOUND";

// Typed business-rule failure; the API maps each code to an HTTP status.
export class ChartOfAccountsError extends Error {
  constructor(
    readonly code: ChartOfAccountsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChartOfAccountsError";
  }
}

// Everything the chart of accounts screen needs about one account, including the party it is
// kept for (name and kind only — enough for a label, no contact details).
export const CHART_ENTRY_SELECT = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
  type: true,
  isPostable: true,
  parentId: true,
  partyId: true,
  color: true,
  party: { select: { id: true, name: true, nameAr: true, kind: true } },
} as const;

export function normalBalanceFor(type: AccountType): "DEBIT" | "CREDIT" {
  return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}

export class ChartOfAccountsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreateAccountInput, actor: AccountActor, correlationId: string): Promise<ChartOfAccountEntry> {
    const duplicate = await this.prisma.account.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: input.code } },
      select: { id: true },
    });
    if (duplicate) throw new ChartOfAccountsError("DUPLICATE_CODE", "An account with this code already exists");

    if (input.parentId) {
      // Company-scoped lookup: another company's account is "not found", never "not allowed".
      const parent = await this.prisma.account.findFirst({
        where: { id: input.parentId, companyId: actor.companyId },
        select: { isPostable: true },
      });
      if (!parent) throw new ChartOfAccountsError("PARENT_NOT_FOUND", "Parent account not found");
      // docs/05 §4: only leaf accounts are postable, so a postable account can never become a parent.
      if (parent.isPostable) {
        throw new ChartOfAccountsError("PARENT_NOT_GROUP", "Parent must be a group account, not a postable one");
      }
    }
    // A branch is drawn in its top-level account's colour, so only a top-level account has one.
    if (input.color !== undefined && input.parentId) {
      throw new ChartOfAccountsError("COLOR_ON_CHILD", "A colour can only be set on a top-level account");
    }
    if (input.partyId) await this.assertActiveParty(actor.companyId, input.partyId);

    const id = newId();
    const account = await this.prisma.account.create({
      data: {
        id,
        companyId: actor.companyId,
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        type: input.type,
        normalBalance: normalBalanceFor(input.type),
        isPostable: input.isPostable,
        parentId: input.parentId ?? null,
        partyId: input.partyId ?? null,
        color: input.color ?? null,
        createdBy: actor.id,
      },
      select: CHART_ENTRY_SELECT,
    });

    await this.audit.log({ actorId: actor.id, action: "account.created", entityType: "Account", entityId: id, after: account, correlationId });
    return account;
  }

  async update(id: string, input: UpdateAccountInput, actor: AccountActor, correlationId: string): Promise<ChartOfAccountEntry> {
    const before = await this.prisma.account.findFirst({
      where: { id, companyId: actor.companyId },
      select: CHART_ENTRY_SELECT,
    });
    if (!before) throw new ChartOfAccountsError("ACCOUNT_NOT_FOUND", "Account not found");

    if (input.color && before.parentId !== null) {
      throw new ChartOfAccountsError("COLOR_ON_CHILD", "A colour can only be set on a top-level account");
    }
    if (input.partyId) await this.assertActiveParty(actor.companyId, input.partyId);

    const after = await this.prisma.account.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr?.trim() || null } : {}),
        ...(input.partyId !== undefined ? { partyId: input.partyId || null } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: CHART_ENTRY_SELECT,
    });

    await this.audit.log({ actorId: actor.id, action: "account.updated", entityType: "Account", entityId: id, before, after, correlationId });
    return after;
  }

  private async assertActiveParty(companyId: string, partyId: string): Promise<void> {
    const party = await this.prisma.party.findFirst({ where: { id: partyId, companyId, isActive: true }, select: { id: true } });
    if (!party) throw new ChartOfAccountsError("PARTY_NOT_FOUND", "Party not found");
  }
}
