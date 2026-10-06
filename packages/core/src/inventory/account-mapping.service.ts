import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger, TransactionClient } from "../contracts.js";

// What each amount in an M4 posting means — never an account code or name, that is tenant
// configuration resolved through this table (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4:
// "Account mapping is configuration. Modules say 'inventory increased'; a per-tenant mapping
// resolves that to an account.").
export const ACCOUNT_MAPPING_KEYS = [
  "INVENTORY",
  "GRNI",
  "PROJECT_ISSUE_EXPENSE",
  "COUNT_LOSS",
  "COUNT_GAIN",
  // M5 purchasing: where a supplier invoice posts its payable, input VAT and price variance.
  "ACCOUNTS_PAYABLE",
  "VAT_INPUT",
  "PURCHASE_PRICE_VARIANCE",
  // M6 sales: receivable, revenue, output VAT and cost of goods sold.
  "ACCOUNTS_RECEIVABLE",
  "SALES_REVENUE",
  "VAT_OUTPUT",
  "COST_OF_GOODS_SOLD",
] as const;
export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number];

export interface AccountMappingEntry {
  readonly key: AccountMappingKey;
  // null when this tenant has not configured this key yet.
  readonly accountId: string | null;
  readonly accountCode: string | null;
  readonly accountName: string | null;
}

export interface AccountMappingActor {
  readonly id: string;
  readonly companyId: string;
}

export class AccountMappingError extends Error {
  constructor(
    readonly code: "ACCOUNT_NOT_FOUND" | "ACCOUNT_NOT_POSTABLE",
    message: string,
  ) {
    super(message);
    this.name = "AccountMappingError";
  }
}

// An unmapped key the caller actually needed to post — distinct from AccountMappingError so a
// posting service can turn it into one clear, translated error instead of a generic failure.
export class UnmappedAccountError extends Error {
  constructor(readonly key: AccountMappingKey) {
    super(`No account is mapped to "${key}" for this company yet`);
    this.name = "UnmappedAccountError";
  }
}

export class AccountMappingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  // Every key, configured or not — the settings screen needs to show gaps, not just what is
  // already set.
  async list(companyId: string): Promise<AccountMappingEntry[]> {
    const rows = await this.prisma.accountMapping.findMany({
      where: { companyId },
      select: { key: true, account: { select: { id: true, code: true, name: true } } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.account]));

    return ACCOUNT_MAPPING_KEYS.map((key) => {
      const account = byKey.get(key);
      return {
        key,
        accountId: account?.id ?? null,
        accountCode: account?.code ?? null,
        accountName: account?.name ?? null,
      };
    });
  }

  async set(key: AccountMappingKey, accountId: string, actor: AccountMappingActor, correlationId: string): Promise<AccountMappingEntry> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId: actor.companyId },
      select: { id: true, code: true, name: true, isPostable: true },
    });
    if (!account) throw new AccountMappingError("ACCOUNT_NOT_FOUND", "Account not found");
    // A mapped account is where real postings land, so it must be a leaf, postable account —
    // the same rule account creation itself enforces for a parent (docs/05 §4).
    if (!account.isPostable) {
      throw new AccountMappingError("ACCOUNT_NOT_POSTABLE", "Only a postable (leaf) account can be mapped");
    }

    const before = await this.prisma.accountMapping.findUnique({
      where: { companyId_key: { companyId: actor.companyId, key } },
    });

    await this.prisma.accountMapping.upsert({
      where: { companyId_key: { companyId: actor.companyId, key } },
      create: { id: newId(), companyId: actor.companyId, key, accountId, updatedBy: actor.id },
      update: { accountId, updatedBy: actor.id },
    });

    await this.audit.log({
      actorId: actor.id,
      action: "account_mapping.set",
      entityType: "AccountMapping",
      entityId: `${actor.companyId}:${key}`,
      ...(before ? { before: { accountId: before.accountId } } : {}),
      after: { accountId },
      correlationId,
    });

    return { key, accountId: account.id, accountCode: account.code, accountName: account.name };
  }

  // Resolves a key to its mapped account id inside the caller's own transaction — used by the
  // posting services (goods receipt, stock issue, stock count) so the "is this key mapped"
  // check and the posting itself are part of the same all-or-nothing unit of work
  // (docs/02-ARCHITECTURE-RULES.md §5).
  async resolve(tx: TransactionClient, companyId: string, key: AccountMappingKey): Promise<string> {
    const mapping = await tx.accountMapping.findUnique({
      where: { companyId_key: { companyId, key } },
      select: { accountId: true },
    });
    if (!mapping) throw new UnmappedAccountError(key);
    return mapping.accountId;
  }
}
