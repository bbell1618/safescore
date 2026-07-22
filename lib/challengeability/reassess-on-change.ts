import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChallengeabilityRunResult } from "@/lib/analysis/challengeability-assessment-server";

export const VIOLATION_REASSESSMENT_FIELDS = [
  "citation_number",
  "citation_result",
  "convicted",
] as const;

export type ViolationReassessmentField =
  (typeof VIOLATION_REASSESSMENT_FIELDS)[number];

export type ViolationEnrichmentRow = {
  id: string;
  client_id: string;
  citation_number: string | null;
  citation_result: string | null;
  convicted: boolean | null;
};

export type TargetedChallengeabilityAssessment = (
  supabase: SupabaseClient,
  clientId: string,
  options: { violationIds: string[]; force: true }
) => Promise<ChallengeabilityRunResult>;

type ReassessmentChange = {
  clientId: string;
  violationId: string;
  before: ViolationEnrichmentRow;
  after: ViolationEnrichmentRow;
};

type ReassessmentDependencies = {
  assess?: TargetedChallengeabilityAssessment;
};

export type ReassessmentOnChangeResult =
  | {
      reassessed: false;
      changedFields: [];
    }
  | {
      reassessed: true;
      changedFields: ViolationReassessmentField[];
      assessment: ChallengeabilityRunResult;
    };

export function changedViolationEnrichmentFields(
  before: ViolationEnrichmentRow,
  after: ViolationEnrichmentRow
): ViolationReassessmentField[] {
  return VIOLATION_REASSESSMENT_FIELDS.filter(
    (field) => !Object.is(before[field], after[field])
  );
}

/**
 * U10 auto-re-eval primitive: re-run the existing v2 classifier after an
 * operator/enrichment source changes one of its persisted inputs.
 * Public-source refresh paths must not call this.
 */
export async function reassessViolationOnChange(
  supabase: SupabaseClient,
  change: ReassessmentChange,
  dependencies: ReassessmentDependencies = {}
): Promise<ReassessmentOnChangeResult> {
  assertRowContext(change.before, change.clientId, change.violationId, "before");
  assertRowContext(change.after, change.clientId, change.violationId, "after");

  const changedFields = changedViolationEnrichmentFields(
    change.before,
    change.after
  );
  if (changedFields.length === 0) {
    return { reassessed: false, changedFields: [] };
  }

  const assess = dependencies.assess ?? runTargetedAssessment;
  const assessment = await assess(supabase, change.clientId, {
    violationIds: [change.violationId],
    force: true,
  });

  if (assessment.failures.length > 0) {
    const details = assessment.failures
      .map((failure) => `${failure.violationId}: ${failure.error}`)
      .join("; ");
    throw new Error(`Targeted challengeability reassessment failed: ${details}`);
  }
  if (assessment.requested !== 1 || assessment.assessed !== 1) {
    throw new Error(
      `Targeted challengeability reassessment persisted ${assessment.assessed} of ${assessment.requested} requested violations`
    );
  }

  return { reassessed: true, changedFields, assessment };
}

async function runTargetedAssessment(
  supabase: SupabaseClient,
  clientId: string,
  options: { violationIds: string[]; force: true }
) {
  const { runChallengeabilityAssessment } = await import(
    "@/lib/analysis/challengeability-assessment-server"
  );
  return runChallengeabilityAssessment(supabase, clientId, options);
}

function assertRowContext(
  row: ViolationEnrichmentRow,
  clientId: string,
  violationId: string,
  label: "before" | "after"
) {
  if (row.id !== violationId || row.client_id !== clientId) {
    throw new Error(
      `Cannot reassess violation: ${label} row does not match client ${clientId} and violation ${violationId}`
    );
  }
}
