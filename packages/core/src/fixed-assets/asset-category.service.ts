import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger, TransactionClient } from "../contracts.js";
import { FixedAssetError, money, type FixedAssetActor } from "./fixed-asset-common.js";

export interface CategoryAccountRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

export interface AssetCategorySummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly numberPrefix: string;
  readonly depreciationMethod: string;
  readonly isDepreciable: boolean;
  readonly defaultUsefulLifeMonths: number | null;
  readonly defaultResidualPercent: string;
  readonly assetAccount: CategoryAccountRef;
  readonly accumulatedDepreciationAccount: CategoryAccountRef | null;
  readonly depreciationExpenseAccount: CategoryAccountRef | null;
  readonly isActive: boolean;
  readonly assetCount: number;
  // True once any asset of this category is in the ledger: its accounts and prefix are then fixed.
  readonly isLocked: boolean;
}

export interface CreateAssetCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null;
  readonly numberPrefix: string;
  readonly isDepreciable: boolean;
  readonly defaultUsefulLifeMonths?: number | null;
  readonly defaultResidualPercent?: string;
  readonly assetAccountId: string;
  readonly accumulatedDepreciationAccountId?: string | null;
  readonly depreciationExpenseAccountId?: string | null;
}

export interface UpdateAssetCategoryInput {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly numberPrefix?: string;
  readonly isDepreciable?: boolean;
  readonly defaultUsefulLifeMonths?: number | null;
  readonly defaultResidualPercent?: string;
  readonly assetAccountId?: string;
  readonly accumulatedDepreciationAccountId?: string | null;
  readonly depreciationExpenseAccountId?: string | null;
  readonly isActive?: boolean;
}

const accountSelect = { id: true, code: true, name: true, nameAr: true } as const;
const include = {
  assetAccount: { select: accountSelect },
  accumulatedDepreciationAccount: { select: accountSelect },
  depreciationExpenseAccount: { select: accountSelect },
  _count: { select: { assets: true } },
} as const;

type CategoryRow = Prisma.FixedAssetCategoryGetPayload<{ include: typeof include }>;

// Categories carry everything an asset needs by default: life, residual, number prefix and the three ledger accounts.
// Once an asset of a category has been posted, its accounts and prefix are frozen: changing them would leave the ledger and
// the register telling two different stories (docs/05 §7).
export class AssetCategoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, includeInactive = false): Promise<AssetCategorySummary[]> {
    const rows = await this.prisma.fixedAssetCategory.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      include,
      orderBy: { code: "asc" },
    });
    const locked = await this.lockedIds(this.prisma, companyId, rows.map((r) => r.id));
    return rows.map((r) => this.summary(r, locked.has(r.id)));
  }

  async get(id: string, companyId: string): Promise<AssetCategorySummary | null> {
    const row = await this.prisma.fixedAssetCategory.findFirst({ where: { id, companyId }, include });
    if (!row) return null;
    const locked = await this.lockedIds(this.prisma, companyId, [row.id]);
    return this.summary(row, locked.has(row.id));
  }

  async create(input: CreateAssetCategoryInput, actor: FixedAssetActor, correlationId: string): Promise<AssetCategorySummary> {
    const id = newId();
    await this.prisma.$transaction(async (tx) => {
      await this.assertUnique(tx, actor.companyId, input.code, input.numberPrefix, null);
      await this.validateAccounts(tx, actor.companyId, {
        isDepreciable: input.isDepreciable,
        assetAccountId: input.assetAccountId,
        accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId ?? null,
        depreciationExpenseAccountId: input.depreciationExpenseAccountId ?? null,
      });
      await tx.fixedAssetCategory.create({
        data: {
          id,
          companyId: actor.companyId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          nameAr: input.nameAr?.trim() || null,
          numberPrefix: input.numberPrefix.trim().toUpperCase(),
          isDepreciable: input.isDepreciable,
          defaultUsefulLifeMonths: input.isDepreciable ? (input.defaultUsefulLifeMonths ?? null) : null,
          defaultResidualPercent: new Prisma.Decimal(input.defaultResidualPercent ?? "0"),
          assetAccountId: input.assetAccountId,
          accumulatedDepreciationAccountId: input.isDepreciable ? (input.accumulatedDepreciationAccountId ?? null) : null,
          depreciationExpenseAccountId: input.isDepreciable ? (input.depreciationExpenseAccountId ?? null) : null,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
      });
    });
    const created = (await this.get(id, actor.companyId))!;
    await this.audit.log({ actorId: actor.id, action: "fixed_asset_category.created", entityType: "FixedAssetCategory", entityId: id, after: { ...created }, correlationId });
    return created;
  }

  async update(id: string, input: UpdateAssetCategoryInput, actor: FixedAssetActor, correlationId: string): Promise<AssetCategorySummary> {
    const before = await this.get(id, actor.companyId);
    if (!before) throw new FixedAssetError("CATEGORY_NOT_FOUND", "Category not found");
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.fixedAssetCategory.findFirstOrThrow({ where: { id, companyId: actor.companyId } });
      const locked = (await this.lockedIds(tx, actor.companyId, [id])).has(id);
      const anyAsset = (await tx.fixedAsset.count({ where: { companyId: actor.companyId, categoryId: id } })) > 0;
      const isDepreciable = input.isDepreciable ?? existing.isDepreciable;
      const next = {
        isDepreciable,
        assetAccountId: input.assetAccountId ?? existing.assetAccountId,
        accumulatedDepreciationAccountId: isDepreciable
          ? input.accumulatedDepreciationAccountId !== undefined ? input.accumulatedDepreciationAccountId : existing.accumulatedDepreciationAccountId
          : null,
        depreciationExpenseAccountId: isDepreciable
          ? input.depreciationExpenseAccountId !== undefined ? input.depreciationExpenseAccountId : existing.depreciationExpenseAccountId
          : null,
      };
      const accountsChanged =
        next.isDepreciable !== existing.isDepreciable ||
        next.assetAccountId !== existing.assetAccountId ||
        next.accumulatedDepreciationAccountId !== existing.accumulatedDepreciationAccountId ||
        next.depreciationExpenseAccountId !== existing.depreciationExpenseAccountId;
      if (locked && accountsChanged) throw new FixedAssetError("CATEGORY_IN_USE", "Assets of this category are already in the ledger; its accounts can no longer change");
      const prefix = input.numberPrefix?.trim().toUpperCase();
      if (prefix !== undefined && prefix !== existing.numberPrefix) {
        if (anyAsset) throw new FixedAssetError("CATEGORY_IN_USE", "Assets of this category are already numbered; the prefix can no longer change");
        await this.assertUnique(tx, actor.companyId, null, prefix, id);
      }
      if (accountsChanged) await this.validateAccounts(tx, actor.companyId, next);
      await tx.fixedAssetCategory.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr?.trim() || null } : {}),
          ...(prefix !== undefined ? { numberPrefix: prefix } : {}),
          ...(input.defaultUsefulLifeMonths !== undefined || !isDepreciable ? { defaultUsefulLifeMonths: isDepreciable ? (input.defaultUsefulLifeMonths ?? existing.defaultUsefulLifeMonths) : null } : {}),
          ...(input.defaultResidualPercent !== undefined ? { defaultResidualPercent: new Prisma.Decimal(input.defaultResidualPercent) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...next,
          updatedBy: actor.id,
          version: { increment: 1 },
        },
      });
    });
    const after = (await this.get(id, actor.companyId))!;
    await this.audit.log({ actorId: actor.id, action: "fixed_asset_category.updated", entityType: "FixedAssetCategory", entityId: id, before: { ...before }, after: { ...after }, correlationId });
    return after;
  }

  private async lockedIds(db: TransactionClient | PrismaClient, companyId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await db.fixedAsset.groupBy({ by: ["categoryId"], where: { companyId, categoryId: { in: [...ids] }, status: { not: "DRAFT" } } });
    return new Set(rows.map((r) => r.categoryId));
  }

  private async assertUnique(tx: TransactionClient, companyId: string, code: string | null, prefix: string, exceptId: string | null): Promise<void> {
    if (code !== null) {
      const clash = await tx.fixedAssetCategory.findFirst({ where: { companyId, code: code.trim().toUpperCase() } });
      if (clash) throw new FixedAssetError("CATEGORY_CODE_TAKEN", "Another category already uses this code");
    }
    const prefixClash = await tx.fixedAssetCategory.findFirst({ where: { companyId, numberPrefix: prefix.trim().toUpperCase(), ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (prefixClash) throw new FixedAssetError("PREFIX_TAKEN", "Another category already uses this number prefix");
  }

  // Asset account: a postable asset with a debit balance. Accumulated depreciation: a postable contra-asset (type ASSET, normal
  // balance CREDIT — docs/05 §4). Expense: a postable expense account. All active and all different.
  private async validateAccounts(
    tx: TransactionClient,
    companyId: string,
    input: { readonly isDepreciable: boolean; readonly assetAccountId: string; readonly accumulatedDepreciationAccountId: string | null; readonly depreciationExpenseAccountId: string | null },
  ): Promise<void> {
    const ids = [input.assetAccountId, input.accumulatedDepreciationAccountId, input.depreciationExpenseAccountId].filter((x): x is string => !!x);
    const accounts = await tx.account.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, type: true, normalBalance: true, isPostable: true, isActive: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const ok = (id: string | null, type: string, balance: string): boolean => {
      const a = id ? byId.get(id) : undefined;
      return !!a && a.type === type && a.normalBalance === balance && a.isPostable && a.isActive;
    };
    if (!ok(input.assetAccountId, "ASSET", "DEBIT")) throw new FixedAssetError("ASSET_ACCOUNT_INVALID", "The asset account must be an active, postable asset account with a debit balance");
    if (!input.isDepreciable) return;
    if (!input.accumulatedDepreciationAccountId || !input.depreciationExpenseAccountId) {
      throw new FixedAssetError("DEPRECIABLE_NEEDS_ACCOUNTS", "A depreciable category needs an accumulated depreciation account and a depreciation expense account");
    }
    if (!ok(input.accumulatedDepreciationAccountId, "ASSET", "CREDIT")) {
      throw new FixedAssetError("ACCUMULATED_ACCOUNT_INVALID", "Accumulated depreciation must be an active, postable asset account with a credit (contra) balance");
    }
    if (!ok(input.depreciationExpenseAccountId, "EXPENSE", "DEBIT")) throw new FixedAssetError("EXPENSE_ACCOUNT_INVALID", "Depreciation expense must be an active, postable expense account");
    if (new Set(ids).size !== ids.length) throw new FixedAssetError("ACCOUNTS_NOT_DISTINCT", "The three accounts must all be different");
  }

  private summary(row: CategoryRow, isLocked: boolean): AssetCategorySummary {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      nameAr: row.nameAr,
      numberPrefix: row.numberPrefix,
      depreciationMethod: row.depreciationMethod,
      isDepreciable: row.isDepreciable,
      defaultUsefulLifeMonths: row.defaultUsefulLifeMonths,
      defaultResidualPercent: money(row.defaultResidualPercent),
      assetAccount: row.assetAccount,
      accumulatedDepreciationAccount: row.accumulatedDepreciationAccount,
      depreciationExpenseAccount: row.depreciationExpenseAccount,
      isActive: row.isActive,
      assetCount: row._count.assets,
      isLocked,
    };
  }
}
