import { Prisma } from "@erp/db";

// Weighted-average inventory valuation — docs/01-OPEN-DECISIONS.md A3 (decided). Pure and
// framework-free, tested before any service calls it (docs/10-TESTING-RULES.md §1: domain
// invariants come first). The ONLY state kept per item+warehouse is quantity and value
// (ItemWarehouseStock) — never a separately-stored rounded "average cost" column, so this
// module is the single source of truth for every derived number and the sub-ledger
// (Σ item_warehouse_stock.value) can never drift from what posted to the Inventory control
// account by accumulated rounding (docs/05-ACCOUNTING-INTEGRITY-RULES.md §7 gate).

const VALUE_DECIMALS = 4;

export class InsufficientStockError extends Error {}

export interface StockState {
  readonly quantity: Prisma.Decimal;
  readonly value: Prisma.Decimal;
}

function toDecimal(input: Prisma.Decimal | string): Prisma.Decimal {
  return input instanceof Prisma.Decimal ? input : new Prisma.Decimal(input);
}

// value / quantity — the derived average cost. Zero (never divides by zero) when nothing is
// on hand; callers that need a real cost at zero quantity (a receipt, or a count surplus from
// nothing) supply their own, they never ask this function for one.
export function averageUnitCost(state: StockState): Prisma.Decimal {
  if (state.quantity.isZero()) return new Prisma.Decimal(0);
  return state.value.dividedBy(state.quantity);
}

// A receipt simply adds to both totals — this is what keeps the average "weighted": the
// existing pool and the new quantity blend by value, not by a naive average of unit costs.
export function applyReceipt(
  state: StockState,
  quantity: Prisma.Decimal | string,
  unitCost: Prisma.Decimal | string,
): StockState {
  const qty = toDecimal(quantity);
  const cost = toDecimal(unitCost);
  if (!qty.greaterThan(0)) throw new RangeError(`Receipt quantity must be positive, got ${qty.toFixed()}`);
  if (cost.lessThan(0)) throw new RangeError(`Receipt unit cost cannot be negative, got ${cost.toFixed()}`);

  const addedValue = qty.times(cost).toDecimalPlaces(VALUE_DECIMALS);
  return { quantity: state.quantity.plus(qty), value: state.value.plus(addedValue) };
}

export interface IssueResult {
  readonly state: StockState;
  // The cost actually charged to this issue — unitCost * value (both already rounded to the
  // column's 4 decimal places), stored on the issue line exactly as computed here, never
  // recomputed later (docs/04-DATA-MODEL-RULES.md §2 principle).
  readonly unitCost: Prisma.Decimal;
  readonly value: Prisma.Decimal;
}

// No negative stock (docs/01-OPEN-DECISIONS.md A3 decision) — throws rather than letting a
// caller silently overdraw; item_warehouse_stock's own CHECK is the database-level backstop
// for a concurrent race this function cannot see (docs/05 §9 principle).
export function applyIssue(state: StockState, quantity: Prisma.Decimal | string): IssueResult {
  const qty = toDecimal(quantity);
  if (!qty.greaterThan(0)) throw new RangeError(`Issue quantity must be positive, got ${qty.toFixed()}`);
  if (qty.greaterThan(state.quantity)) {
    throw new InsufficientStockError(
      `Cannot issue ${qty.toFixed()} — only ${state.quantity.toFixed()} on hand`,
    );
  }

  const remainingQuantity = state.quantity.minus(qty);
  // Issuing the entire remaining quantity takes the entire remaining value, rather than
  // qty * the rounded average — the two are not always exactly equal (the average itself
  // carries more precision than the 4 decimal places a line can store), and this is what
  // guarantees no residual value is ever left behind with no quantity left to hold it.
  const issuedValue = remainingQuantity.isZero()
    ? state.value
    : Prisma.Decimal.min(state.value, qty.times(averageUnitCost(state)).toDecimalPlaces(VALUE_DECIMALS));
  // Defensive floor, not an expected path: rounding the issued share up by a fraction of the
  // smallest unit could otherwise push this a hair below zero.
  const remainingValue = Prisma.Decimal.max(0, state.value.minus(issuedValue));

  return {
    state: { quantity: remainingQuantity, value: remainingValue },
    unitCost: qty.isZero() ? new Prisma.Decimal(0) : issuedValue.dividedBy(qty).toDecimalPlaces(VALUE_DECIMALS),
    value: issuedValue,
  };
}

export interface CountAdjustmentResult {
  readonly state: StockState;
  // Signed: positive is a surplus (counted more than the books), negative is a shortage.
  readonly variance: Prisma.Decimal;
  readonly varianceValue: Prisma.Decimal;
}

// A physical count compared to the book quantity (docs/01-OPEN-DECISIONS.md A3 decision):
// shortage debits a loss account, surplus debits Inventory and credits a gain account, both
// at `unitCost` — the warehouse's own average cost at the moment the count LINE was recorded
// (docs/04-DATA-MODEL-RULES.md §2: stored, not recomputed here), which is why this function
// takes it as a parameter instead of deriving it from `state` again. When nothing was on hand
// to average (state.quantity is zero), the caller is the one that must have asked for a real
// cost when the line was recorded — this function has no opinion on where unitCost came from.
export function applyCountAdjustment(
  state: StockState,
  countedQuantity: Prisma.Decimal | string,
  unitCost: Prisma.Decimal | string,
): CountAdjustmentResult {
  const counted = toDecimal(countedQuantity);
  const cost = toDecimal(unitCost);
  if (counted.lessThan(0)) throw new RangeError(`Counted quantity cannot be negative, got ${counted.toFixed()}`);
  if (cost.lessThan(0)) throw new RangeError(`Unit cost cannot be negative, got ${cost.toFixed()}`);

  const variance = counted.minus(state.quantity);
  const varianceValue = variance.times(cost).toDecimalPlaces(VALUE_DECIMALS);
  const newValue = Prisma.Decimal.max(0, state.value.plus(varianceValue));

  return { state: { quantity: counted, value: newValue }, variance, varianceValue };
}
