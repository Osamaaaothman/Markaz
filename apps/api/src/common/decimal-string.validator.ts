import { registerDecorator, type ValidationOptions } from "class-validator";

// Quantities and amounts cross the API as decimal STRINGS, never JS numbers (docs/04 §2). This
// accepts digits with up to four decimals — the scale of every NUMERIC(19,4) column — so a value
// that passes can be handed to Prisma.Decimal and stored without rounding. It refuses signs,
// exponents, spaces and anything non-numeric (which would otherwise surface as a 500 from deep in
// a service). `positive` additionally refuses zero.
const DECIMAL_STRING = /^\d{1,15}(\.\d{1,4})?$/;

export function isDecimalString(value: unknown, options: { readonly positive?: boolean } = {}): boolean {
  if (typeof value !== "string" || !DECIMAL_STRING.test(value)) return false;
  return options.positive ? /[1-9]/.test(value) : true;
}

export function IsDecimalString(options: { readonly positive?: boolean } = {}, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: "isDecimalString",
      target: object.constructor,
      propertyName,
      ...(validationOptions ? { options: validationOptions } : {}),
      validator: {
        validate: (value: unknown) => isDecimalString(value, options),
        defaultMessage: () =>
          `${propertyName} must be ${options.positive ? "a positive" : "a non-negative"} decimal string with at most 4 decimal places`,
      },
    });
  };
}
