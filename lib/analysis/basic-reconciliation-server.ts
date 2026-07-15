import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import {
  computeBurdenFromRows,
  timeWeightFor,
  type BurdenResult,
  type ViolationRow,
} from "./basic-measure";

type QueryRow = {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  convicted: boolean | null;
  citation_number: string | null;
  citation_result: string | null;
  challenge_reason: string | null;
  challengeable: boolean | null;
  challenge_priority: "high" | "medium" | "low" | null;
  ai_assessed_at: string | null;
  inspections:
    | { inspection_date: string | null; state: string | null }
    | Array<{ inspection_date: string | null; state: string | null }>
    | null;
};

export type BasicReconciliation = {
  burden: BurdenResult;
  potentialRemovalImpactByBasic: Record<string, number>;
  challengeabilityByBasic: Record<string, { assessed: number; unassessed: number }>;
  allScoredViolationsAssessed: boolean;
  unknownBasicCount: number;
  queryTrace: {
    source: string;
    canonicalInspectionCount: number;
    canonicalViolationCount: number;
    inWindowViolationCount: number;
    scoredViolationCount: number;
    unknownBasicCount: number;
  };
};

function inspectionFor(row: QueryRow) {
  return Array.isArray(row.inspections) ? row.inspections[0] ?? null : row.inspections;
}

export async function getClientBasicReconciliation(
  clientId: string,
  adminClient?: SupabaseClient,
  asOf: Date = new Date()
): Promise<BasicReconciliation> {
  const supabase = adminClient ?? (await createServiceClient());
  const { inspectionIds } = await getCanonicalInspectionScope(clientId, supabase);
  let query = supabase
    .from("violations")
    .select(
      "id, violation_code, violation_description, basic_category, severity_weight, oos_violation, convicted, citation_number, citation_result, challenge_reason, challengeable, challenge_priority, ai_assessed_at, inspections(inspection_date, state)"
    )
    .eq("client_id", clientId);
  query = inspectionIds.length > 0
    ? query.in("inspection_id", inspectionIds)
    : query.in("inspection_id", []);
  const { data, error } = await query;
  if (error) throw new Error(`Unable to reconcile client BASIC numbers: ${error.message}`);

  const rows = (data ?? []) as unknown as QueryRow[];
  const burdenRows: ViolationRow[] = rows.map((row) => {
    const inspection = inspectionFor(row);
    return {
      id: row.id,
      violationCode: row.violation_code ?? "",
      violationDescription: row.violation_description,
      basicCategory: row.basic_category,
      severityWeight: row.severity_weight,
      oosViolation: row.oos_violation ?? false,
      inspectionDate: inspection?.inspection_date ?? null,
      state: inspection?.state ?? null,
    };
  });
  const burden = computeBurdenFromRows(burdenRows, asOf);
  const potentialRemovalImpactByBasic: Record<string, number> = {};
  const challengeabilityByBasic: Record<string, { assessed: number; unassessed: number }> = {};
  let inWindowViolationCount = 0;
  let unknownBasicCount = 0;

  for (const row of rows) {
    const inspectionDate = inspectionFor(row)?.inspection_date ?? null;
    const timeWeight = timeWeightFor(inspectionDate, asOf);
    if (timeWeight === 0) continue;
    inWindowViolationCount += 1;
    if (!row.basic_category) {
      unknownBasicCount += 1;
      continue;
    }
    if (row.severity_weight == null) continue;
    const coverage = challengeabilityByBasic[row.basic_category] ?? { assessed: 0, unassessed: 0 };
    if (row.ai_assessed_at) coverage.assessed += 1;
    else coverage.unassessed += 1;
    challengeabilityByBasic[row.basic_category] = coverage;
    const points = timeWeight * (row.severity_weight + (row.oos_violation ? 2 : 0));
    if (
      row.ai_assessed_at &&
      row.challengeable === true &&
      (row.challenge_priority === "high" || row.challenge_priority === "medium")
    ) {
      potentialRemovalImpactByBasic[row.basic_category] =
        (potentialRemovalImpactByBasic[row.basic_category] ?? 0) + points;
    }
  }

  return {
    burden,
    potentialRemovalImpactByBasic,
    challengeabilityByBasic,
    allScoredViolationsAssessed: Object.values(challengeabilityByBasic).every((row) => row.unassessed === 0),
    unknownBasicCount,
    queryTrace: {
      source: "canonical inspections -> violations",
      canonicalInspectionCount: inspectionIds.length,
      canonicalViolationCount: rows.length,
      inWindowViolationCount,
      scoredViolationCount: burden.perBasic.reduce((sum, basic) => sum + basic.violationCount, 0),
      unknownBasicCount,
    },
  };
}
