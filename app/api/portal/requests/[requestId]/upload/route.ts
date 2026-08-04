import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { REQUEST_UPLOAD_MAX_BYTES, REQUEST_UPLOAD_MIMES, safeFilename } from "@/lib/request-queue/upload";
import { syncClientEvidenceRequest, type RequestedEvidenceItem } from "@/lib/request-queue/sync";
import { getPortalApiAccess } from "@/lib/portal/access";
import { tierHasFeature } from "@/lib/tiers";
import { reassessViolationAfterEvidence } from "@/lib/challengeability/reassess-on-change";
import { remainingLaneBEvidenceItems } from "@/lib/evidence-loop/lifecycle";
import {
  buildChallengeabilityEvidenceContent,
  CHALLENGEABILITY_EVIDENCE_MAX_BYTES,
  CHALLENGEABILITY_EVIDENCE_MIME_TYPES,
  CHALLENGEABILITY_EVIDENCE_TOTAL_MAX_BYTES,
} from "@/lib/ai/openrouter";
import { bridgeLaneBRequestToDataqCase } from "@/lib/evidence-loop/dataq-bridge";
import { notifyOperations } from "@/lib/notifications/operations";

export const maxDuration = 60;

type LaneBRequestedItem = {
  itemKey: string;
  label: string;
  contextNote: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const access = await getPortalApiAccess("evidence_requests");
  if (access.status === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (access.status !== "linked") return NextResponse.json({ error: "Client account not linked" }, { status: 403 });
  if (!access.allowed) return NextResponse.json({ error: "Evidence requests are not included in this plan" }, { status: 403 });
  const service = await createServiceClient();

  const { data: queueItem, error: queueError } = await service
    .from("client_requests")
    .select(
      "id, client_id, category, title, requested_items, status, request_type, evidence_class, evidence_status, violation_id, case_type, case_id, response"
    )
    .eq("id", requestId)
    .eq("client_id", access.clientId)
    .eq("responsibility", "client")
    .maybeSingle();
  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }
  if (!queueItem || queueItem.status !== "open") {
    return NextResponse.json({ error: "Open request not found" }, { status: 404 });
  }
  const clientId = access.clientId;
  const actorUserId = access.userId;
  const requestTitle = queueItem.title;

  async function notifyStaffForUpload(input: {
    artifactId: string;
    uploadKind: "lane_b_evidence" | "case_evidence" | "requested_document";
    itemLabel?: string;
  }) {
    const { data: client, error: clientError } = await service
      .from("clients")
      .select("name, dot_number")
      .eq("id", clientId)
      .single();
    if (clientError || !client) {
      throw new Error(
        `Unable to load the client for the upload notification: ${
          clientError?.message ?? "client not found"
        }`
      );
    }
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
    ).replace(/\/+$/, "");
    return notifyOperations(service, {
      clientId,
      actorUserId,
      event: "evidence_uploaded",
      entityType: "client_requests",
      entityId: requestId,
      description: "Client upload notification recorded for operations",
      email: {
        trigger: "staff_evidence_uploaded",
        subject: `Client uploaded SafeScore evidence — ${client.name}`,
        heading: "New client upload",
        message: `${client.name} uploaded an item for “${requestTitle}”.`,
        consoleUrl: `${baseUrl}/console/clients/${clientId}/requests`,
        ctaLabel: "Review request",
        details: [
          { label: "Company", value: client.name },
          { label: "USDOT", value: client.dot_number },
          { label: "Request", value: requestTitle },
          ...(input.itemLabel
            ? [{ label: "Item", value: input.itemLabel }]
            : []),
        ],
      },
      metadata: {
        request_id: requestId,
        artifact_id: input.artifactId,
        upload_kind: input.uploadKind,
      },
    });
  }
  if (
    queueItem.category === "mcs150_truth_up" &&
    !tierHasFeature(access.tier, "compliance_layer")
  ) {
    return NextResponse.json(
      { error: "MCS-150 truth-up is not included in this plan" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const evidenceId = form.get("evidenceId");
  if (!(file instanceof File)) return NextResponse.json({ error: "File is required" }, { status: 400 });
  if (file.size > REQUEST_UPLOAD_MAX_BYTES) return NextResponse.json({ error: "File exceeds 25 MB" }, { status: 422 });
  const isLaneBEvidenceUpload =
    queueItem.request_type === "evidence" &&
    queueItem.category === "lane_b_evidence";
  if (!isLaneBEvidenceUpload && !REQUEST_UPLOAD_MIMES.has(file.type)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 422 });
  }

  const stamp = Date.now();
  if (
    isLaneBEvidenceUpload
  ) {
    let bridgedDataqEvidenceIds: string[] = [];
    if (
      !["open", "submitted", "insufficient"].includes(
        queueItem.evidence_status ?? ""
      )
    ) {
      return NextResponse.json(
        { error: "This evidence request is not accepting uploads" },
        { status: 409 }
      );
    }
    if (typeof evidenceId !== "string" || !evidenceId.trim()) {
      return NextResponse.json(
        { error: "Evidence item is required" },
        { status: 400 }
      );
    }
    const items = (queueItem.requested_items ?? []) as LaneBRequestedItem[];
    const item = items.find((candidate) => candidate.itemKey === evidenceId);
    if (!item) {
      return NextResponse.json(
        { error: "Evidence item is not part of this request" },
        { status: 403 }
      );
    }

    if (
      !CHALLENGEABILITY_EVIDENCE_MIME_TYPES.has(file.type) ||
      file.size > CHALLENGEABILITY_EVIDENCE_MAX_BYTES
    ) {
      return NextResponse.json(
        {
          error:
            "Evidence must be PDF, JPEG, PNG, WebP, or plain text and no larger than 8 MB. Convert Office files before uploading.",
        },
        { status: 422 }
      );
    }
    const fileBuffer = await file.arrayBuffer();
    try {
      buildChallengeabilityEvidenceContent(
        [
          {
            documentId: `pending-${requestId}`,
            itemKey: item.itemKey,
            label: file.name,
            mimeType: file.type,
            base64Data: Buffer.from(fileBuffer).toString("base64"),
            sizeBytes: file.size,
          },
        ],
        "Preflight validation"
      );
    } catch (error) {
      return NextResponse.json(
        {
          error: `Evidence file could not be validated: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        { status: 422 }
      );
    }
    const { data: priorDocuments, error: priorDocumentsError } = await service
      .from("documents")
      .select("id, evidence_item_key, file_size, created_at")
      .eq("client_request_id", requestId)
      .eq("client_id", access.clientId)
      .not("evidence_item_key", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (priorDocumentsError) {
      return NextResponse.json({ error: priorDocumentsError.message }, { status: 500 });
    }
    const latestSizeByItem = new Map<string, number>();
    for (const document of priorDocuments ?? []) {
      if (
        document.evidence_item_key &&
        !latestSizeByItem.has(document.evidence_item_key)
      ) {
        latestSizeByItem.set(document.evidence_item_key, document.file_size);
      }
    }
    latestSizeByItem.set(item.itemKey, file.size);
    const cumulativeBytes = [...latestSizeByItem.values()].reduce(
      (sum, size) => sum + size,
      0
    );
    if (cumulativeBytes > CHALLENGEABILITY_EVIDENCE_TOTAL_MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            "The current evidence set would exceed the 16 MB analysis limit. Compress or replace a requested item with a smaller file.",
        },
        { status: 422 }
      );
    }

    const storagePath = `${access.clientId}/requests/${requestId}/${stamp}-${safeFilename(file.name)}`;
    const { error: storageError } = await service.storage
      .from("documents")
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });
    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 });
    }

    const { data: documentRow, error: documentError } = await service
      .from("documents")
      .insert({
        client_id: access.clientId,
        storage_path: storagePath,
        filename: file.name,
        file_size: file.size,
        mime_type: file.type,
        category: "evidence",
        status: "pending_review",
        uploaded_by: access.userId,
        client_request_id: requestId,
        violation_id: queueItem.violation_id,
        case_type: queueItem.case_type,
        case_id: queueItem.case_id,
        evidence_class: queueItem.evidence_class,
        evidence_item_key: item.itemKey,
      })
      .select("id")
      .maybeSingle();
    if (documentError || !documentRow) {
      return NextResponse.json(
        { error: documentError?.message ?? "Evidence document was not recorded" },
        { status: 500 }
      );
    }

    if (
      queueItem.case_type === "dataq" &&
      queueItem.case_id &&
      queueItem.violation_id
    ) {
      try {
        const bridge = await bridgeLaneBRequestToDataqCase(service, {
          clientId: access.clientId,
          requestId,
          violationId: queueItem.violation_id,
          caseId: queueItem.case_id,
        });
        bridgedDataqEvidenceIds = bridge.evidenceIds ?? [];
      } catch (error) {
        return NextResponse.json(
          {
            error: `Evidence was stored, but could not be attached to the DataQ case: ${
              error instanceof Error ? error.message : String(error)
            }`,
            documentId: documentRow.id,
          },
          { status: 500 }
        );
      }
    }

    const submittedAt = new Date().toISOString();
    const submittedCopy = queueItem.violation_id
      ? "Evidence received — we started checking whether it strengthens your challenge."
      : "Evidence received — GEIA will match it to the related roadside record.";
    const { data: submittedRequest, error: submitError } = await service
      .from("client_requests")
      .update({
        status: "open",
        evidence_status: "submitted",
        status_copy: submittedCopy,
        submitted_at: submittedAt,
        applied_at: null,
        closed_at: null,
        next_reminder_at: null,
        response: {
          lastDocumentId: documentRow.id,
          lastEvidenceItemKey: item.itemKey,
          lastSubmittedAt: submittedAt,
        },
        updated_at: submittedAt,
      })
      .eq("id", requestId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (submitError || !submittedRequest) {
      return NextResponse.json(
        {
          error:
            submitError?.message ??
            "The evidence file was recorded, but the request was not advanced",
        },
        { status: 500 }
      );
    }

    let requestStatus: "submitted" | "applied" | "insufficient" = "submitted";
    let statusCopy = submittedCopy;
    let reassessment: {
      beforeTier: string | null;
      afterTier: string | null;
      strengthened: boolean;
    } | null = null;

    if (queueItem.violation_id) {
      try {
        const outcome = await reassessViolationAfterEvidence(service, {
          clientId: access.clientId,
          violationId: queueItem.violation_id,
          requestId,
        });
        reassessment = {
          beforeTier: outcome.beforeTier,
          afterTier: outcome.afterTier,
          strengthened: outcome.strengthened,
        };
        const { data: lifecycleRequest, error: lifecycleError } = await service
          .from("client_requests")
          .select("evidence_status, status_copy")
          .eq("id", requestId)
          .eq("client_id", access.clientId)
          .single();
        if (lifecycleError || !lifecycleRequest) {
          throw new Error(
            `Challengeability was reassessed, but its request outcome could not be loaded: ${
              lifecycleError?.message ?? "request not found"
            }`
          );
        }
        if (
          lifecycleRequest.evidence_status !== "submitted" &&
          lifecycleRequest.evidence_status !== "applied" &&
          lifecycleRequest.evidence_status !== "insufficient"
        ) {
          throw new Error(
            `Challengeability was reassessed, but the request has unexpected evidence status ${
              lifecycleRequest.evidence_status ?? "null"
            }`
          );
        }
        requestStatus = lifecycleRequest.evidence_status;
        statusCopy = lifecycleRequest.status_copy ?? submittedCopy;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown evidence reassessment failure";
        const failureCopy =
          "Evidence received — the automatic check could not finish. Please try again later or contact GEIA.";
        const { data: failedRequest, error: statusError } = await service
          .from("client_requests")
          .update({ status_copy: failureCopy, updated_at: new Date().toISOString() })
          .eq("id", requestId)
          .eq("client_id", access.clientId)
          .eq("status", "open")
          .eq("evidence_status", "submitted")
          .select("id, evidence_status, status_copy")
          .maybeSingle();

        // Another upload/retry may have completed while this assessment was in
        // flight. Never let the stale failure overwrite that terminal outcome.
        if (!statusError && !failedRequest) {
          const { data: currentRequest, error: currentRequestError } = await service
            .from("client_requests")
            .select("status, evidence_status, status_copy")
            .eq("id", requestId)
            .eq("client_id", access.clientId)
            .single();
          if (currentRequestError || !currentRequest) {
            return NextResponse.json(
              {
                error: `Evidence was saved, but the current request outcome could not be loaded: ${
                  currentRequestError?.message ?? "request not found"
                }`,
                documentId: documentRow.id,
              },
              { status: 502 }
            );
          }
          if (
            currentRequest.evidence_status === "applied" ||
            currentRequest.evidence_status === "insufficient"
          ) {
            requestStatus = currentRequest.evidence_status;
            statusCopy = currentRequest.status_copy ?? submittedCopy;
          } else {
            return NextResponse.json(
              {
                error: `Evidence was saved, but challengeability reassessment failed and the request is now ${
                  currentRequest.evidence_status ??
                  currentRequest.status ??
                  "in an unknown state"
                }: ${message}`,
                documentId: documentRow.id,
                requestStatus: currentRequest.evidence_status,
                statusCopy: currentRequest.status_copy,
              },
              { status: 502 }
            );
          }
        }
        if (statusError || failedRequest) {
          const { data: failureActivity, error: activityError } = await service
            .from("activity_log")
            .insert({
              client_id: access.clientId,
              user_id: access.userId,
              action_type: "challengeability_reassessment_failed",
              entity_type: "violations",
              entity_id: queueItem.violation_id,
              description:
                "Evidence was received, but challengeability reassessment failed",
              metadata: {
                request_id: requestId,
                document_id: documentRow.id,
                evidence_item_key: item.itemKey,
                reason: message,
              },
            })
            .select("id")
            .maybeSingle();
          const telemetryFailures = [
            statusError || !failedRequest
              ? `request status copy: ${statusError?.message ?? "row not updated"}`
              : null,
            activityError || !failureActivity
              ? `failure activity: ${activityError?.message ?? "row not inserted"}`
              : null,
          ].filter((value): value is string => Boolean(value));
          return NextResponse.json(
            {
              error: `Evidence was saved, but challengeability reassessment failed: ${message}${
                telemetryFailures.length > 0
                  ? `. Failure recording also failed: ${telemetryFailures.join("; ")}`
                  : ""
              }`,
              documentId: documentRow.id,
              requestStatus: "submitted",
              statusCopy: failureCopy,
            },
            { status: 502 }
          );
        }
      }
    }

    const { data: uploadedItemRows, error: uploadedItemsError } = await service
      .from("documents")
      .select("evidence_item_key")
      .eq("client_request_id", requestId)
      .not("evidence_item_key", "is", null);
    if (uploadedItemsError) {
      return NextResponse.json(
        {
          error: `Evidence was recorded, but upload completion could not be checked: ${uploadedItemsError.message}`,
        },
        { status: 500 }
      );
    }
    const uploadedKeys = new Set(
      (uploadedItemRows ?? [])
        .map((row) => row.evidence_item_key)
        .filter((value): value is string => typeof value === "string")
    );
    const remaining = remainingLaneBEvidenceItems(items, uploadedKeys);

    const { error: uploadActivityError } = await service
      .from("activity_log")
      .insert({
        client_id: access.clientId,
        user_id: access.userId,
        action_type: "evidence_uploaded_for_request",
        entity_type: "client_requests",
        entity_id: requestId,
        description: `Evidence received for ${item.label}`,
        metadata: {
          document_id: documentRow.id,
          violation_id: queueItem.violation_id,
          case_type: queueItem.case_type,
          case_id: queueItem.case_id,
          evidence_class: queueItem.evidence_class,
          evidence_item_key: item.itemKey,
          dataq_evidence_ids: bridgedDataqEvidenceIds,
          request_status: requestStatus,
          reassessment,
        },
      });
    if (uploadActivityError) {
      return NextResponse.json(
        {
          error: `Evidence was recorded, but activity logging failed: ${uploadActivityError.message}`,
        },
        { status: 500 }
      );
    }

    try {
      await notifyStaffForUpload({
        artifactId: documentRow.id,
        uploadKind: "lane_b_evidence",
        itemLabel: item.label,
      });
    } catch (notificationError) {
      return NextResponse.json(
        {
          error: `Evidence was saved and reassessed, but the operations notification failed: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
          documentId: documentRow.id,
          requestStatus,
          statusCopy,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      documentId: documentRow.id,
      requestStatus,
      statusCopy,
      reassessment,
      remaining,
    });
  }

  if (queueItem.category === "case_evidence") {
    if (typeof evidenceId !== "string") return NextResponse.json({ error: "Evidence item is required" }, { status: 400 });
    const items = (queueItem.requested_items ?? []) as RequestedEvidenceItem[];
    const item = items.find((candidate) => candidate.evidenceId === evidenceId);
    if (!item) return NextResponse.json({ error: "Evidence item is not part of this request" }, { status: 403 });
    const table = item.caseType === "dataq" ? "dataq_evidence" : "cpdp_evidence";
    const { data: evidence } = await service.from(table).select("id, case_id").eq("id", evidenceId).eq("case_id", item.caseId).single();
    if (!evidence) return NextResponse.json({ error: "Evidence slot not found" }, { status: 404 });
    const storagePath = `cases/${item.caseId}/${evidenceId}/${stamp}-${safeFilename(file.name)}`;
    const { error: storageError } = await service.storage.from("dataq-evidence").upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (storageError) return NextResponse.json({ error: storageError.message }, { status: 500 });
    const { error: updateError } = await service.from(table).update({ status: "received", storage_path: storagePath, uploaded_at: new Date().toISOString(), uploaded_by: "client" }).eq("id", evidenceId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    let remaining = 0;
    for (const requested of items) {
      const requestedTable = requested.caseType === "dataq" ? "dataq_evidence" : "cpdp_evidence";
      const { data: statusRow } = await service.from(requestedTable).select("status").eq("id", requested.evidenceId).maybeSingle();
      if (statusRow?.status !== "received") remaining += 1;
    }
    const requestStatus = remaining === 0 ? "fulfilled" : "open";
    if (remaining === 0) {
      const now = new Date().toISOString();
      const { error: closeError } = await service.from("client_requests").update({ status: "fulfilled", closed_at: now, next_reminder_at: null, updated_at: now }).eq("id", requestId).eq("status", "open");
      if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });
    }
    await syncClientEvidenceRequest(service, access.clientId);
    try {
      await notifyStaffForUpload({
        artifactId: evidenceId,
        uploadKind: "case_evidence",
        itemLabel: item.label,
      });
    } catch (notificationError) {
      return NextResponse.json(
        {
          error: `Case evidence was saved, but the operations notification failed: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
          evidenceId,
          requestStatus,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, evidenceId, requestStatus, remaining });
  }

  const storagePath = `${access.clientId}/requests/${requestId}/${stamp}-${safeFilename(file.name)}`;
  const { error: storageError } = await service.storage.from("documents").upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (storageError) return NextResponse.json({ error: storageError.message }, { status: 500 });
  const category = queueItem.category === "dqf_roster" ? "dqf" : "other";
  const { data: documentRow, error: documentError } = await service.from("documents").insert({ client_id: access.clientId, storage_path: storagePath, filename: file.name, file_size: file.size, mime_type: file.type, category, status: "pending_review", uploaded_by: access.userId }).select("id").single();
  if (documentError) return NextResponse.json({ error: documentError.message }, { status: 500 });
  if (queueItem.category === "mcs150_truth_up") {
    try {
      await notifyStaffForUpload({
        artifactId: documentRow.id,
        uploadKind: "requested_document",
      });
    } catch (notificationError) {
      return NextResponse.json(
        {
          error: `The document was saved, but the operations notification failed: ${
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError)
          }`,
          documentId: documentRow.id,
          requestStatus: "open",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      documentId: documentRow.id,
      requestStatus: "open",
      remaining: null,
      closure: "awaiting_public_census_match",
    });
  }
  const now = new Date().toISOString();
  const { error: closeError } = await service.from("client_requests").update({ status: "fulfilled", closed_at: now, next_reminder_at: null, updated_at: now }).eq("id", requestId);
  if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });
  try {
    await notifyStaffForUpload({
      artifactId: documentRow.id,
      uploadKind: "requested_document",
    });
  } catch (notificationError) {
    return NextResponse.json(
      {
        error: `The document was saved, but the operations notification failed: ${
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError)
        }`,
        documentId: documentRow.id,
        requestStatus: "fulfilled",
      },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, documentId: documentRow.id, requestStatus: "fulfilled", remaining: 0 });
}
