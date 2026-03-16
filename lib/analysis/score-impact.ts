/**
 * FMCSA SMS score impact calculator
 * Approximates the time-weighted severity formula used by FMCSA SMS
 * for "what-if" projections when violations are removed.
 */

export interface ViolationForCalc {
  id: string;
  basicCategory: string;
  severityWeight: number;
  timeWeight: number; // 1 = older, 2 = mid, 3 = recent
  oosViolation: boolean;
}

export interface ScoreImpactResult {
  basicCategory: string;
  currentMeasure: number;
  projectedMeasure: number;
  measureDelta: number; // negative = improvement
  estimatedPercentileDelta: number; // negative = improvement
}

/**
 * Calculates time-weighted severity for a violation
 * FMCSA formula: severity_weight * time_weight * oos_multiplier
 */
function calcViolationScore(v: ViolationForCalc): number {
  const oosMultiplier = v.oosViolation ? 2 : 1;
  return v.severityWeight * v.timeWeight * oosMultiplier;
}

/**
 * Simulates score impact of removing a set of violations
 * Returns projected measure per BASIC category
 */
export function simulateScoreImpact(
  allViolations: ViolationForCalc[],
  currentSnapshots: Record<string, { measureValue: number; percentile: number | null }>,
  violationIdsToRemove: string[]
): ScoreImpactResult[] {
  const removeSet = new Set(violationIdsToRemove);

  // Group violations by BASIC category
  const byCategory: Record<string, { all: ViolationForCalc[]; kept: ViolationForCalc[] }> = {};

  for (const v of allViolations) {
    const cat = v.basicCategory;
    if (!byCategory[cat]) {
      byCategory[cat] = { all: [], kept: [] };
    }
    byCategory[cat].all.push(v);
    if (!removeSet.has(v.id)) {
      byCategory[cat].kept.push(v);
    }
  }

  const results: ScoreImpactResult[] = [];

  for (const [cat, { all, kept }] of Object.entries(byCategory)) {
    const snapshot = currentSnapshots[cat];
    if (!snapshot) continue;

    const currentTotal = all.reduce((sum, v) => sum + calcViolationScore(v), 0);
    const keptTotal = kept.reduce((sum, v) => sum + calcViolationScore(v), 0);

    // If current total is 0, no change
    if (currentTotal === 0) {
      results.push({
        basicCategory: cat,
        currentMeasure: snapshot.measureValue,
        projectedMeasure: snapshot.measureValue,
        measureDelta: 0,
        estimatedPercentileDelta: 0,
      });
      continue;
    }

    // Scale the current measure proportionally
    const ratio = keptTotal / currentTotal;
    const projectedMeasure = Math.max(0, snapshot.measureValue * ratio);
    const measureDelta = projectedMeasure - snapshot.measureValue;

    // Rough percentile delta: every ~1 point of measure ≈ ~0.5-1 percentile point
    // This is a very rough approximation — real SMS uses peer group comparison
    const estimatedPercentileDelta = measureDelta * 0.8;

    results.push({
      basicCategory: cat,
      currentMeasure: snapshot.measureValue,
      projectedMeasure: Math.round(projectedMeasure * 10) / 10,
      measureDelta: Math.round(measureDelta * 10) / 10,
      estimatedPercentileDelta: Math.round(estimatedPercentileDelta),
    });
  }

  return results.sort((a, b) => a.measureDelta - b.measureDelta); // biggest improvements first
}

/**
 * Summarizes total projected improvement across all BASICs
 */
export function summarizeImpact(results: ScoreImpactResult[]): {
  totalMeasureDelta: number;
  totalPercentileDelta: number;
  improvingCategories: number;
  alertsRemoved: number;
} {
  const totalMeasureDelta = results.reduce((sum, r) => sum + r.measureDelta, 0);
  const totalPercentileDelta = results.reduce((sum, r) => sum + r.estimatedPercentileDelta, 0);
  const improvingCategories = results.filter((r) => r.measureDelta < -0.5).length;
  // Count projected improvements that cross the 80th percentile threshold
  const alertsRemoved = results.filter(
    (r) => r.currentMeasure > 65 && r.projectedMeasure <= 65
  ).length;

  return {
    totalMeasureDelta: Math.round(totalMeasureDelta * 10) / 10,
    totalPercentileDelta: Math.round(totalPercentileDelta),
    improvingCategories,
    alertsRemoved,
  };
}
