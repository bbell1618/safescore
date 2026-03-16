/**
 * Action item prioritization engine
 * Ranks all recommended actions by projected score impact per unit of effort
 */

import type { AssessmentResult } from "./challengeability";
import type { CpdpEligibilityResult } from "@/lib/ai/openrouter";

export interface ActionItemRecommendation {
  type: "dataq" | "cpdp" | "mcs150" | "monitoring";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  projectedImpactScore: number; // 0-100
  violationId?: string;
  crashId?: string;
}

export function buildActionItems(
  challengeableViolations: Array<AssessmentResult & { violationId: string; violationCode: string; description: string; basicCategory: string; severityWeight: number }>,
  crashEligibility: Array<{ crashId: string; result: CpdpEligibilityResult; crashDate: string; state: string }>,
  mcs150Discrepancies: string[]
): ActionItemRecommendation[] {
  const items: ActionItemRecommendation[] = [];

  // DataQ challenges
  for (const v of challengeableViolations) {
    const impactScore = Math.min(
      100,
      v.confidence * 0.5 + v.severityWeight * 4 + (v.priority === "high" ? 20 : v.priority === "medium" ? 10 : 0)
    );
    items.push({
      type: "dataq",
      title: `Challenge violation ${v.violationCode}`,
      description: `${v.description} — ${v.reason}`,
      priority: v.priority,
      projectedImpactScore: Math.round(impactScore),
      violationId: v.violationId,
    });
  }

  // CPDP submissions
  for (const { crashId, result, crashDate, state } of crashEligibility) {
    if (!result.eligible) continue;
    const impactScore = Math.min(100, result.confidence * 0.6 + 20);
    items.push({
      type: "cpdp",
      title: `CPDP submission — crash ${crashDate} (${state})`,
      description: `Eligible for ${result.eligibleTypes.join(", ")} determination. Confidence: ${result.confidence}%`,
      priority: result.confidence >= 70 ? "high" : result.confidence >= 50 ? "medium" : "low",
      projectedImpactScore: Math.round(impactScore),
      crashId,
    });
  }

  // MCS-150 updates
  for (const discrepancy of mcs150Discrepancies) {
    items.push({
      type: "mcs150",
      title: "MCS-150 data correction",
      description: discrepancy,
      priority: "medium",
      projectedImpactScore: 30,
    });
  }

  // Sort by projected impact descending
  return items.sort((a, b) => b.projectedImpactScore - a.projectedImpactScore);
}
