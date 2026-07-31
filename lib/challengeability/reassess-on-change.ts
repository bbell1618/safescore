import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChallengeabilityEvidenceContext,
  ChallengeabilityRunResult,
} from "@/lib/analysis/challengeability-assessment-server";
import {
  CHALLENGEABILITY_EVIDENCE_MAX_BYTES,
  CHALLENGEABILITY_EVIDENCE_MIME_TYPES,
  CHALLENGEABILITY_EVIDENCE_TOTAL_MAX_BYTES,
  type EvidenceFile,
} from "@/lib/ai/openrouter";
import {
  challengeableForTier,
  type ChallengeTier,
} from "@/lib/analysis/challengeability-rubric";

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
  options: {
    violationIds: string[];
    force: true;
    evidenceContext?: ChallengeabilityEvidenceContext;
  }
) => Promise<ChallengeabilityRunResult>;

type ReassessmentChange = {
  clientId: string;
  violationId: string;
  before: ViolationEnrichmentRow;
  after: ViolationEnrichmentRow;
};

type ReassessmentDependencies = {
  assess?: TargetedChallengeabilityAssessment;
  loadEvidence?: typeof loadLaneBEvidenceContext;
};

export type EvidenceReassessmentResult = {
  beforeTier: ChallengeTier | null;
  afterTier: ChallengeTier | null;
  strengthened: boolean;
  challengeableAfter: boolean;
  assessment: ChallengeabilityRunResult;
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

const CHALLENGE_TIER_STRENGTH: Record<ChallengeTier, number> = {
  not_challengeable: 0,
  operational: 0,
  investigate: 1,
  moderate: 2,
  strong: 3,
};

type LaneBEvidenceRequestRow = {
  id: string;
  evidence_class: string | null;
  requested_items: Array<{ itemKey?: string }> | null;
};

type LaneBEvidenceDocumentRow = {
  id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  file_size: number;
  evidence_item_key: string | null;
  evidence_class: string | null;
};

async function persistEvidenceLoadFailure(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    violationId: string;
    requestId: string;
    documentIds: string[];
    reason: string;
  }
) {
  const failedAt = new Date().toISOString();
  const failure = {
    status: "failed",
    stage: "load",
    failedAt,
    requestId: input.requestId,
    violationId: input.violationId,
    documentIds: input.documentIds,
    reason: input.reason,
  };
  const { data: updatedDocuments, error: documentError } = await supabase
    .from("documents")
    .update({ evidence_analysis: failure })
    .eq("client_id", input.clientId)
    .eq("client_request_id", input.requestId)
    .in("id", input.documentIds)
    .select("id");
  const { data: updatedRequest, error: requestError } = await supabase
    .from("client_requests")
    .update({
      status_copy:
        "Evidence received — the automatic review could not read every file and will retry.",
      updated_at: failedAt,
    })
    .eq("id", input.requestId)
    .eq("client_id", input.clientId)
    .eq("evidence_status", "submitted")
    .select("id")
    .maybeSingle();
  const { data: activity, error: activityError } = await supabase
    .from("activity_log")
    .insert({
      client_id: input.clientId,
      action_type: "challengeability_evidence_analysis_failed",
      entity_type: "client_requests",
      entity_id: input.requestId,
      description:
        "Uploaded evidence could not be read and remains queued for automatic retry",
      metadata: {
        violation_id: input.violationId,
        document_ids: input.documentIds,
        stage: "load",
        reason: input.reason,
      },
    })
    .select("id")
    .maybeSingle();
  const failures = [
    documentError || (updatedDocuments ?? []).length !== input.documentIds.length
      ? `document failure record: ${
          documentError?.message ??
          `updated ${(updatedDocuments ?? []).length} of ${input.documentIds.length}`
        }`
      : null,
    requestError || !updatedRequest
      ? `request failure state: ${requestError?.message ?? "row not updated"}`
      : null,
    activityError || !activity
      ? `failure activity: ${activityError?.message ?? "row not inserted"}`
      : null,
  ].filter((value): value is string => Boolean(value));
  if (failures.length > 0) {
    throw new Error(`${input.reason}; failure recording also failed: ${failures.join("; ")}`);
  }
}

export async function loadLaneBEvidenceContext(
  supabase: SupabaseClient,
  input: { clientId: string; violationId: string; requestId: string }
): Promise<ChallengeabilityEvidenceContext> {
  const { data: request, error: requestError } = await supabase
    .from("client_requests")
    .select("id, evidence_class, requested_items")
    .eq("id", input.requestId)
    .eq("client_id", input.clientId)
    .eq("violation_id", input.violationId)
    .eq("request_type", "evidence")
    .eq("evidence_status", "submitted")
    .single();
  if (requestError || !request) {
    throw new Error(
      `Unable to load submitted evidence request: ${
        requestError?.message ?? "row not found"
      }`
    );
  }
  const requestRow = request as unknown as LaneBEvidenceRequestRow;
  if (!requestRow.evidence_class) {
    throw new Error("Submitted evidence request has no evidence class");
  }
  const requestedItemKeys = (requestRow.requested_items ?? []).flatMap((item) =>
    typeof item.itemKey === "string" ? [item.itemKey] : []
  );

  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select(
      "id, storage_path, filename, mime_type, file_size, evidence_item_key, evidence_class"
    )
    .eq("client_id", input.clientId)
    .eq("client_request_id", input.requestId)
    .eq("violation_id", input.violationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (documentsError) {
    throw new Error(`Unable to load linked evidence documents: ${documentsError.message}`);
  }
  const allDocumentRows = (documents ?? []) as unknown as LaneBEvidenceDocumentRow[];
  const latestByItem = new Map<string, LaneBEvidenceDocumentRow>();
  for (const document of allDocumentRows) {
    if (
      document.evidence_item_key &&
      !latestByItem.has(document.evidence_item_key)
    ) {
      latestByItem.set(document.evidence_item_key, document);
    }
  }
  const documentRows = [...latestByItem.values()];
  if (documentRows.length === 0) {
    throw new Error("Submitted evidence request has no linked documents");
  }
  const documentIds = documentRows.map((document) => document.id);

  try {
    let totalBytes = 0;
    const files: EvidenceFile[] = [];
    for (const document of documentRows) {
      if (
        document.evidence_class !== requestRow.evidence_class ||
        !document.evidence_item_key ||
        !requestedItemKeys.includes(document.evidence_item_key)
      ) {
        throw new Error(
          `Document ${document.id} does not match the request evidence class and item list`
        );
      }
      if (
        !CHALLENGEABILITY_EVIDENCE_MIME_TYPES.has(document.mime_type) ||
        document.file_size <= 0 ||
        document.file_size > CHALLENGEABILITY_EVIDENCE_MAX_BYTES
      ) {
        throw new Error(
          `Document ${document.id} is not a supported PDF/JPEG/PNG/WebP/text file within 8 MB`
        );
      }
      const { data: blob, error: downloadError } = await supabase.storage
        .from("documents")
        .download(document.storage_path);
      if (downloadError || !blob) {
        throw new Error(
          `Document ${document.id} could not be downloaded: ${
            downloadError?.message ?? "empty storage response"
          }`
        );
      }
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (bytes.length !== document.file_size || bytes.length === 0) {
        throw new Error(
          `Document ${document.id} size does not match its stored metadata`
        );
      }
      totalBytes += bytes.length;
      if (totalBytes > CHALLENGEABILITY_EVIDENCE_TOTAL_MAX_BYTES) {
        throw new Error("Linked evidence exceeds the 16 MB combined analysis limit");
      }
      files.push({
        documentId: document.id,
        itemKey: document.evidence_item_key,
        label: document.filename,
        mimeType: document.mime_type,
        base64Data: bytes.toString("base64"),
        sizeBytes: bytes.length,
      });
    }
    return {
      requestId: input.requestId,
      violationId: input.violationId,
      documentIds,
      files,
      evidenceClass: requestRow.evidence_class,
      requestedItemKeys,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await persistEvidenceLoadFailure(supabase, { ...input, documentIds, reason });
    throw new Error(reason);
  }
}

function challengeTier(value: unknown): ChallengeTier | null {
  return typeof value === "string" && value in CHALLENGE_TIER_STRENGTH
    ? (value as ChallengeTier)
    : null;
}

/**
 * U10 evidence-upload primitive. The upload itself is attached before this
 * call; this forces the existing classifier to re-read the violation's
 * attached evidence bytes and records the before/after decision. The model
 * must return an explicit supported/insufficient outcome grounded in a real
 * document ID; loading, model, or validation failures remain submitted.
 */
export async function reassessViolationAfterEvidence(
  supabase: SupabaseClient,
  input: { clientId: string; violationId: string; requestId: string },
  dependencies: ReassessmentDependencies = {}
): Promise<EvidenceReassessmentResult> {
  const { data: before, error: beforeError } = await supabase
    .from("violations")
    .select("id, challenge_tier")
    .eq("id", input.violationId)
    .eq("client_id", input.clientId)
    .single();
  if (beforeError || !before) {
    throw new Error(
      `Unable to load violation before evidence reassessment: ${
        beforeError?.message ?? "row not found"
      }`
    );
  }

  const assess = dependencies.assess ?? runTargetedAssessment;
  const loadEvidence = dependencies.loadEvidence ?? loadLaneBEvidenceContext;
  const evidenceContext = await loadEvidence(supabase, input);
  const assessment = await assess(supabase, input.clientId, {
    violationIds: [input.violationId],
    force: true,
    evidenceContext,
  });
  if (assessment.failures.length > 0) {
    const details = assessment.failures
      .map((failure) => `${failure.violationId}: ${failure.error}`)
      .join("; ");
    throw new Error(`Evidence challengeability reassessment failed: ${details}`);
  }
  if (assessment.requested !== 1 || assessment.assessed !== 1) {
    throw new Error(
      `Evidence challengeability reassessment persisted ${assessment.assessed} of ${assessment.requested} requested violations`
    );
  }
  if (
    !assessment.evidenceAnalysis ||
    assessment.evidenceAnalysis.requestId !== input.requestId ||
    assessment.evidenceAnalysis.status !== "completed"
  ) {
    throw new Error(
      "Evidence challengeability reassessment did not persist a completed request-scoped analysis"
    );
  }

  const { data: after, error: afterError } = await supabase
    .from("violations")
    .select("id, challenge_tier")
    .eq("id", input.violationId)
    .eq("client_id", input.clientId)
    .single();
  if (afterError || !after) {
    throw new Error(
      `Unable to load violation after evidence reassessment: ${
        afterError?.message ?? "row not found"
      }`
    );
  }

  const beforeTier = challengeTier(before.challenge_tier);
  const afterTier = challengeTier(after.challenge_tier);
  const challengeableAfter = afterTier ? challengeableForTier(afterTier) : false;
  const strengthened = Boolean(
    afterTier &&
      challengeableAfter &&
      CHALLENGE_TIER_STRENGTH[afterTier] >
        (beforeTier ? CHALLENGE_TIER_STRENGTH[beforeTier] : -1)
  );

  return {
    beforeTier,
    afterTier,
    strengthened,
    challengeableAfter,
    assessment,
  };
}

export async function retrySubmittedLaneBEvidenceRequests(
  supabase: SupabaseClient,
  clientId: string,
  limit = 5
) {
  const { data: requests, error } = await supabase
    .from("client_requests")
    .select("id, violation_id")
    .eq("client_id", clientId)
    .eq("request_type", "evidence")
    .eq("evidence_status", "submitted")
    .not("violation_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`Unable to load submitted evidence retries: ${error.message}`);
  }

  const completedRequestIds: string[] = [];
  const errors: string[] = [];
  for (const request of requests ?? []) {
    if (!request.violation_id) continue;
    try {
      await reassessViolationAfterEvidence(supabase, {
        clientId,
        violationId: request.violation_id,
        requestId: request.id,
      });
      completedRequestIds.push(request.id);
    } catch (retryError) {
      errors.push(
        `${request.id}: ${
          retryError instanceof Error ? retryError.message : String(retryError)
        }`
      );
    }
  }
  return {
    attempted: (requests ?? []).length,
    completedRequestIds,
    errors,
  };
}

async function runTargetedAssessment(
  supabase: SupabaseClient,
  clientId: string,
  options: Parameters<TargetedChallengeabilityAssessment>[2]
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
