import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod } from "../accounting/fiscal-period.util.js";
import type { AccountMappingService } from "../inventory/account-mapping.service.js";
import { depreciationWindow, projectedSchedule, type ScheduleRow } from "./depreciation.js";
import {
  FixedAssetError,
  ZERO,
  allocateAssetNumber,
  day,
  lockAssets,
  minorUnitDigits,
  money,
  profileOf,
  rethrowProfileError,
  type FixedAssetActor,
} from "./fixed-asset-common.js";

export type FixedAssetStatus = "DRAFT" | "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";

export interface FixedAssetDetailsInput {
  readonly name: string;
  readonly nameAr?: string | null;
  readonly description?: string | null;
  readonly categoryId: string;
  readonly acquisitionDate: Date;
  readonly inServiceDate: Date;
  readonly acquisitionCost: string;
  readonly residualValue?: string | null; // null/omitted: the category's default percentage of the cost
  readonly usefulLifeMonths?: number | null; // null/omitted: the category's default
  readonly supplierPartyId?: string | null;
  readonly custodianEmployeeId?: string | null;
  readonly costCenterId?: string | null;
  readonly location?: string | null;
  readonly serialNumber?: string | null;
  readonly barcode?: string | null;
}

export interface OpeningAssetInput extends FixedAssetDetailsInput {
  readonly openingAccumulatedDepreciation: string;
  readonly openingAsOfDate: Date;
}

// What may change on an asset already in the ledger: descriptive fields only. Where it is and who holds it change through a transfer.
export interface FixedAssetInfoInput {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly description?: string | null;
  readonly supplierPartyId?: string | null;
  readonly serialNumber?: string | null;
  readonly barcode?: string | null;
}

export interface TransferInput {
  readonly transferDate: Date;
  readonly location?: string | null;
  readonly custodianEmployeeId?: string | null;
  readonly costCenterId?: string | null;
  readonly reason?: string | null;
}

export interface FixedAssetListQuery {
  readonly status?: FixedAssetStatus;
  readonly categoryId?: string;
  readonly custodianEmployeeId?: string;
  readonly costCenterId?: string;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

interface Ref {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

export interface FixedAssetSummary {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly status: FixedAssetStatus;
  readonly category: Ref;
  readonly acquisitionDate: string;
  readonly inServiceDate: string;
  readonly acquisitionCost: string;
  readonly residualValue: string;
  readonly usefulLifeMonths: number | null;
  readonly accumulatedDepreciation: string;
  readonly netBookValue: string;
  readonly depreciatedThrough: string | null;
  readonly currency: string;
  readonly sourceType: string;
  readonly custodian: { readonly id: string; readonly ref: string; readonly name: string; readonly nameAr: string | null } | null;
  readonly costCenter: Ref | null;
  readonly location: string | null;
}

export interface FixedAssetListPage {
  readonly items: readonly FixedAssetSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totals: { readonly acquisitionCost: string; readonly accumulatedDepreciation: string; readonly netBookValue: string };
}

export interface FixedAssetDetail extends FixedAssetSummary {
  readonly description: string | null;
  readonly depreciationMethod: string;
  readonly isDepreciable: boolean;
  readonly openingAccumulatedDepreciation: string;
  readonly openingAsOfDate: string | null;
  readonly lastDepreciationDay: string | null;
  readonly serialNumber: string | null;
  readonly barcode: string | null;
  readonly supplier: { readonly id: string; readonly ref: string; readonly name: string } | null;
  readonly sourceAccount: Ref | null;
  readonly capitalizationJournalEntryId: string | null;
  readonly capitalizedAt: string | null;
  readonly supplierInvoiceId: string | null;
  readonly disposal: {
    readonly id: string;
    readonly number: string;
    readonly disposalDate: string;
    readonly disposalType: string;
    readonly gainLoss: string;
    readonly finalDepreciationAmount: string;
    readonly reason: string;
    readonly journalEntryId: string;
  } | null;
  readonly depreciationHistory: readonly {
    readonly runId: string;
    readonly runNumber: string;
    readonly periodYear: number;
    readonly periodMonth: number;
    readonly fromDate: string;
    readonly toDate: string;
    readonly days: number;
    readonly amount: string;
    readonly accumulatedAfter: string;
    readonly netBookValueAfter: string;
    readonly isCatchUp: boolean;
    readonly journalEntryId: string;
  }[];
  readonly projectedSchedule: readonly ScheduleRow[];
  readonly transfers: readonly {
    readonly id: string;
    readonly transferDate: string;
    readonly fromLocation: string | null;
    readonly toLocation: string | null;
    readonly fromCustodian: string | null;
    readonly toCustodian: string | null;
    readonly fromCostCenter: string | null;
    readonly toCostCenter: string | null;
    readonly reason: string | null;
  }[];
  readonly version: number;
}

export interface PostedAssetResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
}

const listInclude = {
  category: { select: { id: true, code: true, name: true, nameAr: true, isDepreciable: true } },
  custodian: { select: { id: true, ref: true, name: true, nameAr: true } },
  costCenter: { select: { id: true, code: true, name: true, nameAr: true } },
} as const;

type ListRow = Prisma.FixedAssetGetPayload<{ include: typeof listInclude }>;

// The fixed-asset register. A DRAFT asset is a form being filled in. Capitalising it (or registering an opening asset) posts its
// cost to the ledger through the accounting engine in the same transaction (docs/02 §5); from then on its money fields never
// change — corrections go through disposal or a reversing run, never an edit (docs/05 §2).
export class FixedAssetService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, query: FixedAssetListQuery = {}): Promise<FixedAssetListPage> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
    const search = query.search?.trim();
    const where: Prisma.FixedAssetWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.custodianEmployeeId ? { custodianEmployeeId: query.custodianEmployeeId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { nameAr: { contains: search, mode: "insensitive" } },
              { serialNumber: { contains: search, mode: "insensitive" } },
              { barcode: { contains: search, mode: "insensitive" } },
              { location: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.fixedAsset.findMany({ where, include: listInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.fixedAsset.count({ where }),
      // Disposed assets and drafts are not part of the book value of the register.
      this.prisma.fixedAsset.aggregate({ where: { ...where, status: { in: query.status && ["DRAFT", "DISPOSED"].includes(query.status) ? [] : ["ACTIVE", "FULLY_DEPRECIATED"] } }, _sum: { acquisitionCost: true, accumulatedDepreciation: true } }),
    ]);
    const cost = sums._sum.acquisitionCost ?? ZERO;
    const acc = sums._sum.accumulatedDepreciation ?? ZERO;
    return {
      items: rows.map((r) => this.summary(r)),
      total,
      page,
      pageSize,
      totals: { acquisitionCost: money(cost), accumulatedDepreciation: money(acc), netBookValue: money(cost.minus(acc)) },
    };
  }

  async get(id: string, companyId: string): Promise<FixedAssetDetail | null> {
    const row = await this.prisma.fixedAsset.findFirst({
      where: { id, companyId },
      include: {
        ...listInclude,
        supplier: { select: { id: true, ref: true, name: true } },
        sourceAccount: { select: { id: true, code: true, name: true, nameAr: true } },
        supplierInvoiceLine: { select: { supplierInvoiceId: true } },
        disposal: true,
        depreciationLines: { include: { run: { select: { id: true, number: true, periodYear: true, periodMonth: true, status: true, journalEntryId: true } } }, orderBy: { fromDate: "asc" } },
        transfers: { orderBy: [{ transferDate: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!row) return null;
    const digits = await minorUnitDigits(this.prisma, row.currency);
    let projected: ScheduleRow[] = [];
    let lastDepreciationDay: string | null = null;
    try {
      const profile = profileOf(row, row.category.isDepreciable, digits);
      projected = projectedSchedule(profile);
      const window = depreciationWindow(profile);
      lastDepreciationDay = window ? day(window.lastDay) : null;
    } catch {
      // A draft can hold numbers the calculator rejects (residual above cost while typing); it simply has no schedule yet.
    }
    const people = await this.namesFor(companyId, row.transfers);
    return {
      ...this.summary(row),
      description: row.description,
      depreciationMethod: row.depreciationMethod,
      isDepreciable: row.category.isDepreciable,
      openingAccumulatedDepreciation: money(row.openingAccumulatedDepreciation),
      openingAsOfDate: day(row.openingAsOfDate),
      lastDepreciationDay,
      serialNumber: row.serialNumber,
      barcode: row.barcode,
      supplier: row.supplier,
      sourceAccount: row.sourceAccount,
      capitalizationJournalEntryId: row.capitalizationJournalEntryId,
      capitalizedAt: row.capitalizedAt?.toISOString() ?? null,
      supplierInvoiceId: row.supplierInvoiceLine?.supplierInvoiceId ?? null,
      disposal: row.disposal
        ? {
            id: row.disposal.id,
            number: row.disposal.number,
            disposalDate: day(row.disposal.disposalDate)!,
            disposalType: row.disposal.disposalType,
            gainLoss: money(row.disposal.gainLoss),
            finalDepreciationAmount: money(row.disposal.finalDepreciationAmount),
            reason: row.disposal.reason,
            journalEntryId: row.disposal.journalEntryId,
          }
        : null,
      depreciationHistory: row.depreciationLines
        .filter((l) => l.run.status === "POSTED")
        .map((l) => ({
          runId: l.run.id,
          runNumber: l.run.number,
          periodYear: l.run.periodYear,
          periodMonth: l.run.periodMonth,
          fromDate: day(l.fromDate)!,
          toDate: day(l.toDate)!,
          days: l.days,
          amount: money(l.amount),
          accumulatedAfter: money(l.accumulatedAfter),
          netBookValueAfter: money(l.netBookValueAfter),
          isCatchUp: l.isCatchUp,
          journalEntryId: l.run.journalEntryId,
        })),
      projectedSchedule: projected,
      transfers: row.transfers.map((t) => ({
        id: t.id,
        transferDate: day(t.transferDate)!,
        fromLocation: t.fromLocation,
        toLocation: t.toLocation,
        fromCustodian: t.fromCustodianEmployeeId ? (people.employees.get(t.fromCustodianEmployeeId) ?? null) : null,
        toCustodian: t.toCustodianEmployeeId ? (people.employees.get(t.toCustodianEmployeeId) ?? null) : null,
        fromCostCenter: t.fromCostCenterId ? (people.costCenters.get(t.fromCostCenterId) ?? null) : null,
        toCostCenter: t.toCostCenterId ? (people.costCenters.get(t.toCostCenterId) ?? null) : null,
        reason: t.reason,
      })),
      version: row.version,
    };
  }

  async createDraft(input: FixedAssetDetailsInput, actor: FixedAssetActor, correlationId: string): Promise<FixedAssetSummary> {
    const id = newId();
    await this.prisma.$transaction(async (tx) => {
      const data = await this.resolveDetails(tx, actor.companyId, input);
      const number = await allocateAssetNumber(tx, actor.companyId, data.category.id, data.category.numberPrefix);
      await tx.fixedAsset.create({ data: { id, companyId: actor.companyId, number, status: "DRAFT", sourceType: "MANUAL", ...data.fields, createdBy: actor.id, updatedBy: actor.id } });
    });
    const created = (await this.get(id, actor.companyId))!;
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.draft_created", entityType: "FixedAsset", entityId: id, after: this.auditView(created), correlationId });
    return created;
  }

  async updateDraft(id: string, input: FixedAssetDetailsInput, actor: FixedAssetActor, correlationId: string): Promise<FixedAssetSummary> {
    const before = await this.get(id, actor.companyId);
    if (!before) throw new FixedAssetError("ASSET_NOT_FOUND", "Asset not found");
    await this.prisma.$transaction(async (tx) => {
      await lockAssets(tx, actor.companyId, [id]);
      const current = await tx.fixedAsset.findFirstOrThrow({ where: { id, companyId: actor.companyId } });
      if (current.status !== "DRAFT") throw new FixedAssetError("ASSET_NOT_DRAFT", "Only a draft asset can be edited this way");
      const data = await this.resolveDetails(tx, actor.companyId, input);
      // Moving a draft to another category gives it a number in that category's series.
      const number = data.category.id === current.categoryId ? current.number : await allocateAssetNumber(tx, actor.companyId, data.category.id, data.category.numberPrefix);
      await tx.fixedAsset.update({ where: { id }, data: { ...data.fields, number, updatedBy: actor.id, version: { increment: 1 } } });
    });
    const after = (await this.get(id, actor.companyId))!;
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.draft_updated", entityType: "FixedAsset", entityId: id, before: this.auditView(before), after: this.auditView(after), correlationId });
    return after;
  }

  async deleteDraft(id: string, actor: FixedAssetActor, correlationId: string): Promise<void> {
    const before = await this.get(id, actor.companyId);
    if (!before) throw new FixedAssetError("ASSET_NOT_FOUND", "Asset not found");
    await this.prisma.$transaction(async (tx) => {
      await lockAssets(tx, actor.companyId, [id]);
      const current = await tx.fixedAsset.findFirstOrThrow({ where: { id, companyId: actor.companyId } });
      if (current.status !== "DRAFT") throw new FixedAssetError("ASSET_NOT_DRAFT", "Only a draft asset can be deleted; an asset in the ledger is disposed of instead");
      await tx.fixedAsset.delete({ where: { id } });
    });
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.draft_deleted", entityType: "FixedAsset", entityId: id, before: this.auditView(before), correlationId });
  }

  async updateInfo(id: string, input: FixedAssetInfoInput, actor: FixedAssetActor, correlationId: string): Promise<FixedAssetSummary> {
    const before = await this.get(id, actor.companyId);
    if (!before) throw new FixedAssetError("ASSET_NOT_FOUND", "Asset not found");
    await this.prisma.$transaction(async (tx) => {
      if (input.supplierPartyId) await this.assertParty(tx, actor.companyId, input.supplierPartyId);
      await tx.fixedAsset.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr?.trim() || null } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.supplierPartyId !== undefined ? { supplierPartyId: input.supplierPartyId || null } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber?.trim() || null } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode?.trim() || null } : {}),
          updatedBy: actor.id,
          version: { increment: 1 },
        },
      });
    });
    const after = (await this.get(id, actor.companyId))!;
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.info_updated", entityType: "FixedAsset", entityId: id, before: this.auditView(before), after: this.auditView(after), correlationId });
    return after;
  }

  // DRAFT -> ACTIVE: Dr the category's asset account / Cr the account the asset was paid from (bank, cash, a supplier's
  // account, assets under construction...). The amount is the net cost: purchases carrying VAT go through a supplier invoice
  // instead (ruling D-FA-6 = A), so input VAT is only ever recorded in one place.
  async capitalize(id: string, sourceAccountId: string, actor: FixedAssetActor, correlationId: string, idempotencyKey: string): Promise<PostedAssetResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockAssets(tx, actor.companyId, [id]);
      const asset = await tx.fixedAsset.findFirst({ where: { id, companyId: actor.companyId }, include: { category: true } });
      if (!asset) throw new FixedAssetError("ASSET_NOT_FOUND", "Asset not found");
      if (asset.status !== "DRAFT") throw new FixedAssetError("ASSET_NOT_DRAFT", "This asset is already in the ledger");
      if (!asset.category.isActive) throw new FixedAssetError("CATEGORY_INACTIVE", "The asset's category is inactive");
      const digits = await minorUnitDigits(tx, asset.currency);
      try {
        depreciationWindow(profileOf(asset, asset.category.isDepreciable, digits));
      } catch (error) {
        rethrowProfileError(error);
      }
      const forbidden = [asset.category.assetAccountId, asset.category.accumulatedDepreciationAccountId, asset.category.depreciationExpenseAccountId];
      const source = await tx.account.findFirst({ where: { id: sourceAccountId, companyId: actor.companyId, isPostable: true, isActive: true } });
      if (!source || forbidden.includes(source.id)) throw new FixedAssetError("SOURCE_ACCOUNT_INVALID", "Choose an active postable account other than this category's own accounts");
      const period = await findOpenFiscalPeriod(tx, actor.companyId, asset.acquisitionDate);
      if (!period) throw new FixedAssetError("NO_OPEN_PERIOD", "No open fiscal period covers the acquisition date");
      const lines: JournalLineInput[] = [
        { accountId: asset.category.assetAccountId, debit: money(asset.acquisitionCost), description: `Fixed asset ${asset.number} -- ${asset.name}`, ...(asset.costCenterId ? { costCenterId: asset.costCenterId } : {}) },
        { accountId: source.id, credit: money(asset.acquisitionCost), description: `Fixed asset ${asset.number} -- ${asset.name}` },
      ];
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: asset.acquisitionDate,
          postingDate: asset.acquisitionDate,
          currency: asset.currency,
          lines,
          sourceModule: "fixed-assets",
          sourceDocumentType: "fixed_asset_capitalization",
          sourceDocumentId: asset.id,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );
      await tx.fixedAsset.update({
        where: { id },
        data: { status: "ACTIVE", sourceAccountId: source.id, capitalizationJournalEntryId: posting.journalEntryId, capitalizedAt: new Date(), updatedBy: actor.id, version: { increment: 1 } },
      });
      return { id, number: asset.number, journalEntryId: posting.journalEntryId, cost: money(asset.acquisitionCost) };
    });
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.capitalized", entityType: "FixedAsset", entityId: id, after: { number: result.number, cost: result.cost, sourceAccountId, journalEntryId: result.journalEntryId }, correlationId });
    return { id: result.id, number: result.number, journalEntryId: result.journalEntryId };
  }

  // An asset the company already owned before using this system, with the depreciation already taken on it, posted on the
  // opening-balance date: Dr asset account (cost) / Cr accumulated depreciation (taken so far) / Cr opening balance equity (book value).
  // REVIEW: the remaining life is spread over the days left of the original life (cost - residual - taken so far); an accountant
  // should confirm this treatment for assets whose prior depreciation followed a different method.
  async registerOpening(input: OpeningAssetInput, actor: FixedAssetActor, correlationId: string, idempotencyKey: string): Promise<PostedAssetResult> {
    const id = newId();
    const result = await this.prisma.$transaction(async (tx) => {
      const data = await this.resolveDetails(tx, actor.companyId, input);
      const category = data.category;
      const opening = new Prisma.Decimal(input.openingAccumulatedDepreciation);
      if (opening.lessThan(0)) throw new FixedAssetError("OPENING_EXCEEDS_DEPRECIABLE", "Opening depreciation cannot be negative");
      if (opening.greaterThan(0) && !category.isDepreciable) throw new FixedAssetError("OPENING_ON_NON_DEPRECIABLE", "This category does not depreciate, so it cannot carry opening depreciation");
      if (input.openingAsOfDate < input.acquisitionDate) throw new FixedAssetError("IN_SERVICE_BEFORE_ACQUISITION", "The opening-balance date cannot be before the acquisition date");
      const digits = await minorUnitDigits(tx, data.fields.currency);
      const profile = profileOf({ ...data.fields, openingAccumulatedDepreciation: opening, openingAsOfDate: input.openingAsOfDate }, category.isDepreciable, digits);
      let window;
      try {
        window = depreciationWindow(profile);
      } catch (error) {
        rethrowProfileError(error);
      }
      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.openingAsOfDate);
      if (!period) throw new FixedAssetError("NO_OPEN_PERIOD", "No open fiscal period covers the opening-balance date");
      const equityAccount = await this.accountMappings.resolve(tx, actor.companyId, "OPENING_BALANCE_EQUITY");
      const cost = data.fields.acquisitionCost;
      const bookValue = cost.minus(opening);
      const number = await allocateAssetNumber(tx, actor.companyId, category.id, category.numberPrefix);
      const label = `Opening fixed asset ${number} -- ${data.fields.name}`;
      const lines: JournalLineInput[] = [
        { accountId: category.assetAccountId, debit: money(cost), description: label, ...(data.fields.costCenterId ? { costCenterId: data.fields.costCenterId } : {}) },
        ...(opening.greaterThan(0) ? [{ accountId: category.accumulatedDepreciationAccountId!, credit: money(opening), description: label }] : []),
        ...(bookValue.greaterThan(0) ? [{ accountId: equityAccount, credit: money(bookValue), description: label }] : []),
      ];
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.openingAsOfDate,
          postingDate: input.openingAsOfDate,
          currency: data.fields.currency,
          lines,
          sourceModule: "fixed-assets",
          sourceDocumentType: "fixed_asset_opening",
          sourceDocumentId: id,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );
      const fully = window ? opening.greaterThanOrEqualTo(window.depreciableAmount) : false;
      await tx.fixedAsset.create({
        data: {
          id,
          companyId: actor.companyId,
          number,
          status: fully ? "FULLY_DEPRECIATED" : "ACTIVE",
          sourceType: "OPENING",
          ...data.fields,
          openingAccumulatedDepreciation: opening,
          openingAsOfDate: input.openingAsOfDate,
          accumulatedDepreciation: opening,
          depreciatedThrough: input.openingAsOfDate,
          capitalizationJournalEntryId: posting.journalEntryId,
          capitalizedAt: new Date(),
          createdBy: actor.id,
          updatedBy: actor.id,
        },
      });
      return { id, number, journalEntryId: posting.journalEntryId, cost: money(cost), opening: money(opening) };
    });
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.opening_registered", entityType: "FixedAsset", entityId: id, after: { ...result }, correlationId });
    return { id: result.id, number: result.number, journalEntryId: result.journalEntryId };
  }

  // Moves an asset to another place, holder or cost center. No ledger effect: depreciation from the next run on is charged to the
  // new cost center. History is insert-only.
  async transfer(id: string, input: TransferInput, actor: FixedAssetActor, correlationId: string): Promise<FixedAssetSummary> {
    const transferId = newId();
    await this.prisma.$transaction(async (tx) => {
      await lockAssets(tx, actor.companyId, [id]);
      const asset = await tx.fixedAsset.findFirst({ where: { id, companyId: actor.companyId } });
      if (!asset) throw new FixedAssetError("ASSET_NOT_FOUND", "Asset not found");
      if (asset.status !== "ACTIVE" && asset.status !== "FULLY_DEPRECIATED") throw new FixedAssetError("ASSET_NOT_IN_SERVICE", "Only an asset in service can be transferred");
      const to = {
        location: input.location !== undefined ? input.location?.trim() || null : asset.location,
        custodianEmployeeId: input.custodianEmployeeId !== undefined ? input.custodianEmployeeId || null : asset.custodianEmployeeId,
        costCenterId: input.costCenterId !== undefined ? input.costCenterId || null : asset.costCenterId,
      };
      if (to.custodianEmployeeId) await this.assertEmployee(tx, actor.companyId, to.custodianEmployeeId);
      if (to.costCenterId) await this.assertCostCenter(tx, actor.companyId, to.costCenterId);
      if (to.location === asset.location && to.custodianEmployeeId === asset.custodianEmployeeId && to.costCenterId === asset.costCenterId) {
        throw new FixedAssetError("NOTHING_CHANGED", "The transfer changes nothing");
      }
      await tx.fixedAssetTransfer.create({
        data: {
          id: transferId,
          companyId: actor.companyId,
          assetId: id,
          transferDate: input.transferDate,
          fromLocation: asset.location,
          toLocation: to.location,
          fromCustodianEmployeeId: asset.custodianEmployeeId,
          toCustodianEmployeeId: to.custodianEmployeeId,
          fromCostCenterId: asset.costCenterId,
          toCostCenterId: to.costCenterId,
          reason: input.reason?.trim() || null,
          actorId: actor.id,
        },
      });
      await tx.fixedAsset.update({ where: { id }, data: { ...to, updatedBy: actor.id, version: { increment: 1 } } });
    });
    const after = (await this.get(id, actor.companyId))!;
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.transferred", entityType: "FixedAsset", entityId: id, after: { transferId, location: after.location, custodian: after.custodian?.id ?? null, costCenter: after.costCenter?.id ?? null }, correlationId });
    return after;
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────

  private async resolveDetails(tx: TransactionClient, companyId: string, input: FixedAssetDetailsInput) {
    const category = await tx.fixedAssetCategory.findFirst({ where: { id: input.categoryId, companyId } });
    if (!category) throw new FixedAssetError("CATEGORY_NOT_FOUND", "Category not found");
    if (!category.isActive) throw new FixedAssetError("CATEGORY_INACTIVE", "The category is inactive");
    if (input.inServiceDate < input.acquisitionDate) throw new FixedAssetError("IN_SERVICE_BEFORE_ACQUISITION", "The in-service date cannot be before the acquisition date");
    if (input.supplierPartyId) await this.assertParty(tx, companyId, input.supplierPartyId);
    if (input.custodianEmployeeId) await this.assertEmployee(tx, companyId, input.custodianEmployeeId);
    if (input.costCenterId) await this.assertCostCenter(tx, companyId, input.costCenterId);
    const currency = await companyCurrency(tx, companyId);
    const digits = await minorUnitDigits(tx, currency);
    const cost = new Prisma.Decimal(input.acquisitionCost);
    const residual =
      input.residualValue !== undefined && input.residualValue !== null
        ? new Prisma.Decimal(input.residualValue)
        : cost.times(category.defaultResidualPercent).div(100).toDecimalPlaces(digits, Prisma.Decimal.ROUND_HALF_UP);
    if (residual.greaterThan(cost) || residual.lessThan(0)) throw new FixedAssetError("RESIDUAL_EXCEEDS_COST", "The residual value must be between zero and the cost");
    const usefulLifeMonths = category.isDepreciable ? (input.usefulLifeMonths ?? category.defaultUsefulLifeMonths) : null;
    if (category.isDepreciable && !usefulLifeMonths) throw new FixedAssetError("LIFE_REQUIRED", "A depreciable asset needs a useful life");
    return {
      category,
      fields: {
        name: input.name.trim(),
        nameAr: input.nameAr?.trim() || null,
        description: input.description?.trim() || null,
        categoryId: category.id,
        acquisitionDate: input.acquisitionDate,
        inServiceDate: input.inServiceDate,
        acquisitionCost: cost,
        residualValue: residual,
        usefulLifeMonths,
        depreciationMethod: category.depreciationMethod,
        openingAccumulatedDepreciation: ZERO,
        openingAsOfDate: null as Date | null,
        currency,
        supplierPartyId: input.supplierPartyId || null,
        custodianEmployeeId: input.custodianEmployeeId || null,
        costCenterId: input.costCenterId || null,
        location: input.location?.trim() || null,
        serialNumber: input.serialNumber?.trim() || null,
        barcode: input.barcode?.trim() || null,
      },
    };
  }

  private async assertParty(tx: TransactionClient, companyId: string, id: string): Promise<void> {
    if (!(await tx.party.findFirst({ where: { id, companyId }, select: { id: true } }))) throw new FixedAssetError("SUPPLIER_NOT_FOUND", "Supplier not found");
  }

  private async assertEmployee(tx: TransactionClient, companyId: string, id: string): Promise<void> {
    if (!(await tx.employee.findFirst({ where: { id, companyId }, select: { id: true } }))) throw new FixedAssetError("EMPLOYEE_NOT_FOUND", "Employee not found");
  }

  private async assertCostCenter(tx: TransactionClient, companyId: string, id: string): Promise<void> {
    if (!(await tx.costCenter.findFirst({ where: { id, companyId, isActive: true }, select: { id: true } }))) throw new FixedAssetError("COST_CENTER_NOT_FOUND", "Cost center not found or inactive");
  }

  private async namesFor(companyId: string, transfers: readonly { fromCustodianEmployeeId: string | null; toCustodianEmployeeId: string | null; fromCostCenterId: string | null; toCostCenterId: string | null }[]) {
    const employeeIds = [...new Set(transfers.flatMap((t) => [t.fromCustodianEmployeeId, t.toCustodianEmployeeId]).filter((x): x is string => !!x))];
    const centerIds = [...new Set(transfers.flatMap((t) => [t.fromCostCenterId, t.toCostCenterId]).filter((x): x is string => !!x))];
    const [employees, centers] = await Promise.all([
      employeeIds.length ? this.prisma.employee.findMany({ where: { companyId, id: { in: employeeIds } }, select: { id: true, name: true } }) : [],
      centerIds.length ? this.prisma.costCenter.findMany({ where: { companyId, id: { in: centerIds } }, select: { id: true, code: true, name: true } }) : [],
    ]);
    return {
      employees: new Map(employees.map((e) => [e.id, e.name])),
      costCenters: new Map(centers.map((c) => [c.id, `${c.code} ${c.name}`])),
    };
  }

  private summary(row: ListRow): FixedAssetSummary {
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      nameAr: row.nameAr,
      status: row.status as FixedAssetStatus,
      category: { id: row.category.id, code: row.category.code, name: row.category.name, nameAr: row.category.nameAr },
      acquisitionDate: day(row.acquisitionDate)!,
      inServiceDate: day(row.inServiceDate)!,
      acquisitionCost: money(row.acquisitionCost),
      residualValue: money(row.residualValue),
      usefulLifeMonths: row.usefulLifeMonths,
      accumulatedDepreciation: money(row.accumulatedDepreciation),
      netBookValue: money(row.acquisitionCost.minus(row.accumulatedDepreciation)),
      depreciatedThrough: day(row.depreciatedThrough),
      currency: row.currency,
      sourceType: row.sourceType,
      custodian: row.custodian,
      costCenter: row.costCenter,
      location: row.location,
    };
  }

  private auditView(asset: FixedAssetSummary): Record<string, unknown> {
    return {
      number: asset.number,
      name: asset.name,
      status: asset.status,
      categoryId: asset.category.id,
      acquisitionDate: asset.acquisitionDate,
      inServiceDate: asset.inServiceDate,
      acquisitionCost: asset.acquisitionCost,
      residualValue: asset.residualValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      location: asset.location,
      custodianId: asset.custodian?.id ?? null,
      costCenterId: asset.costCenter?.id ?? null,
    };
  }
}
