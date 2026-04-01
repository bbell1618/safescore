/**
 * Batch violation challengeability assessment
 * Calls OpenRouter AI for each violation (10 at a time) and persists results
 */

import { assessViolationChallengeability } from "@/lib/ai/openrouter";

export interface ViolationInput {
  id: string;
  violationCode: string;
  description: string;
  basicCategory: string;
  severityWeight: number;
  oosViolation: boolean;
  convicted: boolean;
  inspectionDate: string;
  state: string;
  inspectionLevel: string;
}

export interface AssessmentResult {
  violationId: string;
  challengeable: boolean;
  reason: string;
  priority: "high" | "medium" | "low";
  confidence: number;
  suggestedApproach: string | null;
}

function ruleBasedAssessment(v: ViolationInput): AssessmentResult {
  if (!v.convicted) {
    return {
      violationId: v.id,
      challengeable: true,
      reason: "Violation not convicted — strong grounds for DataQs challenge on evidentiary basis",
      priority: v.severityWeight >= 7 ? "high" : "medium",
      confidence: 75,
      suggestedApproach: "File DataQs requesting removal based on lack of conviction record",
    };
  }
  if (v.oosViolation && v.basicCategory === "vehicle_maintenance") {
    return {
      violationId: v.id,
      challengeable: false,
      reason: "OOS vehicle maintenance violation with conviction — clear documented record, limited challenge grounds",
      priority: "low",
      confidence: 72,
      suggestedApproach: null,
    };
  }
  if (v.basicCategory === "hos_compliance") {
    return {
      violationId: v.id,
      challengeable: true,
      reason: "HOS recordkeeping violations are frequently challengeable on procedural or timeline grounds",
      priority: "medium",
      confidence: 65,
      suggestedApproach: "Review driver logs and officer timeline for discrepancies in hours calculation",
    };
  }
  if (v.basicCategory === "driver_fitness") {
    return {
      violationId: v.id,
      challengeable: true,
      reason: "Driver fitness violations often challengeable if supporting documentation can be produced",
      priority: "high",
      confidence: 68,
      suggestedApproach: "Provide employment application, previous employer inquiry records, and qualification file",
    };
  }
  if (v.basicCategory === "hazmat_compliance") {
    return {
      violationId: v.id,
      challengeable: false,
      reason: "Hazmat compliance violations with conviction carry significant regulatory weight — difficult to challenge",
      priority: "low",
      confidence: 70,
      suggestedApproach: null,
    };
  }
  return {
    violationId: v.id,
    challengeable: v.severityWeight < 6,
    reason:
      v.severityWeight < 6
        ? "Lower severity violation — may be challengeable on procedural or minor evidentiary grounds"
        : "High severity convicted violation — limited challenge prospects without clear procedural error",
    priority: "low",
    confidence: 55,
    suggestedApproach:
      v.severityWeight < 6 ? "Review inspection report for procedural irregularities or equipment repair documentation" : null,
  };
}

export async function assessViolationsBatch(
  violations: ViolationInput[],
  onProgress?: (completed: number, total: number) => void
): Promise<AssessmentResult[]> {
  // Use rule-based assessment if OpenRouter is not configured
  if (!process.env.OPENROUTER_API_KEY) {
    return violations.map(ruleBasedAssessment);
  }

  const results: AssessmentResult[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < violations.length; i += BATCH_SIZE) {
    const batch = violations.slice(i, i + BATCH_SIZE);

    // Process batch concurrently — fall back to rule-based if OpenRouter fails for any individual violation
    const batchResults = await Promise.all(
      batch.map(async (v) => {
        try {
          const result = await assessViolationChallengeability({
            violationCode: v.violationCode,
            description: v.description,
            basicCategory: v.basicCategory,
            severityWeight: v.severityWeight,
            oosViolation: v.oosViolation,
            convicted: v.convicted,
            inspectionDate: v.inspectionDate,
            state: v.state,
            inspectionLevel: v.inspectionLevel,
          });
          return { violationId: v.id, ...result };
        } catch (err) {
          console.warn("OpenRouter assessment failed, using rule-based fallback:", err);
          return ruleBasedAssessment(v);
        }
      })
    );

    results.push(...batchResults);

    onProgress?.(Math.min(i + BATCH_SIZE, violations.length), violations.length);

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < violations.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Sort and prioritize challengeable violations by impact
 */
export function prioritizeViolations(
  results: AssessmentResult[],
  violations: ViolationInput[]
): Array<AssessmentResult & { severityWeight: number }> {
  const violationMap = new Map(violations.map((v) => [v.id, v]));

  return results
    .filter((r) => r.challengeable)
    .map((r) => ({
      ...r,
      severityWeight: violationMap.get(r.violationId)?.severityWeight ?? 0,
    }))
    .sort((a, b) => {
      // Sort by: priority, then confidence, then severity weight
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority];
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return b.severityWeight - a.severityWeight;
    });
}
