import { Prisma } from "@erp/db";
import {
  InsufficientStockError,
  applyCountAdjustment,
  applyIssue,
  applyReceipt,
  averageUnitCost,
  type StockState,
} from "./weighted-average.util.js";

const d = (s: string) => new Prisma.Decimal(s);
const zero: StockState = { quantity: d("0"), value: d("0") };

describe("averageUnitCost", () => {
  it("is value / quantity", () => {
    const cost = averageUnitCost({ quantity: d("10"), value: d("1100") });
    expect(cost.toFixed(4)).toBe("110.0000");
  });

  it("is zero rather than dividing by zero when nothing is on hand", () => {
    expect(averageUnitCost(zero).toFixed(4)).toBe("0.0000");
  });
});

describe("applyReceipt", () => {
  it("adds quantity and value from a single receipt", () => {
    const state = applyReceipt(zero, "10", "100");
    expect(state.quantity.toFixed(4)).toBe("10.0000");
    expect(state.value.toFixed(4)).toBe("1000.0000");
  });

  it("blends two receipts at different costs into one weighted average", () => {
    // 10 @ 100 + 10 @ 120 = 20 units worth 2200 -> average 110, matching the worked
    // example already given to Osama when A3 was decided.
    let state = applyReceipt(zero, "10", "100");
    state = applyReceipt(state, "10", "120");
    expect(state.quantity.toFixed(4)).toBe("20.0000");
    expect(state.value.toFixed(4)).toBe("2200.0000");
    expect(averageUnitCost(state).toFixed(4)).toBe("110.0000");
  });

  it("rejects a zero or negative quantity, and a negative cost", () => {
    expect(() => applyReceipt(zero, "0", "100")).toThrow(RangeError);
    expect(() => applyReceipt(zero, "-1", "100")).toThrow(RangeError);
    expect(() => applyReceipt(zero, "10", "-1")).toThrow(RangeError);
  });
});

describe("applyIssue", () => {
  it("charges the weighted-average cost for a partial issue", () => {
    // 20 units worth 2200 (average 110) -> issue 5 -> 550, 15 units worth 1650 left.
    const stocked = applyReceipt(applyReceipt(zero, "10", "100"), "10", "120");
    const result = applyIssue(stocked, "5");
    expect(result.unitCost.toFixed(4)).toBe("110.0000");
    expect(result.value.toFixed(4)).toBe("550.0000");
    expect(result.state.quantity.toFixed(4)).toBe("15.0000");
    expect(result.state.value.toFixed(4)).toBe("1650.0000");
  });

  it("issuing everything takes the entire remaining value, leaving exactly 0/0", () => {
    // An average that does not divide evenly (100/3) is exactly where a naive
    // qty * rounded-average would leave a residual fraction of value behind.
    const stocked = applyReceipt(zero, "3", "33.3333");
    const result = applyIssue(stocked, "3");
    expect(result.state.quantity.toFixed(4)).toBe("0.0000");
    expect(result.state.value.toFixed(4)).toBe("0.0000");
    expect(result.value.toFixed(4)).toBe(stocked.value.toFixed(4));
  });

  it("never leaves a negative remaining value after a long run of uneven partial issues", () => {
    let state = applyReceipt(zero, "7", "10.0001");
    for (let i = 0; i < 6; i++) {
      const result = applyIssue(state, "1");
      state = result.state;
      expect(state.value.greaterThanOrEqualTo(0)).toBe(true);
    }
    // One unit remains; issuing it must still net out to exactly 0/0.
    const last = applyIssue(state, "1");
    expect(last.state.quantity.toFixed(4)).toBe("0.0000");
    expect(last.state.value.toFixed(4)).toBe("0.0000");
  });

  it("the sum of every issued value plus what remains equals what was received", () => {
    let state = applyReceipt(zero, "3", "10");
    state = applyReceipt(state, "4", "13.3333");
    const totalReceived = state.value;

    let issuedTotal = d("0");
    const first = applyIssue(state, "2");
    issuedTotal = issuedTotal.plus(first.value);
    const second = applyIssue(first.state, "5");
    issuedTotal = issuedTotal.plus(second.value);

    expect(issuedTotal.plus(second.state.value).toFixed(4)).toBe(totalReceived.toFixed(4));
  });

  it("rejects issuing more than is on hand — no negative stock", () => {
    const stocked = applyReceipt(zero, "5", "10");
    expect(() => applyIssue(stocked, "6")).toThrow(InsufficientStockError);
    expect(() => applyIssue(zero, "1")).toThrow(InsufficientStockError);
  });

  it("rejects a zero or negative issue quantity", () => {
    const stocked = applyReceipt(zero, "5", "10");
    expect(() => applyIssue(stocked, "0")).toThrow(RangeError);
    expect(() => applyIssue(stocked, "-1")).toThrow(RangeError);
  });
});

describe("applyCountAdjustment", () => {
  it("a shortage reduces quantity and value at the given unit cost", () => {
    const stocked = applyReceipt(zero, "10", "50"); // 10 @ 50 = 500
    const result = applyCountAdjustment(stocked, "7", "50"); // counted 7, short 3
    expect(result.variance.toFixed(4)).toBe("-3.0000");
    expect(result.varianceValue.toFixed(4)).toBe("-150.0000");
    expect(result.state.quantity.toFixed(4)).toBe("7.0000");
    expect(result.state.value.toFixed(4)).toBe("350.0000");
  });

  it("a surplus increases quantity and value at the given unit cost", () => {
    const stocked = applyReceipt(zero, "10", "50");
    const result = applyCountAdjustment(stocked, "12", "50"); // counted 12, surplus 2
    expect(result.variance.toFixed(4)).toBe("2.0000");
    expect(result.varianceValue.toFixed(4)).toBe("100.0000");
    expect(result.state.value.toFixed(4)).toBe("600.0000");
  });

  it("no variance when the count matches the books exactly", () => {
    const stocked = applyReceipt(zero, "10", "50");
    const result = applyCountAdjustment(stocked, "10", "50");
    expect(result.variance.toFixed(4)).toBe("0.0000");
    expect(result.varianceValue.toFixed(4)).toBe("0.0000");
    expect(result.state.value.toFixed(4)).toBe(stocked.value.toFixed(4));
  });

  it("a surplus counted from nothing on hand uses the cost the caller supplies", () => {
    const result = applyCountAdjustment(zero, "4", "25");
    expect(result.variance.toFixed(4)).toBe("4.0000");
    expect(result.state.quantity.toFixed(4)).toBe("4.0000");
    expect(result.state.value.toFixed(4)).toBe("100.0000");
  });

  it("rejects a negative counted quantity or a negative unit cost", () => {
    const stocked = applyReceipt(zero, "10", "50");
    expect(() => applyCountAdjustment(stocked, "-1", "50")).toThrow(RangeError);
    expect(() => applyCountAdjustment(stocked, "5", "-1")).toThrow(RangeError);
  });
});

// Property-based, matching the style and intent of
// packages/core/src/accounting/ledger-integrity.integration.spec.ts §1: generate random valid
// operation sequences and assert the invariants hold after every single one, not just in a
// few hand-picked examples.
describe("weighted average — property-based", () => {
  it("received == issued + remaining, exactly, over random receipt/issue sequences", () => {
    // This is the sub-ledger-to-control-account reconciliation
    // (docs/05-ACCOUNTING-INTEGRITY-RULES.md §7 gate) expressed at the unit-math level: no
    // count adjustment in this run, so every cent received must be accounted for by what was
    // issued plus what is still held — not approximately, exactly, to the column's own
    // 4 decimal places.
    const iterations = 300;

    for (let seed = 0; seed < iterations; seed++) {
      let state = zero;
      let totalReceived = d("0");
      let totalIssued = d("0");

      const steps = 2 + Math.floor(Math.random() * 10);
      for (let step = 0; step < steps; step++) {
        const issuing = state.quantity.greaterThan(0) && Math.random() < 0.5;
        if (issuing) {
          const qty = randomDecimal(0.0001, state.quantity.toNumber());
          const result = applyIssue(state, qty);
          state = result.state;
          totalIssued = totalIssued.plus(result.value);
        } else {
          const qty = randomDecimal(1, 50);
          const cost = randomDecimal(0, 500);
          state = applyReceipt(state, qty, cost);
          totalReceived = totalReceived.plus(d(qty).times(cost).toDecimalPlaces(4));
        }

        expect(state.quantity.greaterThanOrEqualTo(0)).toBe(true);
        expect(state.value.greaterThanOrEqualTo(0)).toBe(true);
      }

      expect(totalIssued.plus(state.value).toFixed(4)).toBe(totalReceived.toFixed(4));
    }
  });

  it("keeps quantity and value non-negative across random receipts, issues, and count adjustments", () => {
    const iterations = 300;

    for (let seed = 0; seed < iterations; seed++) {
      let state = zero;
      const steps = 2 + Math.floor(Math.random() * 10);

      for (let step = 0; step < steps; step++) {
        const action = Math.random();
        if (action < 0.4 && state.quantity.greaterThan(0)) {
          state = applyIssue(state, randomDecimal(0.0001, state.quantity.toNumber())).state;
        } else if (action < 0.7) {
          const cost = state.quantity.isZero() ? randomDecimal(0, 500) : averageUnitCost(state).toFixed(4);
          state = applyCountAdjustment(state, randomDecimal(0, state.quantity.toNumber() * 2 + 10), cost).state;
        } else {
          state = applyReceipt(state, randomDecimal(1, 50), randomDecimal(0, 500));
        }

        expect(state.quantity.greaterThanOrEqualTo(0)).toBe(true);
        expect(state.value.greaterThanOrEqualTo(0)).toBe(true);
      }
    }
  });
});

function randomDecimal(min: number, max: number): string {
  const value = min + Math.random() * (max - min);
  return value.toFixed(4);
}
