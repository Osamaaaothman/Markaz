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
) {
  return lines.map((line) => {
    if (!line.itemId || !line.warehouseId)
      return { onHand: null, remaining: null, exceeded: false };
    if (!balances) return { onHand: null, remaining: null, exceeded: false };
    const onHand =
      balances.find((b) => b.itemId === line.itemId && b.warehouseId === line.warehouseId)
        ?.quantity ?? "0";
    const total = lines
      .filter((l) => l.itemId === line.itemId && l.warehouseId === line.warehouseId)
      .reduce(
        (sum, l) => (quantityPattern.test(l.quantity) ? sum.add(Money.of(l.quantity, "SAR")) : sum),
        Money.zero("SAR"),
      );
    const remaining = Money.of(onHand, "SAR").subtract(total);
    return { onHand, remaining: remaining.toDecimalString(4), exceeded: remaining.isNegative() };
  });
}
