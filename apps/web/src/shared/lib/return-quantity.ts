import { Money } from "@erp/shared";

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

// Use the shared decimal implementation for quantities too; Number loses the
// fractional part of quantities near the NUMERIC(19,4) limit.
export function positiveReturnQuantity(value: string): boolean {
  return DECIMAL.test(value) && Money.of(value, "SAR").isPositive();
}

export function validReturnQuantity(value: string, available: string): boolean {
  return positiveReturnQuantity(value) && Money.of(value, "SAR").compareTo(Money.of(available, "SAR")) <= 0;
}
