import { Prisma } from "@erp/db";

// Allocate from the stored original amount, including its final rounding remainder.
// Cumulative differences make successive partial returns add up to the original exactly.
export function returnShare(total: Prisma.Decimal, originalQuantity: Prisma.Decimal, returnedQuantity: Prisma.Decimal, quantity: Prisma.Decimal): Prisma.Decimal {
  return total.times(returnedQuantity.plus(quantity)).div(originalQuantity).toDecimalPlaces(4)
    .minus(total.times(returnedQuantity).div(originalQuantity).toDecimalPlaces(4));
}
