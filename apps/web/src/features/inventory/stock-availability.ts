import { Money } from "@erp/shared";

export interface StockLine {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly quantity: string;
}
type StockBalance = StockLine;
const quantityPattern = /^\d{1,15}(\.\d{1,4})?$/;

/** Group by warehouse AND item; a missing balance is zero only after a successful fetch. */
export function stockAvailability(
  lines: readonly StockLine[],
  balances: readonly StockBalance[] | undefined,
  scope: "warehouse" | "company" = "warehouse",
) {
  return lines.map((line) => {
    if (!line.itemId || (scope === "warehouse" && !line.warehouseId))
      return { onHand: null, remaining: null, exceeded: false };
    if (!balances) return { onHand: null, remaining: null, exceeded: false };
    const onHand = balances.filter((b) => b.itemId === line.itemId && (scope === "company" || b.warehouseId === line.warehouseId))
      .reduce((sum, b) => sum.add(Money.of(b.quantity, "SAR")), Money.zero("SAR")).toDecimalString(4);
    const total = lines
      .filter((l) => l.itemId === line.itemId && (scope === "company" || l.warehouseId === line.warehouseId))
      .reduce(
        (sum, l) => (quantityPattern.test(l.quantity) ? sum.add(Money.of(l.quantity, "SAR")) : sum),
        Money.zero("SAR"),
      );
    const remaining = Money.of(onHand, "SAR").subtract(total);
    return { onHand, remaining: remaining.toDecimalString(4), exceeded: remaining.isNegative() };
  });
}
