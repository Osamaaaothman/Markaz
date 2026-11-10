// Copy quantities exactly; only trim decimal padding. Prices are deliberately left for the buyer.
export function requestLinesForOrder(lines: readonly { readonly itemId: string; readonly quantity: string }[], taxCodeId: string) {
  return lines.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity.includes(".") ? line.quantity.replace(/0+$/, "").replace(/\.$/, "") : line.quantity,
    unitPrice: "",
    taxCodeId,
  }));
}
