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

export async function assessViolationsBatch(
  violations: ViolationInput[],
  onProgress?: (completed: number, total: number) => void
): Promise<AssessmentResult[]> {
  const results: AssessmentResult[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < violations.length; i += BATCH_SIZE) {
    const batch = violations.slice(i, i + BATCH_SIZE);

    // Process batch concurrently
    const batchResults = await Promise.allSettled(
      batch.map(async (v) => {
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
        return {
          violationId: v.id,
          ...result,
        };
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error("Violation assessment failed:", result.reason);
      }
    }

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
