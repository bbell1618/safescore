/** QF-227: Total Safety pricing, shared by the server and the carrier's driver page. */
export const TOTAL_SAFETY_BASE = 999;
export const PER_DRIVER = 29;

export type PriceChange = { from: number; to: number; fromMonthly: number; toMonthly: number; difference: number };

export function totalSafetyMonthly(drivers: number): number {
  return TOTAL_SAFETY_BASE + PER_DRIVER * Math.max(0, drivers);
}

/** The price change a new driver count makes, or null when the price stays the same. */
export function priceChange(tier: string | null | undefined, billed: number | null | undefined, next: number): PriceChange | null {
  if (tier !== "total_safety" || billed == null || billed === next) return null;
  const fromMonthly = totalSafetyMonthly(billed);
  const toMonthly = totalSafetyMonthly(next);
  return { from: billed, to: next, fromMonthly, toMonthly, difference: toMonthly - fromMonthly };
}
