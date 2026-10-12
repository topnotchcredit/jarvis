/**
 * Money is an integer count of minor units (cents) plus an ISO-4217 currency code.
 * No floating-point amounts anywhere; amounts in different currencies never combine.
 */
export type Money = { readonly amountMinor: number; readonly currency: string };

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} with ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Money amount must be a safe integer of minor units");
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`Invalid currency code: ${currency}`);
  return { amountMinor, currency };
}

function sameCurrency(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) throw new RangeError("Quantity must be an integer");
  return money(a.amountMinor * quantity, a.currency);
}

export function sum(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => add(total, value), money(0, currency));
}

/** numerator / denominator in basis points, rounded half away from zero; null when undefined. */
export function ratioBps(numeratorMinor: number, denominatorMinor: number): number | null {
  if (denominatorMinor === 0) return null;
  return Math.round((numeratorMinor / denominatorMinor) * 10_000);
}

/** Minor-unit digits per currency for display. Unlisted currencies use 2. */
const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, BHD: 3, KWD: 3, JOD: 3, OMR: 3, TND: 3 };

export function formatMoney(value: Money, locale = "en-US"): string {
  const digits = MINOR_DIGITS[value.currency] ?? 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency: value.currency }).format(
    value.amountMinor / 10 ** digits,
  );
}
