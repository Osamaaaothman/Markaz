import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { allocateRef } from "../reference.js";

export interface AccountPartyRef {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
}

export interface ChartOfAccountEntry {
  readonly id: string;
  readonly ref: string;
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
  | "PARTY_NOT_FOUND"
  | "TYPE_MISMATCH"
  | "MOVE_INTO_SELF_OR_DESCENDANT";

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
  ref: true,
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
    const account = await this.prisma.$transaction(async (tx) => {
      const ref = await allocateRef(tx, actor.companyId, "account");
      return tx.account.create({
        data: {
          id,
          ref,
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

  // Moves an account (with everything under it) to another group, or to the top level when `newParentId` is null.
  // Nothing that was posted changes: a move only changes how the tree groups accounts and how the totals roll up.
  // REVIEW: the accounting rule in docs/05 section 4 forbids deleting or retyping an account that has postings and
  // says nothing about moving it; a move is therefore allowed only inside the same account type, never into a postable
  // account, and never into itself or one of its own descendants. The code is NOT changed (a code that no longer starts
  // with its parent's code is allowed). Confirm with the accountant that regrouping a used account is acceptable.
  async move(id: string, newParentId: string | null, actor: AccountActor, correlationId: string): Promise<ChartOfAccountEntry> {
    const before = await this.prisma.account.findFirst({ where: { id, companyId: actor.companyId }, select: CHART_ENTRY_SELECT });
    if (!before) throw new ChartOfAccountsError("ACCOUNT_NOT_FOUND", "Account not found");
    if (before.parentId === newParentId) return before;

    if (newParentId !== null) {
      if (newParentId === id) throw new ChartOfAccountsError("MOVE_INTO_SELF_OR_DESCENDANT", "An account cannot be moved under itself");
      const parent = await this.prisma.account.findFirst({
        where: { id: newParentId, companyId: actor.companyId },
        select: { id: true, type: true, isPostable: true, parentId: true },
      });
      if (!parent) throw new ChartOfAccountsError("PARENT_NOT_FOUND", "Parent account not found");
      if (parent.isPostable) throw new ChartOfAccountsError("PARENT_NOT_GROUP", "Parent must be a group account, not a postable one");
      if (parent.type !== before.type) {
        throw new ChartOfAccountsError("TYPE_MISMATCH", "An account can only be moved under a group of the same type");
      }
      // Walk up from the new parent: meeting the moved account means the new parent is one of its descendants.
      let cursor: string | null = parent.parentId;
      const seen = new Set<string>([parent.id]);
      while (cursor !== null && !seen.has(cursor)) {
        if (cursor === id) throw new ChartOfAccountsError("MOVE_INTO_SELF_OR_DESCENDANT", "An account cannot be moved under one of its own sub-accounts");
        seen.add(cursor);
        const up: { parentId: string | null } | null = await this.prisma.account.findFirst({ where: { id: cursor, companyId: actor.companyId }, select: { parentId: true } });
        cursor = up?.parentId ?? null;
      }
    }

    const after = await this.prisma.account.update({
      where: { id },
      data: {
        parentId: newParentId,
        // Only a top-level account has a colour; under a parent it takes the branch colour.
        ...(newParentId !== null ? { color: null } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: CHART_ENTRY_SELECT,
    });
    await this.audit.log({
      actorId: actor.id,
      action: "account.moved",
      entityType: "Account",
      entityId: id,
      before: { parentId: before.parentId },
      after: { parentId: after.parentId },
      correlationId,
    });
    return after;
  }

  private async assertActiveParty(companyId: string, partyId: string): Promise<void> {
    const party = await this.prisma.party.findFirst({ where: { id: partyId, companyId, isActive: true }, select: { id: true } });
    if (!party) throw new ChartOfAccountsError("PARTY_NOT_FOUND", "Party not found");
  }
}
