import { Prisma } from "@erp/db";
import { expenseLineMath, invoiceTotals, poLineMath, taxOn } from "./supplier-invoice.util.js";

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

describe("taxOn", () => {
  it("applies the percentage and rounds to four decimals", () => {
    expect(taxOn(D("1000"), D("15")).toFixed(4)).toBe("150.0000");
    expect(taxOn(D("0.0333"), D("15")).toFixed(4)).toBe("0.0050"); // 0.004995 -> 0.0050
    expect(taxOn(D("100"), D("0")).toFixed(4)).toBe("0.0000");
  });
});

describe("poLineMath", () => {
  it("matches the order price: no variance, GRNI cleared exactly", () => {
    const m = poLineMath(D("10"), D("12.5"), D("12.5"), D("15"));
    expect(m.net.toFixed(4)).toBe("125.0000");
    expect(m.orderValue.toFixed(4)).toBe("125.0000");
    expect(m.priceVariance.toFixed(4)).toBe("0.0000");
    expect(m.tax.toFixed(4)).toBe("18.7500");
  });

  it("surfaces an overcharge as a positive variance and an undercharge as a negative one", () => {
    expect(poLineMath(D("10"), D("13"), D("12.5"), D("15")).priceVariance.toFixed(4)).toBe("5.0000");
    expect(poLineMath(D("10"), D("12"), D("12.5"), D("15")).priceVariance.toFixed(4)).toBe("-5.0000");
  });
});

describe("invoiceTotals", () => {
  it("balances: debits (GRNI + variance + expense + tax) equal the gross payable", () => {
    const po = [poLineMath(D("10"), D("13"), D("12.5"), D("15")), poLineMath(D("3"), D("7.3333"), D("7.3333"), D("15"))];
    const ex = [expenseLineMath(D("1"), D("200"), D("0"))];
    const t = invoiceTotals(po, ex);
    const debits = t.grniDebit.plus(t.priceVariance).plus(t.expenseNet).plus(t.tax);
    expect(debits.equals(t.gross)).toBe(true);
    expect(t.net.equals(t.grniDebit.plus(t.priceVariance).plus(t.expenseNet))).toBe(true);
  });

  it("holds for many random lines (no rounding drift)", () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 200; round++) {
      const po = Array.from({ length: 1 + Math.floor(next() * 5) }, () =>
        poLineMath(D((next() * 100).toFixed(4)), D((next() * 50).toFixed(4)), D((next() * 50).toFixed(4)), D(next() < 0.5 ? "15" : "0")),
      );
      const t = invoiceTotals(po, []);
      expect(t.grniDebit.plus(t.priceVariance).plus(t.tax).equals(t.gross)).toBe(true);
    }
  });
});
