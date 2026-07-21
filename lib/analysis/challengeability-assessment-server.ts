import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assessViolationsBatch, type AssessmentFailure } from "./challengeability";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";

type InspectionContext = { inspection_date: string | null; state: string | null; level: string | number | null };
type ViolationRow = {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  convicted: boolean | null;
  citation_number: string | null;
  citation_result: string | null;
  inspections: InspectionContext | InspectionContext[] | null;
};

function inspectionFor(row: ViolationRow): InspectionContext | null {
  return Array.isArray(row.inspections) ? row.inspections[0] ?? null : row.inspections;
}

export type ChallengeabilityRunResult = {
  requested: number;
  assessed: number;
  challengeable: number;
  failures: AssessmentFailure[];
  hasMore: boolean;
  nextCursor: string | null;
};

export async function runChallengeabilityAssessment(
  supabase: SupabaseClient,
  clientId: string,
  options: { violationIds?: string[]; force?: boolean; cursor?: string } = {}
): Promise<ChallengeabilityRunResult> {
  const explicitViolationIds = options.violationIds?.filter(Boolean) ?? [];
  const { inspectionIds } = explicitViolationIds.length > 0
    ? { inspectionIds: [] as string[] }
    : await getCanonicalInspectionScope(clientId, supabase);
  if (explicitViolationIds.length === 0 && inspectionIds.length === 0) {
    return { requested: 0, assessed: 0, challengeable: 0, failures: [], hasMore: false, nextCursor: null };
  }

  let query = supabase
    .from("violations")
    .select("id, violation_code, violation_description, basic_category, severity_weight, oos_violation, convicted, citation_number, citation_result, inspections(inspection_date, state, level)")
    .eq("client_id", clientId)
    .order("id")
    .limit(20);
  query = explicitViolationIds.length > 0
    ? query.in("id", explicitViolationIds)
    : query.in("inspection_id", inspectionIds);
  if (!options.force) query = query.is("ai_assessed_at", null);
  if (options.force && options.cursor) query = query.gt("id", options.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Unable to load violations for challengeability analysis: ${error.message}`);

  const rows = (data ?? []) as unknown as ViolationRow[];
  if (rows.length === 0) {
    return { requested: 0, assessed: 0, challengeable: 0, failures: [], hasMore: false, nextCursor: null };
  }

  const { results, failures } = await assessViolationsBatch(rows.map((row) => {
    const inspection = inspectionFor(row);
    return {
      id: row.id,
      violationCode: row.violation_code ?? "Unknown code",
      description: row.violation_description ?? "No description provided by source",
      basicCategory: row.basic_category ?? "unclassified",
      severityWeight: row.severity_weight ?? 0,
      oosViolation: Boolean(row.oos_violation),
      convicted: row.convicted,
      citationNumber: row.citation_number,
      citationResult: row.citation_result,
      inspectionDate: inspection?.inspection_date ?? "Unknown",
      state: inspection?.state ?? "Unknown",
      inspectionLevel: String(inspection?.level ?? "Unknown"),
    };
  }));

  const writeFailures: AssessmentFailure[] = [];
  const assessedAt = new Date().toISOString();
  for (const result of results) {
    const { data: updated, error: updateError } = await supabase
      .from("violations")
      .update({
        challenge_tier: result.tier,
        challenge_reason: result.reason,
        challenge_priority: result.priority,
        ai_assessed_at: assessedAt,
      })
      .eq("client_id", clientId)
      .eq("id", result.violationId)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) writeFailures.push({
      violationId: result.violationId,
      error: updateError?.message ?? "Assessment write did not update a row",
    });
  }

  const failedWriteIds = new Set(writeFailures.map((failure) => failure.violationId));
  const persisted = results.filter((result) => !failedWriteIds.has(result.violationId));
  if (persisted.length > 0) {
    const { error: activityError } = await supabase.from("activity_log").insert({
      client_id: clientId,
      action_type: "violation_assessed",
      entity_type: "violations",
      description: `AI assessed ${persisted.length} violations - ${persisted.filter((result) => result.challengeable).length} flagged as challengeable`,
    });
    if (activityError) throw new Error(`Challengeability results were saved, but activity logging failed: ${activityError.message}`);
  }

  return {
    requested: rows.length,
    assessed: persisted.length,
    challengeable: persisted.filter((result) => result.challengeable).length,
    failures: [...failures, ...writeFailures],
    hasMore: rows.length === 20,
    nextCursor: rows.at(-1)?.id ?? null,
  };
}
