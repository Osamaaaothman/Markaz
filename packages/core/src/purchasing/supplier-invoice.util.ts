import { Prisma } from "@erp/db";

// The arithmetic of a supplier invoice, kept apart from the database so it can be tested exhaustively
// (docs/04 §2: money is never a float; every amount is rounded to the NUMERIC(19,4) scale once, here).

export interface PoLineMath {
  readonly net: Prisma.Decimal;
  // What the goods receipt booked to GRNI for this quantity: quantity x the order price.
  readonly orderValue: Prisma.Decimal;
  // net - orderValue: positive when the supplier charged more than the order said.
  readonly priceVariance: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
}

const round4 = (value: Prisma.Decimal): Prisma.Decimal => value.toDecimalPlaces(4);

// REVIEW: tax is rounded per line to four decimals and the invoice tax is their sum. Whether a
// company's VAT must be rounded per line or on the invoice total is a tax-treatment question for the
// accountant; changing it later touches only this function.
export function taxOn(net: Prisma.Decimal, ratePercent: Prisma.Decimal): Prisma.Decimal {
  return round4(net.times(ratePercent).div(100));
}

export function poLineMath(
  quantity: Prisma.Decimal,
  invoicePrice: Prisma.Decimal,
  orderPrice: Prisma.Decimal,
  ratePercent: Prisma.Decimal,
): PoLineMath {
  const net = round4(quantity.times(invoicePrice));
  const orderValue = round4(quantity.times(orderPrice));
  return { net, orderValue, priceVariance: net.minus(orderValue), tax: taxOn(net, ratePercent) };
}

export function expenseLineMath(
  quantity: Prisma.Decimal,
  unitPrice: Prisma.Decimal,
  ratePercent: Prisma.Decimal,
): { net: Prisma.Decimal; tax: Prisma.Decimal } {
  const net = round4(quantity.times(unitPrice));
  return { net, tax: taxOn(net, ratePercent) };
}

export interface InvoiceTotals {
  readonly net: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
  readonly gross: Prisma.Decimal;
  readonly grniDebit: Prisma.Decimal;
  readonly priceVariance: Prisma.Decimal;
  readonly expenseNet: Prisma.Decimal;
}

// Folds the per-line figures into the totals the ledger entry is built from. By construction
//   debits  = grniDebit + priceVariance + expenseNet + tax
//   credits = gross = net + tax        and  net = grniDebit + priceVariance + expenseNet
// so the entry balances exactly, with no rounding adjustment line.
export function invoiceTotals(
  poLines: readonly PoLineMath[],
  expenseLines: readonly { net: Prisma.Decimal; tax: Prisma.Decimal }[],
): InvoiceTotals {
  let net = new Prisma.Decimal(0);
  let tax = new Prisma.Decimal(0);
  let grniDebit = new Prisma.Decimal(0);
  let priceVariance = new Prisma.Decimal(0);
  let expenseNet = new Prisma.Decimal(0);
  for (const l of poLines) {
    net = net.plus(l.net);
    tax = tax.plus(l.tax);
    grniDebit = grniDebit.plus(l.orderValue);
    priceVariance = priceVariance.plus(l.priceVariance);
  }
  for (const l of expenseLines) {
    net = net.plus(l.net);
    tax = tax.plus(l.tax);
    expenseNet = expenseNet.plus(l.net);
  }
  return { net, tax, gross: net.plus(tax), grniDebit, priceVariance, expenseNet };
}
