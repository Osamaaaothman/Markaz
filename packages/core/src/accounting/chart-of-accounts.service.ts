import { Prisma, type PrismaClient } from "@erp/db";
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
  // A stopped account stays in the books and the reports but takes no new postings and is not offered in pickers.
  readonly isActive: boolean;
  readonly parentId: string | null;
  readonly partyId: string | null;
  // #RRGGBB, set on top-level accounts only.
  readonly color: string | null;
  readonly party: AccountPartyRef | null;
}

// Everything that points at one account. An account may be deleted only when every count is zero and no party is
// linked; any one of them is a reason to keep it (and to stop it instead).
export interface AccountUsage {
  readonly ledgerLines: number;
  readonly mappings: number;
  readonly supplierInvoiceLines: number;
  readonly salesInvoiceLines: number;
  readonly payments: number;
  readonly salaryAdvances: number;
  readonly salaryAdvanceRepayments: number;
  // Employees whose own advance / salary / end-of-service account this is, plus advances held on it.
  readonly employeeAccounts: number;
  readonly children: number;
  readonly linkedParty: boolean;
}

export interface AccountUsageResult {
  readonly id: string;
  readonly code: string;
  readonly usage: AccountUsage;
  readonly canDelete: boolean;
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
  | "MOVE_INTO_SELF_OR_DESCENDANT"
  | "ACCOUNT_IN_USE"
  | "ACCOUNT_MAPPED"
  | "HAS_ACTIVE_CHILDREN"
  | "BALANCE_NOT_ZERO"
  | "PARENT_INACTIVE";

// Typed business-rule failure; the API maps each code to an HTTP status.
export class ChartOfAccountsError extends Error {
  constructor(
    readonly code: ChartOfAccountsErrorCode,
    message: string,
    // What the account is used by (counts per kind), so a screen can say why a delete was refused.
    readonly details?: AccountUsage,
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
  isActive: true,
  parentId: true,
  partyId: true,
  color: true,
  party: { select: { id: true, name: true, nameAr: true, kind: true } },
} as const;

// True when anything at all points at the account.
export function isUsed(usage: AccountUsage): boolean {
  return (
    usage.ledgerLines + usage.mappings + usage.supplierInvoiceLines + usage.salesInvoiceLines + usage.payments + usage.salaryAdvances + usage.salaryAdvanceRepayments + usage.employeeAccounts + usage.children > 0 ||
    usage.linkedParty
  );
}

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

  // Counts every record that points at the account. Takes the client so a delete can run it inside its transaction.
  private async usageOf(
    db: Pick<PrismaClient, "journalEntryLine" | "accountMapping" | "supplierInvoiceLine" | "salesInvoiceLine" | "payment" | "salaryAdvance" | "salaryAdvanceRepayment" | "employee" | "account">,
    id: string,
    partyId: string | null,
  ): Promise<AccountUsage> {
    const [ledgerLines, mappings, supplierInvoiceLines, salesInvoiceLines, payments, salaryAdvances, salaryAdvanceRepayments, employeesUsing, advancesHeld, children] = await Promise.all([
      db.journalEntryLine.count({ where: { accountId: id } }),
      db.accountMapping.count({ where: { accountId: id } }),
      db.supplierInvoiceLine.count({ where: { accountId: id } }),
      db.salesInvoiceLine.count({ where: { revenueAccountId: id } }),
      db.payment.count({ where: { cashAccountId: id } }),
      db.salaryAdvance.count({ where: { cashAccountId: id } }),
      db.salaryAdvanceRepayment.count({ where: { cashAccountId: id } }),
      db.employee.count({ where: { OR: [{ advanceAccountId: id }, { salaryPayableAccountId: id }, { eosbAccountId: id }] } }),
      db.salaryAdvance.count({ where: { receivableAccountId: id } }),
      db.account.count({ where: { parentId: id } }),
    ]);
    return { ledgerLines, mappings, supplierInvoiceLines, salesInvoiceLines, payments, salaryAdvances, salaryAdvanceRepayments, employeeAccounts: employeesUsing + advancesHeld, children, linkedParty: partyId !== null };
  }

  async usage(id: string, actor: AccountActor): Promise<AccountUsageResult> {
    const account = await this.prisma.account.findFirst({ where: { id, companyId: actor.companyId }, select: { id: true, code: true, partyId: true } });
    if (!account) throw new ChartOfAccountsError("ACCOUNT_NOT_FOUND", "Account not found");
    const usage = await this.usageOf(this.prisma, id, account.partyId);
    return { id: account.id, code: account.code, usage, canDelete: !isUsed(usage) };
  }

  // Deletes an account nothing points at. A used account is never deleted (docs/05 section 4): stop it instead.
  // The check runs in the same transaction as the delete under a row lock, and the foreign keys (all RESTRICT) are a
  // second wall: a record this check does not know about makes the database refuse, which is reported the same way.
  async delete(id: string, actor: AccountActor, correlationId: string): Promise<void> {
    let deleted: Record<string, unknown> | null = null;
    try {
      deleted = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM accounts WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
        if (rows.length === 0) throw new ChartOfAccountsError("ACCOUNT_NOT_FOUND", "Account not found");
        const before = await tx.account.findUniqueOrThrow({ where: { id }, select: CHART_ENTRY_SELECT });
        const usage = await this.usageOf(tx, id, before.partyId);
        if (isUsed(usage)) throw new ChartOfAccountsError("ACCOUNT_IN_USE", "This account is used, so it cannot be deleted", usage);
        await tx.account.delete({ where: { id } });
        return { ...before };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ChartOfAccountsError("ACCOUNT_IN_USE", "This account is used, so it cannot be deleted");
      }
      throw error;
    }
    await this.audit.log({ actorId: actor.id, action: "account.deleted", entityType: "Account", entityId: id, before: deleted, correlationId });
  }

  // Stops or restarts an account. A stopped account keeps its history and appears in the reports, but cannot be
  // posted to and is not offered in pickers. Refused for: an account an automatic posting depends on (mapped), a
  // folder that still has active sub-accounts, and (unless acknowledged) an account whose balance is not zero.
  // Restarting needs an active parent so the tree never has an active account under a stopped one.
  async setActive(
    id: string,
    isActive: boolean,
    acknowledgeBalance: boolean,
    actor: AccountActor,
    correlationId: string,
  ): Promise<ChartOfAccountEntry> {
    const before = await this.prisma.account.findFirst({ where: { id, companyId: actor.companyId }, select: CHART_ENTRY_SELECT });
    if (!before) throw new ChartOfAccountsError("ACCOUNT_NOT_FOUND", "Account not found");
    if (before.isActive === isActive) return before;

    if (isActive) {
      if (before.parentId) {
        const parent = await this.prisma.account.findUnique({ where: { id: before.parentId }, select: { isActive: true } });
        if (parent && !parent.isActive) throw new ChartOfAccountsError("PARENT_INACTIVE", "Restart the parent account first");
      }
    } else {
      if ((await this.prisma.accountMapping.count({ where: { accountId: id } })) > 0) {
        throw new ChartOfAccountsError("ACCOUNT_MAPPED", "An automatic posting uses this account; point it elsewhere first");
      }
      if ((await this.prisma.account.count({ where: { parentId: id, isActive: true } })) > 0) {
        throw new ChartOfAccountsError("HAS_ACTIVE_CHILDREN", "Stop the sub-accounts first");
      }
      if (!acknowledgeBalance) {
        const sums = await this.prisma.journalEntryLine.aggregate({ where: { accountId: id }, _sum: { baseDebit: true, baseCredit: true } });
        const net = (sums._sum.baseDebit ?? new Prisma.Decimal(0)).minus(sums._sum.baseCredit ?? new Prisma.Decimal(0));
        if (!net.isZero()) throw new ChartOfAccountsError("BALANCE_NOT_ZERO", "This account still has a balance");
      }
    }

    const after = await this.prisma.account.update({
      where: { id },
      data: { isActive, updatedBy: actor.id, version: { increment: 1 } },
      select: CHART_ENTRY_SELECT,
    });
    await this.audit.log({ actorId: actor.id, action: isActive ? "account.restarted" : "account.stopped", entityType: "Account", entityId: id, before, after, correlationId });
    return after;
  }

  // Turns an account that takes postings into a folder (group) that can hold other accounts. Only for an account
  // nothing has used yet: no ledger line, no account mapping, no supplier-invoice line, payment or salary advance
  // points at it, and no party is linked. A used account keeps its postings (docs/05 section 4), so it is refused.
  // REVIEW: the check and the update are not one atomic step against a posting made at the same instant to an
  // account that has never been used; the posting engine would still accept that one line. Very narrow, but a
  // database trigger refusing lines on a non-postable account would close it. Confirm with the accountant too that
  // restructuring an unused account is acceptable.
  async makeGroup(id: string, actor: AccountActor, correlationId: string): Promise<ChartOfAccountEntry> {
    const before = await this.prisma.account.findFirst({
      where: { id, companyId: actor.companyId },
      select: CHART_ENTRY_SELECT,
    });
    if (!before) throw new ChartOfAccountsError("ACCOUNT_NOT_FOUND", "Account not found");
    if (!before.isPostable) return before; // already a folder: nothing to do

    // A folder has no postings of its own, so children are fine; everything else is a reason to refuse.
    const usage = await this.usageOf(this.prisma, id, before.partyId);
    if (isUsed({ ...usage, children: 0 })) {
      throw new ChartOfAccountsError("ACCOUNT_IN_USE", "This account is already used, so it cannot become a folder", usage);
    }

    const after = await this.prisma.account.update({
      where: { id },
      data: { isPostable: false, updatedBy: actor.id, version: { increment: 1 } },
      select: CHART_ENTRY_SELECT,
    });
    await this.audit.log({ actorId: actor.id, action: "account.made_group", entityType: "Account", entityId: id, before, after, correlationId });
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
