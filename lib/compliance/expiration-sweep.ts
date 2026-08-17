import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildComplianceHealth,
  type ComplianceExpirationItemType,
  type ComplianceExpirationThreshold,
  type UpcomingComplianceItem,
} from "@/lib/compliance/health";
import { notifyOperations } from "@/lib/notifications/operations";
import { tierHasFeature } from "@/lib/tiers";

type ServiceClient = SupabaseClient;

type ExpirationCandidate = UpcomingComplianceItem;

type ExpirationEvent = {
  id: string;
  item_type: ComplianceExpirationItemType;
  subject_type: "driver" | "driver_document" | "vehicle";
  subject_id: string;
  due_date: string;
  threshold: ComplianceExpirationThreshold;
  status: "pending" | "processing" | "succeeded" | "failed";
  attempts: number;
  claimed_at: string | null;
  digest_id: string | null;
  alert_id: string | null;
  client_request_id: string | null;
};

type ExpirationDigest = {
  id: string;
  digest_date: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  attempts: number;
  claimed_at: string | null;
};

export type ComplianceExpirationSweepResult = {
  status: "succeeded" | "skipped";
  reason: string | null;
  candidatesReviewed: number;
  eventsCreated: number;
  alertsCreated: number;
  requestsCreated: number;
  existingRequestIds: string[];
  digestId: string | null;
  digestEventCount: number;
  operationsNotification: "dry_run" | "sent" | "recovered" | "not_needed";
};

const STALE_CLAIM_MS = 15 * 60 * 1_000;
const DAY_MS = 86_400_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pacificDateOnly(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function dueAt(value: string) {
  return `${value}T12:00:00.000Z`;
}

function nextReminderAt(now: Date) {
  return new Date(now.getTime() + 7 * DAY_MS).toISOString();
}

function humanDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function candidateKey(candidate: Pick<ExpirationCandidate, "itemType" | "subjectId" | "dueDate">) {
  return `${candidate.itemType}:${candidate.subjectId}:${candidate.dueDate}`;
}

function eventKey(event: Pick<ExpirationEvent, "item_type" | "subject_id" | "due_date">) {
  return `${event.item_type}:${event.subject_id}:${event.due_date}`;
}

function severityFor(threshold: ComplianceExpirationThreshold) {
  if (threshold === "expired") return "critical" as const;
  if (threshold === "60_day") return "info" as const;
  return "warning" as const;
}

function thresholdLabel(threshold: ComplianceExpirationThreshold) {
  switch (threshold) {
    case "60_day":
      return "within 60 days";
    case "30_day":
      return "within 30 days";
    case "7_day":
      return "within 7 days";
    case "expired":
      return "expired";
  }
}

function itemLabel(itemType: ComplianceExpirationItemType) {
  const labels: Record<ComplianceExpirationItemType, string> = {
    medical_certificate: "Medical certificate",
    cdl: "CDL",
    annual_vehicle_inspection: "Annual DOT inspection",
    annual_mvr_review: "Annual MVR review",
    clearinghouse_annual_query: "Clearinghouse annual query",
  };
  return labels[itemType];
}

async function loadCandidates(
  service: ServiceClient,
  clientId: string,
  asOfDate: string
) {
  const [driversResult, documentsResult, vehiclesResult, clearinghouseResult] =
    await Promise.all([
      service
        .from("drivers")
        .select(
          "id, full_name, cdl_expiry, medical_cert_expiry, status, approved_at"
        )
        .eq("client_id", clientId)
        .eq("status", "active")
        .not("approved_at", "is", null)
        .order("id"),
      service
        .from("driver_documents")
        .select(
          "id, driver_id, doc_type, completed_date, expiry_date, status, document_id"
        )
        .eq("client_id", clientId)
        .order("id"),
      service
        .from("vehicles")
        .select("id, unit_number, annual_inspection_date, status")
        .eq("client_id", clientId)
        .eq("status", "active")
        .order("id"),
      service
        .from("clearinghouse_records")
        .select("id, driver_id, query_date")
        .eq("client_id", clientId)
        .order("query_date", { ascending: false })
        .order("id", { ascending: false }),
    ]);

  const failures = [
    ["drivers", driversResult.error],
    ["driver qualification files", documentsResult.error],
    ["vehicles", vehiclesResult.error],
    ["Clearinghouse records", clearinghouseResult.error],
  ].filter((entry): entry is [string, NonNullable<typeof driversResult.error>] =>
    Boolean(entry[1])
  );
  if (failures.length > 0) {
    throw new Error(
      failures.map(([label, error]) => `${label}: ${error.message}`).join("; ")
    );
  }

  return buildComplianceHealth({
    asOfDate,
    drivers: driversResult.data ?? [],
    driverDocuments: documentsResult.data ?? [],
    vehicles: vehiclesResult.data ?? [],
    clearinghouseRecords: clearinghouseResult.data ?? [],
  }).upcoming;
}

async function ensureEvent(
  service: ServiceClient,
  clientId: string,
  candidate: ExpirationCandidate,
  nowIso: string
): Promise<{ event: ExpirationEvent; created: boolean }> {
  const payload = {
    client_id: clientId,
    item_type: candidate.itemType,
    subject_type: candidate.subjectType,
    subject_id: candidate.subjectId,
    due_date: candidate.dueDate,
    threshold: candidate.threshold,
    status: "pending" as const,
    updated_at: nowIso,
  };
  const { data: inserted, error: insertError } = await service
    .from("compliance_expiration_events")
    .insert(payload)
    .select(
      "id, item_type, subject_type, subject_id, due_date, threshold, status, attempts, claimed_at, digest_id, alert_id, client_request_id"
    )
    .maybeSingle();
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Unable to create compliance expiration event: ${insertError.message}`);
  }
  if (inserted) {
    return { event: inserted as ExpirationEvent, created: true };
  }
  const { data: existing, error: existingError } = await service
    .from("compliance_expiration_events")
    .select(
      "id, item_type, subject_type, subject_id, due_date, threshold, status, attempts, claimed_at, digest_id, alert_id, client_request_id"
    )
    .eq("client_id", clientId)
    .eq("item_type", candidate.itemType)
    .eq("subject_id", candidate.subjectId)
    .eq("due_date", candidate.dueDate)
    .eq("threshold", candidate.threshold)
    .single();
  if (existingError || !existing) {
    throw new Error(
      `Compliance event conflict could not be resolved: ${
        existingError?.message ?? "row not found"
      }`
    );
  }
  return { event: existing as ExpirationEvent, created: false };
}

async function ensureRenewalRequest(
  service: ServiceClient,
  input: {
    clientId: string;
    candidate: ExpirationCandidate;
    now: Date;
  }
) {
  const { candidate } = input;
  if (
    candidate.daysRemaining > 30 ||
    (candidate.itemType !== "medical_certificate" &&
      candidate.itemType !== "cdl")
  ) {
    return { requestId: null, created: false };
  }
  if (!candidate.driverId) {
    throw new Error(
      `${candidate.title} is not linked to a driver, so a renewal request cannot be created`
    );
  }

  const docType =
    candidate.itemType === "medical_certificate" ? "medical_cert" : "cdl";
  if (!candidate.driverDocumentId) {
    const { data: insertedChecklist, error: insertChecklistError } = await service
      .from("driver_documents")
      .insert({
        client_id: input.clientId,
        driver_id: candidate.driverId,
        doc_type: docType,
        status: "missing",
        updated_at: input.now.toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (insertChecklistError && insertChecklistError.code !== "23505") {
      throw new Error(
        `Unable to establish the missing ${docType} checklist item: ${insertChecklistError.message}`
      );
    }
    if (insertedChecklist?.id) {
      candidate.driverDocumentId = insertedChecklist.id;
    } else {
      const { data: existingChecklist, error: existingChecklistError } =
        await service
          .from("driver_documents")
          .select("id")
          .eq("client_id", input.clientId)
          .eq("driver_id", candidate.driverId)
          .eq("doc_type", docType)
          .single();
      if (existingChecklistError || !existingChecklist) {
        throw new Error(
          `Concurrent ${docType} checklist creation could not be resolved: ${
            existingChecklistError?.message ?? "row not found"
          }`
        );
      }
      candidate.driverDocumentId = existingChecklist.id;
    }
  }

  const credentialLabel =
    candidate.itemType === "medical_certificate"
      ? "medical certificate"
      : "CDL";
  const title = `Updated ${credentialLabel} — ${candidate.subjectName}, expires ${humanDate(
    candidate.dueDate
  )}`;
  const dedupeKey = `${input.clientId}:compliance-renewal:${candidate.driverId}:${candidate.itemType}:${candidate.dueDate}`;
  const payload = {
    client_id: input.clientId,
    dedupe_key: dedupeKey,
    category: "compliance_renewal",
    title,
    description: `Upload the renewed ${credentialLabel}. GEIA will review it and update the driver qualification file.`,
    source: "standing",
    responsibility: "client",
    request_type: "evidence",
    evidence_status: null,
    requested_items: [
      {
        itemKey: `${candidate.itemType}:${candidate.driverId}`,
        label: `Updated ${credentialLabel}`,
        contextNote: `Current record expires ${humanDate(candidate.dueDate)}.`,
        driverId: candidate.driverId,
        driverDocumentId: candidate.driverDocumentId,
        docType:
          docType,
      },
    ],
    status: "open",
    status_copy: `Upload the renewed ${credentialLabel}. GEIA will review it and confirm the new expiration date.`,
    due_at: dueAt(candidate.dueDate),
    next_reminder_at: nextReminderAt(input.now),
    closed_at: null,
    updated_at: input.now.toISOString(),
  };
  const { data: inserted, error: insertError } = await service
    .from("client_requests")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Unable to create compliance renewal request: ${insertError.message}`);
  }
  let requestId = inserted?.id ?? null;
  if (!requestId) {
    const { data: existing, error: existingError } = await service
      .from("client_requests")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .single();
    if (existingError || !existing) {
      throw new Error(
        `Compliance renewal conflict could not be resolved: ${
          existingError?.message ?? "request not found"
        }`
      );
    }
    requestId = existing.id;
  }

  const { data: priorActivity, error: priorActivityError } = await service
    .from("activity_log")
    .select("id")
    .eq("action_type", "compliance_renewal_requested")
    .eq("entity_type", "client_requests")
    .eq("entity_id", requestId)
    .limit(1)
    .maybeSingle();
  if (priorActivityError) {
    throw new Error(
      `Unable to verify compliance request activity: ${priorActivityError.message}`
    );
  }
  if (!priorActivity) {
    const { error: activityError } = await service.from("activity_log").insert({
      client_id: input.clientId,
      action_type: "compliance_renewal_requested",
      entity_type: "client_requests",
      entity_id: requestId,
      description: `Compliance renewal requested: ${title}`,
      metadata: {
        item_type: candidate.itemType,
        driver_id: candidate.driverId,
        driver_document_id: candidate.driverDocumentId,
        due_date: candidate.dueDate,
        dedupe_key: dedupeKey,
      },
    });
    if (activityError) {
      throw new Error(
        `Compliance request ${requestId} exists, but activity logging failed: ${activityError.message}`
      );
    }
  }
  return { requestId, created: Boolean(inserted) };
}

async function ensureAlert(
  service: ServiceClient,
  input: {
    clientId: string;
    event: ExpirationEvent;
    candidate: ExpirationCandidate | null;
  }
) {
  if (input.event.alert_id) {
    return { alertId: input.event.alert_id, created: false };
  }
  const title =
    input.candidate?.title ??
    `${itemLabel(input.event.item_type)} — ${input.event.subject_id.slice(0, 8)}`;
  const { data: insertedAlert, error: alertError } = await service
    .from("alerts")
    .insert({
      client_id: input.clientId,
      type: "compliance_expiration",
      entity_type: "compliance_expiration_events",
      entity_id: input.event.id,
      severity: severityFor(input.event.threshold),
      title,
      message: `${itemLabel(input.event.item_type)} is ${thresholdLabel(
        input.event.threshold
      )}; due ${humanDate(input.event.due_date)}.`,
    })
    .select("id")
    .maybeSingle();
  if (alertError && alertError.code !== "23505") {
    throw new Error(
      `Unable to create compliance alert: ${alertError.message}`
    );
  }
  let alertId = insertedAlert?.id ?? null;
  if (!alertId) {
    const { data: existingAlert, error: existingAlertError } = await service
      .from("alerts")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("entity_type", "compliance_expiration_events")
      .eq("entity_id", input.event.id)
      .single();
    if (existingAlertError || !existingAlert) {
      throw new Error(
        `Compliance alert conflict could not be resolved: ${
          existingAlertError?.message ?? "row not found"
        }`
      );
    }
    alertId = existingAlert.id;
  }
  const { data: linkedEvent, error: eventError } = await service
    .from("compliance_expiration_events")
    .update({ alert_id: alertId })
    .eq("id", input.event.id)
    .is("alert_id", null)
    .select("id")
    .maybeSingle();
  if (eventError) {
    throw new Error(
      `Compliance alert ${alertId} was created, but its event link failed: ${eventError.message}`
    );
  }
  if (!linkedEvent) {
    const { data: racedEvent, error: racedEventError } = await service
      .from("compliance_expiration_events")
      .select("alert_id")
      .eq("id", input.event.id)
      .single();
    if (racedEventError || !racedEvent?.alert_id) {
      throw new Error(
        `Compliance alert ${alertId} exists, but its event link could not be verified: ${
          racedEventError?.message ?? "event has no alert"
        }`
      );
    }
    alertId = racedEvent.alert_id;
  }
  input.event.alert_id = alertId;
  return { alertId, created: Boolean(insertedAlert) };
}

async function findOrCreateDigest(
  service: ServiceClient,
  clientId: string,
  digestDate: string,
  nowIso: string
): Promise<ExpirationDigest> {
  const { data: incomplete, error: incompleteError } = await service
    .from("compliance_expiration_digests")
    .select("id, digest_date, status, attempts, claimed_at")
    .eq("client_id", clientId)
    .neq("status", "succeeded")
    .order("digest_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (incompleteError) {
    throw new Error(`Unable to load compliance digest: ${incompleteError.message}`);
  }
  if (incomplete) return incomplete as ExpirationDigest;

  const { data: inserted, error: insertError } = await service
    .from("compliance_expiration_digests")
    .insert({
      client_id: clientId,
      digest_date: digestDate,
      status: "pending",
      updated_at: nowIso,
    })
    .select("id, digest_date, status, attempts, claimed_at")
    .maybeSingle();
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Unable to create compliance digest: ${insertError.message}`);
  }
  if (inserted) return inserted as ExpirationDigest;
  const { data: existing, error: existingError } = await service
    .from("compliance_expiration_digests")
    .select("id, digest_date, status, attempts, claimed_at")
    .eq("client_id", clientId)
    .eq("digest_date", digestDate)
    .single();
  if (existingError || !existing) {
    throw new Error(
      `Compliance digest conflict could not be resolved: ${
        existingError?.message ?? "row not found"
      }`
    );
  }
  return existing as ExpirationDigest;
}

async function claimDigest(
  service: ServiceClient,
  digest: ExpirationDigest,
  now: Date
) {
  if (digest.status === "succeeded") return null;
  const nowIso = now.toISOString();
  let query = service
    .from("compliance_expiration_digests")
    .update({
      status: "processing",
      attempts: digest.attempts + 1,
      claimed_at: nowIso,
      last_error: null,
      updated_at: nowIso,
    })
    .eq("id", digest.id)
    .eq("status", digest.status);
  if (digest.status === "processing") {
    query = query.lt(
      "claimed_at",
      new Date(now.getTime() - STALE_CLAIM_MS).toISOString()
    );
  }
  const { data, error } = await query
    .select("id, digest_date, status, attempts, claimed_at")
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to claim compliance digest: ${error.message}`);
  }
  return (data ?? null) as ExpirationDigest | null;
}

async function successfulNotificationActivity(
  service: ServiceClient,
  digestId: string
) {
  const { data, error } = await service
    .from("activity_log")
    .select("id, metadata")
    .eq("action_type", "operations_notification_email")
    .eq("entity_type", "compliance_expiration_digests")
    .eq("entity_id", digestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to verify compliance digest delivery: ${error.message}`);
  }
  const metadata = data?.metadata as
    | { email_delivery?: { status?: string } }
    | null;
  return data && ["dry_run", "sent"].includes(metadata?.email_delivery?.status ?? "")
    ? data.id
    : null;
}

async function ensureSweepActivity(
  service: ServiceClient,
  input: {
    clientId: string;
    digestId: string;
    digestDate: string;
    eventIds: string[];
    alertsCreated: number;
    requestsCreated: number;
  }
) {
  const { data: existing, error: existingError } = await service
    .from("activity_log")
    .select("id")
    .eq("action_type", "compliance_expiration_sweep")
    .eq("entity_type", "compliance_expiration_digests")
    .eq("entity_id", input.digestId)
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw new Error(
      `Unable to verify compliance sweep activity: ${existingError.message}`
    );
  }
  if (existing) return existing.id as string;
  const { data: inserted, error: insertError } = await service
    .from("activity_log")
    .insert({
      client_id: input.clientId,
      action_type: "compliance_expiration_sweep",
      entity_type: "compliance_expiration_digests",
      entity_id: input.digestId,
      description: `Compliance expiration sweep processed ${input.eventIds.length} event${
        input.eventIds.length === 1 ? "" : "s"
      }`,
      metadata: {
        digest_date: input.digestDate,
        event_ids: input.eventIds,
        alerts_created: input.alertsCreated,
        requests_created: input.requestsCreated,
        billing_driver_count_changed: false,
      },
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(
      `Unable to record compliance sweep activity: ${
        insertError?.message ?? "row not inserted"
      }`
    );
  }
  return inserted.id as string;
}

async function markDigestFailed(
  service: ServiceClient,
  digestId: string,
  reason: string,
  nowIso: string
) {
  const [{ error: eventError }, { error: digestError }] = await Promise.all([
    service
      .from("compliance_expiration_events")
      .update({ status: "failed", last_error: reason, updated_at: nowIso })
      .eq("digest_id", digestId)
      .eq("status", "processing"),
    service
      .from("compliance_expiration_digests")
      .update({
        status: "failed",
        last_error: reason,
        processed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", digestId)
      .eq("status", "processing"),
  ]);
  if (eventError || digestError) {
    throw new Error(
      `${reason}; failure-state recording also failed: ${
        eventError?.message ?? digestError?.message
      }`
    );
  }
}

async function markDigestSucceeded(
  service: ServiceClient,
  input: {
    digestId: string;
    eventCount: number;
    deliveryMetadata: Record<string, unknown>;
    nowIso: string;
  }
) {
  const { error: eventError } = await service
    .from("compliance_expiration_events")
    .update({
      status: "succeeded",
      processed_at: input.nowIso,
      last_error: null,
      updated_at: input.nowIso,
    })
    .eq("digest_id", input.digestId)
    .eq("status", "processing");
  if (eventError) {
    throw new Error(
      `Compliance digest was delivered, but its events were not completed: ${eventError.message}`
    );
  }
  const { data: digest, error: digestError } = await service
    .from("compliance_expiration_digests")
    .update({
      status: "succeeded",
      processed_at: input.nowIso,
      last_error: null,
      event_count: input.eventCount,
      delivery_metadata: input.deliveryMetadata,
      updated_at: input.nowIso,
    })
    .eq("id", input.digestId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (digestError || !digest) {
    throw new Error(
      `Compliance digest delivery could not be finalized: ${
        digestError?.message ?? "digest not updated"
      }`
    );
  }
}

export async function runComplianceExpirationSweep(
  service: ServiceClient,
  input: {
    clientId: string;
    now?: Date;
  }
): Promise<ComplianceExpirationSweepResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const asOfDate = pacificDateOnly(now);
  const { data: client, error: clientError } = await service
    .from("clients")
    .select("id, name, dot_number, tier, status")
    .eq("id", input.clientId)
    .single();
  if (clientError || !client) {
    throw new Error(
      `Unable to verify compliance sweep client: ${
        clientError?.message ?? "client not found"
      }`
    );
  }
  if (
    client.status !== "active" ||
    !tierHasFeature(client.tier, "compliance_layer")
  ) {
    return {
      status: "skipped",
      reason:
        client.status !== "active"
          ? "client_not_active"
          : "compliance_layer_not_included",
      candidatesReviewed: 0,
      eventsCreated: 0,
      alertsCreated: 0,
      requestsCreated: 0,
      existingRequestIds: [],
      digestId: null,
      digestEventCount: 0,
      operationsNotification: "not_needed",
    };
  }

  const candidates = await loadCandidates(service, input.clientId, asOfDate);
  const candidateByKey = new Map(
    candidates.map((candidate) => [candidateKey(candidate), candidate])
  );
  let eventsCreated = 0;
  let requestsCreated = 0;
  const existingRequestIds: string[] = [];

  for (const candidate of candidates) {
    const { event, created } = await ensureEvent(
      service,
      input.clientId,
      candidate,
      nowIso
    );
    if (created) eventsCreated += 1;
    const request = await ensureRenewalRequest(service, {
      clientId: input.clientId,
      candidate,
      now,
    });
    if (request.requestId) {
      if (request.created) requestsCreated += 1;
      else existingRequestIds.push(request.requestId);
      if (event.client_request_id !== request.requestId) {
        const { error: linkError } = await service
          .from("compliance_expiration_events")
          .update({ client_request_id: request.requestId })
          .eq("id", event.id);
        if (linkError) {
          throw new Error(
            `Unable to link compliance request ${request.requestId} to event ${event.id}: ${linkError.message}`
          );
        }
      }
    }
  }

  const digest = await findOrCreateDigest(
    service,
    input.clientId,
    asOfDate,
    nowIso
  );
  if (digest.status === "succeeded") {
    return {
      status: "succeeded",
      reason: "daily_digest_already_sent",
      candidatesReviewed: candidates.length,
      eventsCreated,
      alertsCreated: 0,
      requestsCreated,
      existingRequestIds,
      digestId: digest.id,
      digestEventCount: 0,
      operationsNotification: "not_needed",
    };
  }
  const claimedDigest = await claimDigest(service, digest, now);
  if (!claimedDigest) {
    return {
      status: "succeeded",
      reason: "digest_claimed_by_another_worker",
      candidatesReviewed: candidates.length,
      eventsCreated,
      alertsCreated: 0,
      requestsCreated,
      existingRequestIds,
      digestId: digest.id,
      digestEventCount: 0,
      operationsNotification: "not_needed",
    };
  }

  const priorDeliveryActivityId = await successfulNotificationActivity(
    service,
    claimedDigest.id
  );
  if (priorDeliveryActivityId) {
    const { data: recoveryEvents, error: recoveryError } = await service
      .from("compliance_expiration_events")
      .select("id")
      .eq("digest_id", claimedDigest.id);
    if (recoveryError) {
      throw new Error(
        `Unable to recover delivered compliance events: ${recoveryError.message}`
      );
    }
    const recoveryEventIds = (recoveryEvents ?? []).map((event) => event.id);
    await ensureSweepActivity(service, {
      clientId: input.clientId,
      digestId: claimedDigest.id,
      digestDate: claimedDigest.digest_date,
      eventIds: recoveryEventIds,
      alertsCreated: 0,
      requestsCreated,
    });
    await markDigestSucceeded(service, {
      digestId: claimedDigest.id,
      eventCount: recoveryEventIds.length,
      deliveryMetadata: {
        status: "recovered",
        activity_id: priorDeliveryActivityId,
      },
      nowIso,
    });
    return {
      status: "succeeded",
      reason: "delivery_recovered_from_activity_log",
      candidatesReviewed: candidates.length,
      eventsCreated,
      alertsCreated: 0,
      requestsCreated,
      existingRequestIds,
      digestId: claimedDigest.id,
      digestEventCount: recoveryEventIds.length,
      operationsNotification: "recovered",
    };
  }

  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const { data: availableEvents, error: availableError } = await service
    .from("compliance_expiration_events")
    .select(
      "id, item_type, subject_type, subject_id, due_date, threshold, status, attempts, claimed_at, digest_id, alert_id, client_request_id"
    )
    .eq("client_id", input.clientId)
    .or(
      `status.in.(pending,failed),and(status.eq.processing,claimed_at.lt.${staleCutoff})`
    )
    .order("due_date", { ascending: true })
    .order("id", { ascending: true });
  if (availableError) {
    throw new Error(
      `Unable to load compliance expiration events: ${availableError.message}`
    );
  }
  const eventsToClaim: ExpirationEvent[] = [];
  for (const event of (availableEvents ?? []) as ExpirationEvent[]) {
    const currentCandidate = candidateByKey.get(eventKey(event));
    if (currentCandidate?.threshold === event.threshold) {
      eventsToClaim.push(event);
      continue;
    }

    let supersedeQuery = service
      .from("compliance_expiration_events")
      .update({
        status: "succeeded",
        processed_at: nowIso,
        last_error: "superseded_by_current_compliance_state",
        updated_at: nowIso,
      })
      .eq("id", event.id)
      .eq("status", event.status);
    if (event.status === "processing") {
      supersedeQuery = supersedeQuery.lt("claimed_at", staleCutoff);
    }
    const { data: superseded, error: supersedeError } = await supersedeQuery
      .select("id")
      .maybeSingle();
    if (supersedeError) {
      throw new Error(
        `Unable to terminalize superseded compliance event ${event.id}: ${supersedeError.message}`
      );
    }
    if (superseded) {
      const restoreSupersededEvent = async (reason: string) => {
        const { error: restoreError } = await service
          .from("compliance_expiration_events")
          .update({
            status: event.status,
            processed_at: null,
            last_error: reason,
            updated_at: nowIso,
          })
          .eq("id", event.id)
          .eq("status", "succeeded")
          .eq("last_error", "superseded_by_current_compliance_state");
        return restoreError;
      };
      if (event.alert_id) {
        const { data: dismissedAlert, error: dismissAlertError } = await service
          .from("alerts")
          .update({ dismissed_at: nowIso, read_at: nowIso })
          .eq("id", event.alert_id)
          .eq("client_id", input.clientId)
          .select("id")
          .maybeSingle();
        if (dismissAlertError || !dismissedAlert) {
          const restoreError = await restoreSupersededEvent(
            "superseded_alert_dismissal_failed"
          );
          throw new Error(
            `Compliance event ${event.id} was terminalized, but stale alert ${event.alert_id} could not be dismissed: ${
              dismissAlertError?.message ?? "alert not found"
            }${restoreError ? `; retry-state restoration failed: ${restoreError.message}` : ""}`
          );
        }
      }
      const { error: supersedeActivityError } = await service
        .from("activity_log")
        .insert({
          client_id: input.clientId,
          action_type: "compliance_expiration_event_superseded",
          entity_type: "compliance_expiration_events",
          entity_id: event.id,
          description:
            "Compliance expiration event closed because the current record no longer matches that due-date threshold",
          metadata: {
            prior_item_type: event.item_type,
            prior_subject_id: event.subject_id,
            prior_due_date: event.due_date,
            prior_threshold: event.threshold,
            current_due_date: currentCandidate?.dueDate ?? null,
            current_threshold: currentCandidate?.threshold ?? null,
            dismissed_alert_id: event.alert_id,
          },
        });
      if (supersedeActivityError) {
        const restoreError = await restoreSupersededEvent(
          "supersession_activity_logging_failed"
        );
        throw new Error(
          `Compliance event ${event.id} was terminalized, but supersession activity failed: ${supersedeActivityError.message}${
            restoreError
              ? `; retry-state restoration failed: ${restoreError.message}`
              : ""
          }`
        );
      }
    }
  }
  const claimedEvents: ExpirationEvent[] = [];
  for (const event of eventsToClaim) {
    let query = service
      .from("compliance_expiration_events")
      .update({
        status: "processing",
        attempts: event.attempts + 1,
        claimed_at: nowIso,
        digest_id: claimedDigest.id,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", event.id)
      .eq("status", event.status);
    if (event.status === "processing") {
      query = query.lt("claimed_at", staleCutoff);
    }
    const { data: claimed, error: claimError } = await query
      .select(
        "id, item_type, subject_type, subject_id, due_date, threshold, status, attempts, claimed_at, digest_id, alert_id, client_request_id"
      )
      .maybeSingle();
    if (claimError) {
      throw new Error(
        `Unable to claim compliance event ${event.id}: ${claimError.message}`
      );
    }
    if (claimed) claimedEvents.push(claimed as ExpirationEvent);
  }

  if (claimedEvents.length === 0) {
    await markDigestSucceeded(service, {
      digestId: claimedDigest.id,
      eventCount: 0,
      deliveryMetadata: { status: "not_needed" },
      nowIso,
    });
    return {
      status: "succeeded",
      reason: "no_new_expiration_events",
      candidatesReviewed: candidates.length,
      eventsCreated,
      alertsCreated: 0,
      requestsCreated,
      existingRequestIds,
      digestId: claimedDigest.id,
      digestEventCount: 0,
      operationsNotification: "not_needed",
    };
  }

  let alertsCreated = 0;
  try {
    for (const event of claimedEvents) {
      const candidate = candidateByKey.get(eventKey(event)) ?? null;
      const alert = await ensureAlert(service, {
        clientId: input.clientId,
        event,
        candidate,
      });
      if (alert.created) alertsCreated += 1;
    }

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://safescore.vercel.app"
    ).replace(/\/+$/, "");
    const notification = await notifyOperations(service, {
      clientId: input.clientId,
      event: "compliance_expiration_digest",
      entityType: "compliance_expiration_digests",
      entityId: claimedDigest.id,
      description: "Daily Total Safety compliance expiration digest recorded",
      email: {
        trigger: "staff_compliance_expiration_digest",
        subject: `SafeScore compliance expirations — ${client.name} (${claimedEvents.length})`,
        heading: "Total Safety compliance dates need attention",
        message: `${client.name} has ${claimedEvents.length} compliance item${
          claimedEvents.length === 1 ? "" : "s"
        } at a new expiration threshold.`,
        consoleUrl: `${baseUrl}/console/clients/${input.clientId}/compliance`,
        ctaLabel: "Open compliance manager",
        details: claimedEvents.map((event) => {
          const candidate = candidateByKey.get(eventKey(event));
          return {
            label: thresholdLabel(event.threshold),
            value: `${candidate?.title ?? itemLabel(event.item_type)} · ${humanDate(
              event.due_date
            )}`,
          };
        }),
      },
      metadata: {
        digest_id: claimedDigest.id,
        digest_date: claimedDigest.digest_date,
        event_ids: claimedEvents.map((event) => event.id),
        thresholds: claimedEvents.map((event) => event.threshold),
        renewal_request_ids: claimedEvents
          .map((event) => event.client_request_id)
          .filter(Boolean),
      },
    });
    await ensureSweepActivity(service, {
      clientId: input.clientId,
      digestId: claimedDigest.id,
      digestDate: claimedDigest.digest_date,
      eventIds: claimedEvents.map((event) => event.id),
      alertsCreated,
      requestsCreated,
    });
    await markDigestSucceeded(service, {
      digestId: claimedDigest.id,
      eventCount: claimedEvents.length,
      deliveryMetadata: notification.emailDelivery,
      nowIso,
    });

    return {
      status: "succeeded",
      reason: null,
      candidatesReviewed: candidates.length,
      eventsCreated,
      alertsCreated,
      requestsCreated,
      existingRequestIds,
      digestId: claimedDigest.id,
      digestEventCount: claimedEvents.length,
      operationsNotification: notification.delivery.dryRun
        ? "dry_run"
        : "sent",
    };
  } catch (error) {
    const reason = errorMessage(error);
    await markDigestFailed(service, claimedDigest.id, reason, nowIso);
    throw error;
  }
}
