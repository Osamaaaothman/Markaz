import { Prisma, type PrismaClient } from "@erp/db";
import { ZERO, capitalizationDateOf, day, money } from "./fixed-asset-common.js";

export interface RegisterRow {
  readonly assetId: string;
  readonly number: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryNameAr: string | null;
  readonly inServiceDate: string;
  readonly usefulLifeMonths: number | null;
  readonly cost: string;
  readonly accumulatedDepreciation: string;
  readonly netBookValue: string;
  readonly location: string | null;
  readonly custodianName: string | null;
}

export interface RegisterReport {
  readonly asOf: string;
  readonly currency: string;
  readonly rows: readonly RegisterRow[];
  readonly byCategory: readonly { readonly categoryId: string; readonly categoryName: string; readonly categoryNameAr: string | null; readonly count: number; readonly cost: string; readonly accumulatedDepreciation: string; readonly netBookValue: string }[];
  readonly totals: { readonly count: number; readonly cost: string; readonly accumulatedDepreciation: string; readonly netBookValue: string };
}

export interface MovementRow {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryNameAr: string | null;
  readonly costOpening: string;
  readonly costAdditions: string;
  readonly costDisposals: string;
  readonly costClosing: string;
  readonly depreciationOpening: string;
  // Depreciation brought in with assets registered at their opening balance during the period.
  readonly depreciationOnOpeningAssets: string;
  readonly depreciationCharge: string;
  readonly depreciationOnDisposals: string;
  readonly depreciationClosing: string;
  readonly netBookValueOpening: string;
  readonly netBookValueClosing: string;
}

export interface MovementReport {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly rows: readonly MovementRow[];
  readonly totals: Omit<MovementRow, "categoryId" | "categoryName" | "categoryNameAr">;
}

export interface ReconciliationRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountNameAr: string | null;
  readonly role: "COST" | "ACCUMULATED_DEPRECIATION";
  // Balance in the account's own normal direction (cost: debit; accumulated depreciation: credit).
  readonly registerAmount: string;
  readonly ledgerAmount: string;
  readonly difference: string;
}

export interface ReconciliationReport {
  readonly asOf: string;
  readonly currency: string;
  readonly rows: readonly ReconciliationRow[];
  readonly isReconciled: boolean;
}

interface AssetPosition {
  readonly cost: Prisma.Decimal;
  readonly accumulated: Prisma.Decimal;
  readonly inRegister: boolean;
}

const assetInclude = {
  category: { select: { id: true, name: true, nameAr: true, assetAccountId: true, accumulatedDepreciationAccountId: true } },
  custodian: { select: { name: true } },
  disposal: { select: { disposalDate: true, accumulatedAtDisposal: true, finalDepreciationAmount: true } },
  depreciationLines: { where: { run: { status: "POSTED" } }, select: { amount: true, run: { select: { runDate: true } } } },
} as const;

type AssetRow = Prisma.FixedAssetGetPayload<{ include: typeof assetInclude }>;

// Reports read the register's own documents (capitalisations, runs, disposals) by their ledger dates, so "as of" a date matches
// the general ledger at that date. The reconciliation report compares the two directly (docs/05 §7) and is the test harness
// every fixed-asset integration test ends with.
export class FixedAssetReportsService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(companyId: string, asOf: Date): Promise<RegisterReport> {
    const assets = await this.posted(companyId);
    const rows: RegisterRow[] = [];
    const cats = new Map<string, { categoryId: string; categoryName: string; categoryNameAr: string | null; count: number; cost: Prisma.Decimal; acc: Prisma.Decimal }>();
    for (const a of assets) {
      const p = this.position(a, asOf);
      if (!p.inRegister) continue;
      rows.push({
        assetId: a.id,
        number: a.number,
        name: a.name,
        nameAr: a.nameAr,
        categoryId: a.category.id,
        categoryName: a.category.name,
        categoryNameAr: a.category.nameAr,
        inServiceDate: day(a.inServiceDate)!,
        usefulLifeMonths: a.usefulLifeMonths,
        cost: money(p.cost),
        accumulatedDepreciation: money(p.accumulated),
        netBookValue: money(p.cost.minus(p.accumulated)),
        location: a.location,
        custodianName: a.custodian?.name ?? null,
      });
      const c = cats.get(a.category.id) ?? { categoryId: a.category.id, categoryName: a.category.name, categoryNameAr: a.category.nameAr, count: 0, cost: ZERO, acc: ZERO };
      cats.set(a.category.id, { ...c, count: c.count + 1, cost: c.cost.plus(p.cost), acc: c.acc.plus(p.accumulated) });
    }
    const byCategory = [...cats.values()].map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, categoryNameAr: c.categoryNameAr, count: c.count, cost: money(c.cost), accumulatedDepreciation: money(c.acc), netBookValue: money(c.cost.minus(c.acc)) }));
    const cost = [...cats.values()].reduce((s, c) => s.plus(c.cost), ZERO);
    const acc = [...cats.values()].reduce((s, c) => s.plus(c.acc), ZERO);
    return {
      asOf: day(asOf)!,
      currency: await this.currency(companyId),
      rows,
      byCategory,
      totals: { count: rows.length, cost: money(cost), accumulatedDepreciation: money(acc), netBookValue: money(cost.minus(acc)) },
    };
  }

  async movement(companyId: string, from: Date, to: Date): Promise<MovementReport> {
    const assets = await this.posted(companyId);
    const dayBefore = new Date(from.getTime() - 86_400_000);
    type Acc = { categoryId: string; categoryName: string; categoryNameAr: string | null; v: Record<string, Prisma.Decimal> };
    const keys = ["costOpening", "costAdditions", "costDisposals", "costClosing", "depreciationOpening", "depreciationOnOpeningAssets", "depreciationCharge", "depreciationOnDisposals", "depreciationClosing"] as const;
    const blank = (): Record<string, Prisma.Decimal> => Object.fromEntries(keys.map((k) => [k, ZERO]));
    const cats = new Map<string, Acc>();
    const within = (d: Date): boolean => d >= from && d <= to;
    for (const a of assets) {
      const c = cats.get(a.category.id) ?? { categoryId: a.category.id, categoryName: a.category.name, categoryNameAr: a.category.nameAr, v: blank() };
      const add = (k: (typeof keys)[number], amount: Prisma.Decimal): void => void (c.v[k] = c.v[k]!.plus(amount));
      const opening = this.position(a, dayBefore);
      const closing = this.position(a, to);
      if (opening.inRegister) {
        add("costOpening", opening.cost);
        add("depreciationOpening", opening.accumulated);
      }
      if (closing.inRegister) {
        add("costClosing", closing.cost);
        add("depreciationClosing", closing.accumulated);
      }
      const capitalized = capitalizationDateOf(a);
      if (within(capitalized)) {
        add("costAdditions", a.acquisitionCost);
        if (a.sourceType === "OPENING") add("depreciationOnOpeningAssets", a.openingAccumulatedDepreciation);
      }
      for (const l of a.depreciationLines) if (within(l.run.runDate)) add("depreciationCharge", l.amount);
      if (a.disposal && within(a.disposal.disposalDate)) {
        add("depreciationCharge", a.disposal.finalDepreciationAmount);
        add("costDisposals", a.acquisitionCost);
        add("depreciationOnDisposals", a.disposal.accumulatedAtDisposal);
      }
      cats.set(a.category.id, c);
    }
    const toRow = (v: Record<string, Prisma.Decimal>) => ({
      costOpening: money(v.costOpening!),
      costAdditions: money(v.costAdditions!),
      costDisposals: money(v.costDisposals!),
      costClosing: money(v.costClosing!),
      depreciationOpening: money(v.depreciationOpening!),
      depreciationOnOpeningAssets: money(v.depreciationOnOpeningAssets!),
      depreciationCharge: money(v.depreciationCharge!),
      depreciationOnDisposals: money(v.depreciationOnDisposals!),
      depreciationClosing: money(v.depreciationClosing!),
      netBookValueOpening: money(v.costOpening!.minus(v.depreciationOpening!)),
      netBookValueClosing: money(v.costClosing!.minus(v.depreciationClosing!)),
    });
    const totals = blank();
    for (const c of cats.values()) for (const k of keys) totals[k] = totals[k]!.plus(c.v[k]!);
    return {
      from: day(from)!,
      to: day(to)!,
      currency: await this.currency(companyId),
      rows: [...cats.values()].map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, categoryNameAr: c.categoryNameAr, ...toRow(c.v) })),
      totals: toRow(totals),
    };
  }

  // Register vs ledger, per account the categories use. A difference means something posted to those accounts outside this
  // module (a manual journal entry), or a defect; either way someone must look.
  async reconciliation(companyId: string, asOf: Date): Promise<ReconciliationReport> {
    const assets = await this.posted(companyId);
    const categories = await this.prisma.fixedAssetCategory.findMany({ where: { companyId }, select: { assetAccountId: true, accumulatedDepreciationAccountId: true } });
    const register = new Map<string, { role: ReconciliationRow["role"]; amount: Prisma.Decimal }>();
    const touch = (accountId: string, role: ReconciliationRow["role"]): void => {
      if (!register.has(accountId)) register.set(accountId, { role, amount: ZERO });
    };
    for (const c of categories) {
      touch(c.assetAccountId, "COST");
      if (c.accumulatedDepreciationAccountId) touch(c.accumulatedDepreciationAccountId, "ACCUMULATED_DEPRECIATION");
    }
    for (const a of assets) {
      const p = this.position(a, asOf);
      if (!p.inRegister) continue;
      const costRow = register.get(a.category.assetAccountId)!;
      costRow.amount = costRow.amount.plus(p.cost);
      if (a.category.accumulatedDepreciationAccountId) {
        const accRow = register.get(a.category.accumulatedDepreciationAccountId)!;
        accRow.amount = accRow.amount.plus(p.accumulated);
      }
    }
    const accountIds = [...register.keys()];
    const ledger = accountIds.length
      ? await this.prisma.$queryRaw<{ account_id: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
          SELECT l.account_id, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
          FROM journal_entry_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          WHERE e.company_id = ${companyId} AND e.entry_date <= ${asOf} AND l.account_id = ANY(${accountIds}::text[])
          GROUP BY l.account_id`
      : [];
    const ledgerById = new Map(ledger.map((r) => [r.account_id, new Prisma.Decimal(r.debit).minus(r.credit)]));
    const accounts = await this.prisma.account.findMany({ where: { companyId, id: { in: accountIds } }, select: { id: true, code: true, name: true, nameAr: true } });
    const rows: ReconciliationRow[] = accounts
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((acc) => {
        const reg = register.get(acc.id)!;
        const net = ledgerById.get(acc.id) ?? ZERO;
        const ledgerAmount = reg.role === "COST" ? net : net.negated();
        return {
          accountId: acc.id,
          accountCode: acc.code,
          accountName: acc.name,
          accountNameAr: acc.nameAr,
          role: reg.role,
          registerAmount: money(reg.amount),
          ledgerAmount: money(ledgerAmount),
          difference: money(ledgerAmount.minus(reg.amount)),
        };
      });
    return { asOf: day(asOf)!, currency: await this.currency(companyId), rows, isReconciled: rows.every((r) => new Prisma.Decimal(r.difference).isZero()) };
  }

  private posted(companyId: string): Promise<AssetRow[]> {
    return this.prisma.fixedAsset.findMany({ where: { companyId, status: { not: "DRAFT" } }, include: assetInclude, orderBy: { number: "asc" } });
  }

  private async currency(companyId: string): Promise<string> {
    return (await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } })).defaultCurrency;
  }

  // Where one asset stands at the end of `asOf`, built from its dated documents only.
  private position(a: AssetRow, asOf: Date): AssetPosition {
    if (capitalizationDateOf(a) > asOf) return { cost: ZERO, accumulated: ZERO, inRegister: false };
    if (a.disposal && a.disposal.disposalDate <= asOf) return { cost: ZERO, accumulated: ZERO, inRegister: false };
    let accumulated = a.sourceType === "OPENING" ? a.openingAccumulatedDepreciation : ZERO;
    for (const l of a.depreciationLines) if (l.run.runDate <= asOf) accumulated = accumulated.plus(l.amount);
    return { cost: a.acquisitionCost, accumulated, inRegister: true };
  }
}
