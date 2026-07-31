import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyVehicleOosPriorityContext,
  assessViolationsBatch,
  type AssessmentFailure,
  type AssessmentResult,
} from "./challengeability";
import {
  CHALLENGEABILITY_EVIDENCE_MODEL_SLUG,
  type EvidenceFile,
} from "@/lib/ai/openrouter";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import {
  advanceSubmittedLaneBRequests,
  reconcileLaneBEvidenceRequests,
} from "@/lib/evidence-loop/server";

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
  challenge_tier: string | null;
  challenge_reason: string | null;
  challenge_priority: string | null;
  ai_assessed_at: string | null;
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
  evidenceAnalysis?: ChallengeabilityEvidenceAnalysis;
  preservedEvidenceBackedIds?: string[];
};

export type ChallengeabilityEvidenceAnalysis = {
  status: "completed" | "failed";
  analyzedAt: string;
  requestId: string;
  violationId: string;
  documentIds: string[];
  evidenceClass: string;
  requestedItemKeys: string[];
  model: string;
  decision: "supported" | "insufficient" | "failed";
  assessment: AssessmentResult | null;
  failures: AssessmentFailure[];
};

export type ChallengeabilityEvidenceContext = {
  requestId: string;
  violationId: string;
  documentIds: string[];
  files: EvidenceFile[];
  evidenceClass: string;
  requestedItemKeys: string[];
};

export async function persistEvidenceAnalysis(
  supabase: SupabaseClient,
  clientId: string,
  analysis: ChallengeabilityEvidenceAnalysis
) {
  const { data: updatedDocuments, error: documentError } = await supabase
    .from("documents")
    .update({ evidence_analysis: analysis })
    .eq("client_id", clientId)
    .eq("client_request_id", analysis.requestId)
    .eq("violation_id", analysis.violationId)
    .in("id", analysis.documentIds)
    .select("id");
  if (documentError || (updatedDocuments ?? []).length !== analysis.documentIds.length) {
    throw new Error(
      `Evidence analysis could not be persisted on every source document: ${
        documentError?.message ??
        `updated ${(updatedDocuments ?? []).length} of ${analysis.documentIds.length}`
      }`
    );
  }

  const { data: activity, error: activityError } = await supabase
    .from("activity_log")
    .insert({
      client_id: clientId,
      action_type:
        analysis.status === "completed"
          ? "challengeability_evidence_analyzed"
          : "challengeability_evidence_analysis_failed",
      entity_type: "client_requests",
      entity_id: analysis.requestId,
      description:
        analysis.status === "completed"
          ? "Uploaded evidence was analyzed against the linked violation"
          : "Uploaded evidence analysis failed and remains queued for retry",
      metadata: {
        violation_id: analysis.violationId,
        document_ids: analysis.documentIds,
        evidence_class: analysis.evidenceClass,
        requested_item_keys: analysis.requestedItemKeys,
        model: analysis.model,
        status: analysis.status,
        decision: analysis.decision,
        resulting_tier: analysis.assessment?.tier ?? null,
        failure_reasons: analysis.failures.map((failure) => failure.error),
      },
    })
    .select("id")
    .maybeSingle();
  if (activityError || !activity) {
    throw new Error(
      `Evidence analysis was persisted, but activity logging failed: ${
        activityError?.message ?? "row not inserted"
      }`
    );
  }
}

export async function runChallengeabilityAssessment(
  supabase: SupabaseClient,
  clientId: string,
  options: {
    violationIds?: string[];
    force?: boolean;
    cursor?: string;
    evidenceContext?: ChallengeabilityEvidenceContext;
  } = {}
): Promise<ChallengeabilityRunResult> {
  const explicitViolationIds = options.violationIds?.filter(Boolean) ?? [];
  if (
    options.evidenceContext &&
    (explicitViolationIds.length !== 1 ||
      explicitViolationIds[0] !== options.evidenceContext.violationId ||
      options.evidenceContext.files.length === 0 ||
      options.evidenceContext.documentIds.length === 0)
  ) {
    throw new Error(
      "Evidence-aware challengeability requires one matching violation and at least one document"
    );
  }
  const { inspectionIds } = explicitViolationIds.length > 0
    ? { inspectionIds: [] as string[] }
    : await getCanonicalInspectionScope(clientId, supabase);
  if (explicitViolationIds.length === 0 && inspectionIds.length === 0) {
    return { requested: 0, assessed: 0, challengeable: 0, failures: [], hasMore: false, nextCursor: null };
  }

  let query = supabase
    .from("violations")
    .select("id, violation_code, violation_description, basic_category, severity_weight, oos_violation, convicted, citation_number, citation_result, challenge_tier, challenge_reason, challenge_priority, ai_assessed_at, inspections(inspection_date, state, level)")
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

  const protectedIds = new Set<string>();
  if (!options.evidenceContext) {
    const { data: appliedRequests, error: appliedError } = await supabase
      .from("client_requests")
      .select("violation_id")
      .eq("client_id", clientId)
      .eq("request_type", "evidence")
      .eq("evidence_status", "applied")
      .in(
        "violation_id",
        rows.map((row) => row.id)
      );
    if (appliedError) {
      throw new Error(
        `Unable to protect evidence-backed challengeability results: ${appliedError.message}`
      );
    }
    for (const request of appliedRequests ?? []) {
      if (request.violation_id) protectedIds.add(request.violation_id);
    }
  }

  const assessmentRows = rows.filter((row) => !protectedIds.has(row.id));
  const assessmentInputs = assessmentRows.map((row) => {
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
  });
  if (assessmentInputs.length === 0) {
    return {
      requested: rows.length,
      assessed: protectedIds.size,
      challengeable: rows.filter(
        (row) =>
          protectedIds.has(row.id) &&
          (row.challenge_tier === "strong" || row.challenge_tier === "moderate")
      ).length,
      failures: [],
      hasMore: rows.length === 20,
      nextCursor: rows.at(-1)?.id ?? null,
      preservedEvidenceBackedIds: [...protectedIds],
    };
  }
  const [{ results: rawResults, failures: modelFailures }, scoreResult, profileResult] =
    await Promise.all([
      assessViolationsBatch(
        assessmentInputs,
        undefined,
        options.evidenceContext
          ? {
              violationId: options.evidenceContext.violationId,
              files: options.evidenceContext.files,
              requestId: options.evidenceContext.requestId,
              evidenceClass: options.evidenceContext.evidenceClass,
              requestedItemKeys: options.evidenceContext.requestedItemKeys,
            }
          : undefined
      ),
      supabase
        .from("score_snapshots")
        .select("oos_vehicle_rate")
        .eq("client_id", clientId)
        .order("snapshot_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("carrier_profiles")
        .select("national_vehicle_oos_rate")
        .eq("client_id", clientId)
        .maybeSingle(),
    ]);
  if (scoreResult.error) {
    throw new Error(
      `Unable to load carrier OOS priority context: ${scoreResult.error.message}`,
    );
  }
  if (profileResult.error) {
    throw new Error(
      `Unable to load national OOS priority context: ${profileResult.error.message}`,
    );
  }
  const oosPriorityContext = {
    carrierVehicleOosRate:
      typeof scoreResult.data?.oos_vehicle_rate === "number"
        ? scoreResult.data.oos_vehicle_rate
        : null,
    nationalVehicleOosRate:
      typeof profileResult.data?.national_vehicle_oos_rate === "number"
        ? profileResult.data.national_vehicle_oos_rate
        : null,
  };
  const results = applyVehicleOosPriorityContext(
    rawResults,
    assessmentInputs,
    oosPriorityContext,
  );
  const priorityElevations = results.filter(
    (result, index) => result.priority !== rawResults[index]?.priority,
  ).length;

  const evidencePreflightFailures: AssessmentFailure[] = [];
  let evidenceContextIsCurrent = true;
  if (options.evidenceContext) {
    const target = results.find(
      (result) => result.violationId === options.evidenceContext?.violationId
    );
    if (target && !target.evidenceDecision) {
      evidencePreflightFailures.push({
        violationId: options.evidenceContext.violationId,
        error: "Evidence-aware assessment omitted its request-scoped decision",
      });
    }
    const beforeTier = rows.find(
      (row) => row.id === options.evidenceContext?.violationId
    )?.challenge_tier;
    const tierStrength: Record<string, number> = {
      not_challengeable: 0,
      operational: 0,
      investigate: 1,
      moderate: 2,
      strong: 3,
    };
    if (
      target?.evidenceDecision === "insufficient" &&
      (tierStrength[target.tier] ?? -1) >
        (beforeTier ? tierStrength[beforeTier] ?? -1 : -1)
    ) {
      evidencePreflightFailures.push({
        violationId: options.evidenceContext.violationId,
        error:
          "Insufficient request evidence cannot strengthen the violation tier",
      });
    }

    const { data: currentDocuments, error: currentDocumentsError } = await supabase
      .from("documents")
      .select("id, evidence_item_key, created_at")
      .eq("client_id", clientId)
      .eq("client_request_id", options.evidenceContext.requestId)
      .eq("violation_id", options.evidenceContext.violationId)
      .not("evidence_item_key", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    const latestByItem = new Map<string, string>();
    for (const document of currentDocuments ?? []) {
      if (
        document.evidence_item_key &&
        !latestByItem.has(document.evidence_item_key)
      ) {
        latestByItem.set(document.evidence_item_key, document.id);
      }
    }
    const currentDocumentIds = [...latestByItem.values()].sort();
    const analyzedDocumentIds = [...options.evidenceContext.documentIds].sort();
    evidenceContextIsCurrent =
      !currentDocumentsError &&
      currentDocumentIds.length === analyzedDocumentIds.length &&
      currentDocumentIds.every((id, index) => id === analyzedDocumentIds[index]);
    if (!evidenceContextIsCurrent) {
      evidencePreflightFailures.push({
        violationId: options.evidenceContext.violationId,
        error: currentDocumentsError
          ? `Unable to verify current evidence set: ${currentDocumentsError.message}`
          : "A newer request document arrived during analysis; the cumulative set remains queued for retry",
      });
    }
  }

  const evidenceBlockedIds = new Set(
    evidencePreflightFailures.map((failure) => failure.violationId)
  );
  const writableResults = results.filter(
    (result) => !evidenceBlockedIds.has(result.violationId)
  );
  const writeFailures: AssessmentFailure[] = [];
  const assessedAt = new Date().toISOString();
  for (const result of writableResults) {
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
  const persisted = writableResults.filter((result) => !failedWriteIds.has(result.violationId));
  const allFailures = [
    ...modelFailures,
    ...evidencePreflightFailures,
    ...writeFailures,
  ];
  try {
  let evidenceAnalysis: ChallengeabilityEvidenceAnalysis | undefined;
  if (options.evidenceContext) {
    const targetResult = persisted.find(
      (result) => result.violationId === options.evidenceContext?.violationId
    );
    const evidenceDecision = targetResult?.evidenceDecision ?? null;
    const evidenceFailures = allFailures.filter(
      (failure) => failure.violationId === options.evidenceContext?.violationId
    );
    if (targetResult && !evidenceDecision) {
      evidenceFailures.push({
        violationId: options.evidenceContext.violationId,
        error: "Evidence-aware assessment omitted its request-scoped decision",
      });
    }
    evidenceAnalysis = {
      status:
        targetResult && evidenceDecision && evidenceContextIsCurrent
          ? "completed"
          : "failed",
      analyzedAt: assessedAt,
      requestId: options.evidenceContext.requestId,
      violationId: options.evidenceContext.violationId,
      documentIds: [...options.evidenceContext.documentIds],
      evidenceClass: options.evidenceContext.evidenceClass,
      requestedItemKeys: [...options.evidenceContext.requestedItemKeys],
      model: CHALLENGEABILITY_EVIDENCE_MODEL_SLUG,
      decision: evidenceContextIsCurrent ? evidenceDecision ?? "failed" : "failed",
      assessment: targetResult ?? null,
      failures: evidenceFailures,
    };
    await persistEvidenceAnalysis(supabase, clientId, evidenceAnalysis);
  }
  if (persisted.length > 0) {
    const { data: activity, error: activityError } = await supabase
      .from("activity_log")
      .insert({
        client_id: clientId,
        action_type: "violation_assessed",
        entity_type: "violations",
        description: `AI assessed ${persisted.length} violations - ${persisted.filter((result) => result.challengeable).length} flagged as challengeable`,
        metadata: {
          oos_priority_context: oosPriorityContext,
          priority_elevations: priorityElevations,
          rule: "vehicle_oos_above_national_bumps_existing_challenge_one_band",
        },
      })
      .select("id")
      .maybeSingle();
    if (activityError || !activity) {
      throw new Error(
        `Challengeability results were saved, but activity logging failed: ${
          activityError?.message ?? "row not inserted"
        }`
      );
    }

    const evidenceRequests = await reconcileLaneBEvidenceRequests(supabase, {
      clientId,
      violationIds: persisted.map((result) => result.violationId),
      trigger: "challengeability",
    });
    if (evidenceRequests.errors.length > 0) {
      throw new Error(
        `Challengeability results were saved, but Lane B request reconciliation failed: ${evidenceRequests.errors.join(" | ")}`
      );
    }

    if (options.evidenceContext && evidenceAnalysis?.status === "completed") {
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const target = persisted.find(
        (result) => result.violationId === options.evidenceContext?.violationId
      );
      if (!target) {
        throw new Error("Evidence analysis completed without a persisted target result");
      }
      const advancedRequests = await advanceSubmittedLaneBRequests(supabase, {
        clientId,
        requestId: options.evidenceContext.requestId,
        outcomes: [
          {
            violationId: target.violationId,
            beforeTier: rowsById.get(target.violationId)?.challenge_tier ?? null,
            afterTier: target.tier,
            analysisDecision: evidenceAnalysis.decision,
          },
        ],
        trigger: "evidence_upload",
      });
      if (advancedRequests.errors.length > 0) {
        throw new Error(
          `Evidence analysis was saved, but request lifecycle update failed: ${advancedRequests.errors.join(" | ")}`
        );
      }
    }
  }

  return {
    requested: rows.length,
    assessed: persisted.length + protectedIds.size,
    challengeable:
      persisted.filter((result) => result.challengeable).length +
      rows.filter(
        (row) =>
          protectedIds.has(row.id) &&
          (row.challenge_tier === "strong" || row.challenge_tier === "moderate")
      ).length,
    failures: allFailures,
    hasMore: rows.length === 20,
    nextCursor: rows.at(-1)?.id ?? null,
    evidenceAnalysis,
    preservedEvidenceBackedIds: [...protectedIds],
  };
  } catch (error) {
    if (options.evidenceContext) {
      const original = rows.find(
        (row) => row.id === options.evidenceContext?.violationId
      );
      const targetWasWritten = persisted.some(
        (result) => result.violationId === options.evidenceContext?.violationId
      );
      if (original && targetWasWritten) {
        const { data: rolledBack, error: rollbackError } = await supabase
          .from("violations")
          .update({
            challenge_tier: original.challenge_tier,
            challenge_reason: original.challenge_reason,
            challenge_priority: original.challenge_priority,
            ai_assessed_at: original.ai_assessed_at,
          })
          .eq("client_id", clientId)
          .eq("id", original.id)
          .select("id")
          .maybeSingle();
        if (rollbackError || !rolledBack) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; ` +
              `violation rollback also failed: ${
                rollbackError?.message ?? "row not updated"
              }`
          );
        }
      }
    }
    throw error;
  }
}
