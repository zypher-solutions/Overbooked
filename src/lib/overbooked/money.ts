// Booking discount arithmetic. Kept import-free so it can be unit-tested with plain `node --test`.
// The database enforces the same rules (create_booking_atomic, qa/proposed-sql/005_discount_full.sql).

/** Round to paise so JS float noise (0.1 + 0.2) never reaches the database. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Amount the customer must pay: items minus the negotiated discount. */
export const netTotal = (gross: number, discount: number): number => round2(gross - discount);

/** Returns an error message, or null when the discount is acceptable for this items total. */
export function discountError(gross: number, discount: number): string | null {
  if (!Number.isFinite(discount)) return "Discount must be a number";
  if (discount < 0) return "Discount cannot be negative";
  if (round2(discount) > round2(gross)) return "Discount cannot exceed the rental total";
  return null;
}
