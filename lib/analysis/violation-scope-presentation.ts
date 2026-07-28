export function formatViolationScopeFact(
  violationsInScoringWindow: number,
  violationsOnFile: number
): string {
  const inWindowLabel =
    violationsInScoringWindow === 1 ? "violation" : "violations";
  return `${violationsInScoringWindow} ${inWindowLabel} in the 24-month scoring window (${violationsOnFile} on file).`;
}
