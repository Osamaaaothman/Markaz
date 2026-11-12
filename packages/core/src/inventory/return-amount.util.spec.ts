import { Prisma } from "@erp/db";
import { returnShare } from "./return-amount.util.js";

describe("return allocation", () => {
  it("allocates the final rounding remainder without changing the original total", () => {
    const total = new Prisma.Decimal("0.0001");
    const quantity = new Prisma.Decimal(3);
    const pieces = [0, 1, 2].map((already) => returnShare(total, quantity, new Prisma.Decimal(already), new Prisma.Decimal(1)));
    expect(pieces.map((p) => p.toFixed(4))).toEqual(["0.0000", "0.0001", "0.0000"]);
    expect(pieces.reduce((sum, p) => sum.plus(p), new Prisma.Decimal(0)).equals(total)).toBe(true);
  });

  it("preserves precision for large values and fractional quantities", () => {
    const total = new Prisma.Decimal("987654321098765.4321");
    const quantity = new Prisma.Decimal("1.2345");
    const first = returnShare(total, quantity, new Prisma.Decimal(0), new Prisma.Decimal("0.2345"));
    const rest = returnShare(total, quantity, new Prisma.Decimal("0.2345"), new Prisma.Decimal(1));
    expect(first.plus(rest).equals(total)).toBe(true);
  });
});
