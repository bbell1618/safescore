export type InvestigationBurdenSummary = {
  points: number;
  percent: number;
  violationCount: number;
};

export function summarizeInvestigationBurden(
  items: Array<{ points: number }>,
  totalPoints: number
): InvestigationBurdenSummary {
  const scoredItems = items.filter(
    (item) => Number.isFinite(item.points) && item.points > 0
  );
  const points = scoredItems.reduce((sum, item) => sum + item.points, 0);

  return {
    points,
    percent: totalPoints > 0 ? Math.round((points / totalPoints) * 100) : 0,
    violationCount: scoredItems.length,
  };
}
