/**
 * Batch OpenRouter challengeability assessment.
 *
 * There is deliberately no rule fallback: a model failure leaves the row
 * unassessed instead of stamping ai_assessed_at with a different engine's result.
 */

import { assessViolationChallengeability } from "@/lib/ai/openrouter";
import { challengeableForTier, type ChallengeTier } from "./challengeability-rubric";

export interface ViolationInput {
  id: string;
  violationCode: string;
  description: string;
  basicCategory: string;
  severityWeight: number;
  oosViolation: boolean;
  convicted: boolean | null;
  citationNumber: string | null;
  citationResult: string | null;
  inspectionDate: string;
  state: string;
  inspectionLevel: string;
}

export interface AssessmentResult {
  violationId: string;
  tier: ChallengeTier;
  challengeable: boolean;
  reason: string;
  priority: "high" | "medium" | "low";
  confidence: number;
  suggestedApproach: string | null;
}

export interface AssessmentFailure {
  violationId: string;
  error: string;
}

export async function assessViolationsBatch(
  violations: ViolationInput[],
  onProgress?: (completed: number, total: number) => void
): Promise<{ results: AssessmentResult[]; failures: AssessmentFailure[] }> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

  const results: AssessmentResult[] = [];
  const failures: AssessmentFailure[] = [];
  const batchSize = 10;

  for (let i = 0; i < violations.length; i += batchSize) {
    const batch = violations.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(async (violation) => {
      const result = await assessViolationChallengeability({
        violationCode: violation.violationCode,
        description: violation.description,
        basicCategory: violation.basicCategory,
        severityWeight: violation.severityWeight,
        oosViolation: violation.oosViolation,
        convicted: violation.convicted,
        citationNumber: violation.citationNumber,
        citationResult: violation.citationResult,
        inspectionDate: violation.inspectionDate,
        state: violation.state,
        inspectionLevel: violation.inspectionLevel,
      });
      return {
        violationId: violation.id,
        ...result,
        challengeable: challengeableForTier(result.tier),
      };
    }));

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") results.push(result.value);
      else failures.push({
        violationId: batch[index].id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });

    onProgress?.(Math.min(i + batchSize, violations.length), violations.length);
    if (i + batchSize < violations.length) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { results, failures };
}

export function prioritizeViolations(
  results: AssessmentResult[],
  violations: ViolationInput[]
): Array<AssessmentResult & { severityWeight: number }> {
  const violationMap = new Map(violations.map((violation) => [violation.id, violation]));
  return results
    .filter((result) => result.challengeable)
    .map((result) => ({
      ...result,
      severityWeight: violationMap.get(result.violationId)?.severityWeight ?? 0,
    }))
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority];
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return b.severityWeight - a.severityWeight;
    });
}
