/** Format a comparison without claiming that rounded values are equal. */
export function formatNumericComparison(before: number | null, after: number | null): string {
  if (before === null && after === null) return "Comparison unavailable";
  if (before === null) return `Before unavailable; proposed ${after!.toFixed(2)}`;
  if (after === null) return `Current ${before.toFixed(2)}; proposed unavailable`;
  const current = before.toFixed(2);
  const proposed = after.toFixed(2);
  if (before === after) return `Unchanged at ${current}`;
  if (current === proposed) return `Change smaller than 0.01 (about ${current})`;
  return `${current} → ${proposed}`;
}
