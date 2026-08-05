import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectEvidenceMimeType } from "@/lib/ai/openrouter";
import {
  assessParForCpdp,
  ParAssessmentFailure,
  type ParAssessmentCrashContext,
} from "@/lib/cpdp/par-assessment-server";
import { eligibleTypesFromQuestions } from "@/lib/cpdp/par-assessment-types";

export const PAR_FUNCTION_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const PAR_REMOTE_FETCH_MAX_BYTES = 8 * 1024 * 1024;
export const PAR_ASSESSMENT_LEASE_MS = 5 * 60 * 1000;
const ALLOWED_PAR_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type IntakeSource = "manual" | "lexisnexis";

export type ParIntakeInput = {
  caseId: string;
  evidenceId?: string;
  filename: string;
  declaredMimeType: string | null;
  bytes: Buffer;
  source: IntakeSource;
  actorUserId: string | null;
  localReportNumber?: string | null;
  providerReference?: string | null;
};

export type ParIntakeResult = {
  caseId: string;
  crashId: string;
  clientId: string;
  evidenceId: string;
  documentId: string;
  storagePath: string;
  contentSha256: string;
  assessment: Awaited<ReturnType<typeof assessParForCpdp>>["assessment"];
  suggestedTypes: string[];
  alreadyReceived: boolean;
};

export class ParIntakeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly stored: boolean = false,
    readonly identifiers: Partial<ParIntakeResult> = {}
  ) {
    super(message);
    this.name = "ParIntakeError";
  }
}

function safeFilename(filename: string, mimeType: string) {
  const fallback = mimeType === "application/pdf" ? "police-accident-report.pdf" : "police-accident-report-image";
  const normalized = filename.trim() || fallback;
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
}

function normalizeMime(bytes: Buffer, declaredMimeType: string | null) {
  const detected = detectEvidenceMimeType(bytes);
  if (!detected || !ALLOWED_PAR_MIMES.has(detected)) {
    throw new ParIntakeError("PAR must be a valid PDF, JPEG, PNG, or WebP file.", 422);
  }
  if (declaredMimeType && declaredMimeType !== "application/octet-stream" && declaredMimeType !== detected) {
    throw new ParIntakeError(
      `PAR bytes are ${detected}, not the declared ${declaredMimeType} type.`,
      422
    );
  }
  return detected;
}

export function isParAssessmentLeaseStale(
  attemptedAt: unknown,
  nowMs = Date.now()
) {
  if (typeof attemptedAt !== "string") return true;
  const attemptedMs = Date.parse(attemptedAt);
  return !Number.isFinite(attemptedMs) || nowMs - attemptedMs >= PAR_ASSESSMENT_LEASE_MS;
}

async function ensureParEvidence(
  service: SupabaseClient,
  caseId: string,
  evidenceId?: string
) {
  if (evidenceId) {
    const result = await service
      .from("cpdp_evidence")
      .select("id, case_id, doc_type")
      .eq("id", evidenceId)
      .eq("case_id", caseId)
      .eq("doc_type", "police_report")
      .maybeSingle();
    if (result.error) throw new ParIntakeError(`Unable to verify PAR evidence row: ${result.error.message}`, 500);
    if (!result.data) throw new ParIntakeError("PAR evidence row was not found for this case.", 404);
    return result.data.id as string;
  }

  const existing = await service
    .from("cpdp_evidence")
    .select("id")
    .eq("case_id", caseId)
    .eq("doc_type", "police_report")
    .maybeSingle();
  if (existing.error) throw new ParIntakeError(`Unable to load PAR evidence row: ${existing.error.message}`, 500);
  if (existing.data) return existing.data.id as string;

  const inserted = await service
    .from("cpdp_evidence")
    .insert({
      case_id: caseId,
      doc_type: "police_report",
      label: "Police Accident Report (PAR)",
      context_note: "Official Police Accident Report required for CPDP review.",
      fmcsa_category: "Police Accident Report",
      required: true,
      status: "requested",
    })
    .select("id")
    .single();
  if (inserted.error?.code === "23505") {
    const concurrent = await service
      .from("cpdp_evidence")
      .select("id")
      .eq("case_id", caseId)
      .eq("doc_type", "police_report")
      .single();
    if (!concurrent.error && concurrent.data) return concurrent.data.id as string;
  }
  if (inserted.error || !inserted.data) {
    throw new ParIntakeError(
      `Unable to create PAR evidence row: ${inserted.error?.message ?? "no row returned"}`,
      500
    );
  }
  return inserted.data.id as string;
}

function relationOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function loadContext(service: SupabaseClient, caseId: string) {
  const result = await service
    .from("cpdp_cases")
    .select(`
      id, client_id, crash_id, status, par_assessment_status,
      par_assessment_error, par_assessment_attempted_at,
      crashes(
        id, report_number, crash_date, city, state, location,
        fatalities, injuries, tow_away, hazmat_release,
        par_document_id, par_content_sha256
      ),
      clients(name, dot_number)
    `)
    .eq("id", caseId)
    .single();
  if (result.error || !result.data) {
    throw new ParIntakeError(
      `Unable to load CPDP case: ${result.error?.message ?? "case not found"}`,
      result.error?.code === "PGRST116" ? 404 : 500
    );
  }
  if (result.data.status !== "draft") {
    throw new ParIntakeError("A PAR can only be added or replaced while the CPDP case is in draft.", 409);
  }
  const crash = relationOne(result.data.crashes as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
  const client = relationOne(result.data.clients as unknown as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!crash || !client) throw new ParIntakeError("CPDP case is missing crash or client context.", 500);
  return {
    caseRow: result.data,
    crash,
    client,
  };
}

export async function createCpdpCaseForCrash(
  service: SupabaseClient,
  input: { crashId: string; actorUserId: string | null }
) {
  const crashResult = await service
    .from("crashes")
    .select("id, client_id")
    .eq("id", input.crashId)
    .single();
  if (crashResult.error || !crashResult.data) {
    throw new ParIntakeError(
      `Crash not found: ${crashResult.error?.message ?? input.crashId}`,
      404
    );
  }
  const existing = await service
    .from("cpdp_cases")
    .select("id")
    .eq("crash_id", input.crashId)
    .maybeSingle();
  if (existing.error) throw new ParIntakeError(`Unable to check CPDP case: ${existing.error.message}`, 500);
  if (existing.data) return existing.data.id as string;

  const inserted = await service
    .from("cpdp_cases")
    .insert({
      client_id: crashResult.data.client_id,
      crash_id: input.crashId,
      status: "draft",
      created_by: input.actorUserId,
      par_assessment_status: "awaiting_par",
    })
    .select("id")
    .single();
  if (inserted.error?.code === "23505") {
    const concurrent = await service
      .from("cpdp_cases")
      .select("id")
      .eq("crash_id", input.crashId)
      .single();
    if (!concurrent.error && concurrent.data) return concurrent.data.id as string;
  }
  if (inserted.error || !inserted.data) {
    throw new ParIntakeError(
      `Unable to create CPDP case: ${inserted.error?.message ?? "no row returned"}`,
      500
    );
  }
  const activity = await service.from("activity_log").insert({
    client_id: crashResult.data.client_id,
    user_id: input.actorUserId,
    action_type: "case_created",
    entity_type: "cpdp_cases",
    entity_id: inserted.data.id,
    description: `CPDP case created for crash ${input.crashId}`,
  });
  if (activity.error) throw new ParIntakeError(`CPDP case was created but activity logging failed: ${activity.error.message}`, 500);
  return inserted.data.id as string;
}

export async function ingestPar(
  service: SupabaseClient,
  input: ParIntakeInput
): Promise<ParIntakeResult> {
  if (input.bytes.length === 0) throw new ParIntakeError("PAR file is empty.", 422);
  const sizeLimit = input.source === "manual"
    ? PAR_FUNCTION_UPLOAD_MAX_BYTES
    : PAR_REMOTE_FETCH_MAX_BYTES;
  if (input.bytes.length > sizeLimit) {
    throw new ParIntakeError(
      `PAR exceeds the ${Math.floor(sizeLimit / 1024 / 1024)} MB ${input.source} intake limit.`,
      413
    );
  }
  const mimeType = normalizeMime(input.bytes, input.declaredMimeType);
  const contentSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const { caseRow, crash, client } = await loadContext(service, input.caseId);
  const evidenceId = await ensureParEvidence(service, input.caseId, input.evidenceId);
  const clientId = caseRow.client_id as string;
  const crashId = caseRow.crash_id as string;
  let alreadyReceived = false;
  let documentId: string;
  let storagePath: string;

  if (crash.par_content_sha256 === contentSha256 && crash.par_document_id) {
    const caseReload = await service
      .from("cpdp_cases")
      .select("par_ai_assessment, par_assessment_status, par_assessment_attempted_at")
      .eq("id", input.caseId)
      .single();
    if (caseReload.error || !caseReload.data) {
      throw new ParIntakeError(
        `Unable to reload the existing PAR assessment: ${caseReload.error?.message ?? "case unavailable"}`,
        500
      );
    }
    const storedDocument = await service
      .from("documents")
      .select("storage_path")
      .eq("id", crash.par_document_id as string)
      .single();
    if (storedDocument.error || !storedDocument.data) {
      throw new ParIntakeError("The linked PAR document row is unavailable.", 500);
    }
    if (
      caseReload.data.par_ai_assessment &&
      ["ready_for_review", "approved"].includes(
        String(caseReload.data.par_assessment_status)
      )
    ) {
      const assessment = caseReload.data.par_ai_assessment as ParIntakeResult["assessment"];
      return {
        caseId: input.caseId,
        crashId,
        clientId,
        evidenceId,
        documentId: crash.par_document_id as string,
        storagePath: storedDocument.data.storage_path,
        contentSha256,
        assessment,
        suggestedTypes: eligibleTypesFromQuestions(assessment.questions),
        alreadyReceived: true,
      };
    }
    if (
      caseReload.data.par_assessment_status === "assessing" &&
      !isParAssessmentLeaseStale(caseReload.data.par_assessment_attempted_at)
    ) {
      throw new ParIntakeError("This PAR is already being assessed. Retry after the current assessment finishes.", 409);
    }
    alreadyReceived = true;
    documentId = crash.par_document_id as string;
    storagePath = storedDocument.data.storage_path as string;
  } else {
    documentId = randomUUID();
    const filename = safeFilename(input.filename, mimeType);
    storagePath = `${clientId}/cpdp-par/${input.caseId}/${documentId}/${filename}`;
  }

  const startingAssessmentStatus = String(
    caseRow.par_assessment_status ?? "awaiting_par"
  );
  const staleAssessmentReclaimed =
    startingAssessmentStatus === "assessing" &&
    isParAssessmentLeaseStale(caseRow.par_assessment_attempted_at);
  if (startingAssessmentStatus === "assessing" && !staleAssessmentReclaimed) {
    throw new ParIntakeError("Another PAR intake is already assessing this crash.", 409);
  }
  const claimAttemptedAt = new Date().toISOString();
  let claimQuery = service
    .from("cpdp_cases")
    .update({
      par_assessment_status: "assessing",
      par_assessment_error: null,
      par_assessment_attempted_at: claimAttemptedAt,
    })
    .eq("id", input.caseId)
    .eq("par_assessment_status", startingAssessmentStatus);
  if (startingAssessmentStatus === "assessing") {
    claimQuery = typeof caseRow.par_assessment_attempted_at === "string"
      ? claimQuery.eq(
          "par_assessment_attempted_at",
          caseRow.par_assessment_attempted_at
        )
      : claimQuery.is("par_assessment_attempted_at", null);
  }
  const claim = await claimQuery
    .select("id")
    .maybeSingle();
  if (claim.error) {
    throw new ParIntakeError(`Unable to claim PAR assessment: ${claim.error.message}`, 500);
  }
  if (!claim.data) {
    throw new ParIntakeError("Another PAR intake won the assessment claim. Retry after it finishes.", 409);
  }

  const filename = safeFilename(input.filename, mimeType);
  if (!alreadyReceived) {
    const upload = await service.storage.from("documents").upload(storagePath, input.bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (upload.error) {
      await service.from("cpdp_cases").update({
        par_assessment_status: startingAssessmentStatus,
        par_assessment_error: caseRow.par_assessment_error ?? null,
      }).eq("id", input.caseId).eq("par_assessment_status", "assessing");
      throw new ParIntakeError(`PAR storage upload failed: ${upload.error.message}`, 500);
    }

    const documentInsert = await service
      .from("documents")
      .insert({
        id: documentId,
        client_id: clientId,
        storage_path: storagePath,
        filename,
        file_size: input.bytes.length,
        mime_type: mimeType,
        category: "evidence",
        status: "pending_review",
        uploaded_by: input.actorUserId,
        case_type: "cpdp",
        case_id: input.caseId,
      })
      .select("id")
      .single();
    if (documentInsert.error || !documentInsert.data) {
      await service.from("cpdp_cases").update({
        par_assessment_status: startingAssessmentStatus,
        par_assessment_error: caseRow.par_assessment_error ?? null,
      }).eq("id", input.caseId).eq("par_assessment_status", "assessing");
      throw new ParIntakeError(
        `PAR bytes were stored but the document row failed: ${documentInsert.error?.message ?? "no row returned"}`,
        500,
        true,
        { caseId: input.caseId, crashId, clientId, evidenceId, documentId, storagePath, contentSha256 }
      );
    }
  }

  const now = new Date().toISOString();
  const [crashUpdate, evidenceUpdate, caseUpdate] = await Promise.all([
    service.from("crashes").update({
      par_document_id: documentId,
      par_document_source: input.source,
      par_received_at: now,
      par_local_report_number: input.localReportNumber ?? null,
      par_content_sha256: contentSha256,
      cpdp_eligible: null,
      cpdp_eligible_types: null,
      ai_assessed_at: null,
    }).eq("id", crashId),
    service.from("cpdp_evidence").update({
      status: "received",
      storage_path: storagePath,
      document_id: documentId,
      uploaded_at: now,
      uploaded_by: input.actorUserId ?? input.source,
    }).eq("id", evidenceId),
    service.from("cpdp_cases").update({
      par_assessment_status: "assessing",
      par_assessment_error: null,
      par_assessment_attempted_at: now,
      par_assessment_document_id: documentId,
      par_ai_assessment: null,
      par_review_assessment: null,
      par_assessment_overrides: null,
      par_reviewed_at: null,
      par_reviewed_by: null,
      par_identity_confirmed: false,
      par_confirmed_at: null,
      par_confirmed_by: null,
      narrative_evidence_verified: false,
      narrative_verified_at: null,
      narrative_verified_by: null,
      cpdp_eligible_types: null,
      ai_assessed_at: null,
      ai_eligibility_verdict: null,
      ai_eligibility_rationale: null,
      ai_suggested_types: null,
      ai_narrative: null,
      final_narrative: null,
      updated_at: now,
    }).eq("id", input.caseId),
  ]);
  const linkageError = crashUpdate.error ?? evidenceUpdate.error ?? caseUpdate.error;
  if (linkageError) {
    await service.from("cpdp_cases").update({
      par_assessment_status: "failed",
      par_assessment_error: `PAR linkage failed: ${linkageError.message}`,
    }).eq("id", input.caseId).eq("par_assessment_status", "assessing");
    throw new ParIntakeError(
      `PAR document was stored but linkage failed: ${linkageError.message}`,
      500,
      true,
      { caseId: input.caseId, crashId, clientId, evidenceId, documentId, storagePath, contentSha256 }
    );
  }

  const receivedActivity = await service.from("activity_log").insert({
    client_id: clientId,
    user_id: input.actorUserId,
    action_type: alreadyReceived
      ? "cpdp_par_assessment_retried"
      : "cpdp_par_received",
    entity_type: "cpdp_cases",
    entity_id: input.caseId,
    description: alreadyReceived
      ? "Stored Police Accident Report assessment retried"
      : `Police Accident Report received through ${input.source} intake`,
    metadata: {
      crash_id: crashId,
      document_id: documentId,
      source: input.source,
      provider_reference: input.providerReference ?? null,
      content_sha256: contentSha256,
      file_size: input.bytes.length,
      mime_type: mimeType,
      stale_assessment_reclaimed: staleAssessmentReclaimed,
    },
  });
  if (receivedActivity.error) {
    await service.from("cpdp_cases").update({
      par_assessment_status: "failed",
      par_assessment_error: `PAR activity logging failed: ${receivedActivity.error.message}`,
    }).eq("id", input.caseId).eq("par_assessment_status", "assessing");
    throw new ParIntakeError(`PAR was linked but activity logging failed: ${receivedActivity.error.message}`, 500, true);
  }

  const crashContext: ParAssessmentCrashContext = {
    carrierName: String(client.name ?? ""),
    dotNumber: String(client.dot_number ?? ""),
    fmcsaReportNumber: crash.report_number ? String(crash.report_number) : null,
    crashDate: String(crash.crash_date),
    city: crash.city ? String(crash.city) : null,
    state: crash.state ? String(crash.state) : null,
    location: crash.location ? String(crash.location) : null,
    fatalities: Number(crash.fatalities ?? 0),
    injuries: Number(crash.injuries ?? 0),
    towAway: Boolean(crash.tow_away),
    hazmatRelease: Boolean(crash.hazmat_release),
  };

  try {
    const assessed = await assessParForCpdp(crashContext, { filename, mimeType, bytes: input.bytes });
    const assessment = assessed.assessment;
    const suggestedTypes = eligibleTypesFromQuestions(assessment.questions);
    const assessmentUpdate = await service.from("cpdp_cases").update({
      par_ai_assessment: assessment,
      par_assessment_status: "ready_for_review",
      par_assessment_model: assessment.model,
      par_assessment_error: null,
      ai_assessed_at: assessment.assessedAt,
      ai_eligibility_verdict: assessment.verdict,
      ai_eligibility_rationale: assessment.overallReasoning,
      ai_suggested_types: suggestedTypes,
      ai_narrative: assessment.draftedNarrative,
      updated_at: assessment.assessedAt,
    }).eq("id", input.caseId);
    if (assessmentUpdate.error) {
      throw new Error(`Assessment completed but could not be persisted: ${assessmentUpdate.error.message}`);
    }
    const assessmentActivity = await service.from("activity_log").insert({
      client_id: clientId,
      action_type: "cpdp_par_assessment_succeeded",
      entity_type: "cpdp_cases",
      entity_id: input.caseId,
      description: "PAR identity and all 21 CPDP questions assessed; awaiting human approval",
      metadata: {
        crash_id: crashId,
        document_id: documentId,
        model: assessment.model,
        document_mode: assessment.documentMode,
        verdict: assessment.verdict,
        confidence: assessment.confidence,
        suggested_types: suggestedTypes,
        attempts: assessed.attempts.map((attempt) => ({
          attempt: attempt.attempt,
          ok: attempt.ok,
          error: attempt.error,
        })),
      },
    });
    if (assessmentActivity.error) throw new Error(`Assessment logging failed: ${assessmentActivity.error.message}`);
    return {
      caseId: input.caseId,
      crashId,
      clientId,
      evidenceId,
      documentId,
      storagePath,
      contentSha256,
      assessment,
      suggestedTypes,
      alreadyReceived,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PAR assessment error";
    const attempts = error instanceof ParAssessmentFailure ? error.attempts : [];
    await service.from("cpdp_cases").update({
      par_assessment_status: "failed",
      par_assessment_error: message,
      updated_at: new Date().toISOString(),
    }).eq("id", input.caseId);
    await service.from("activity_log").insert({
      client_id: clientId,
      action_type: "cpdp_par_assessment_failed",
      entity_type: "cpdp_cases",
      entity_id: input.caseId,
      description: "PAR was stored, but AI assessment failed",
      metadata: {
        crash_id: crashId,
        document_id: documentId,
        error: message,
        attempts: attempts.map((attempt) => ({
          attempt: attempt.attempt,
          error: attempt.error,
          raw_output: attempt.rawOutput,
        })),
      },
    });
    throw new ParIntakeError(
      `PAR was stored, but its AI assessment failed: ${message}`,
      502,
      true,
      { caseId: input.caseId, crashId, clientId, evidenceId, documentId, storagePath, contentSha256 }
    );
  }
}
