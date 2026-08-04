import type { SupabaseClient } from "@supabase/supabase-js";
import { timeWeightFor } from "@/lib/analysis/basic-measure";

type SupabaseLike = SupabaseClient;

type OpenEvidenceRequestRow = {
  id: string;
  violation_id: string;
  status_copy: string | null;
  closed_at: string | null;
  next_reminder_at: string | null;
  updated_at: string;
};

type InspectionRelation =
  | { inspection_date: string | null }
  | Array<{ inspection_date: string | null }>
  | null;

type ViolationInspectionRow = {
  id: string;
  inspections: InspectionRelation;
};

export const EVIDENCE_REQUEST_AGE_OUT_REASON =
  "violation aged out of scoring window";

const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 150;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function one<T>(relation: T | T[] | null | undefined): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function validDateOnly(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** Calendar-month cutoff matching the canonical SafeScore time-weight helper. */
export function evidenceRequestAgeOutCutoff(asOf: Date) {
  return new Date(
    Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth() - 24,
      asOf.getUTCDate()
    )
  )
    .toISOString()
    .slice(0, 10);
}

export function violationIsOutsideScoringWindow(
  inspectionDate: string | null | undefined,
  asOf: Date
) {
  const date = validDateOnly(inspectionDate);
  if (!date) return false;
  return (
    date < evidenceRequestAgeOutCutoff(asOf) &&
    timeWeightFor(date, asOf) === 0
  );
}

async function loadOpenLinkedEvidenceRequests(
  service: SupabaseLike,
  clientId: string
) {
  const rows: OpenEvidenceRequestRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from("client_requests")
      .select(
        "id, violation_id, status_copy, closed_at, next_reminder_at, updated_at"
      )
      .eq("client_id", clientId)
      .eq("request_type", "evidence")
      .eq("status", "open")
      .not("violation_id", "is", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `Unable to load open evidence requests for age-out: ${error.message}`
      );
    }
    const page = (data ?? []) as OpenEvidenceRequestRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadInspectionDatesByViolation(
  service: SupabaseLike,
  clientId: string,
  violationIds: string[]
) {
  const result = new Map<string, string | null>();
  for (const ids of chunks(violationIds, ID_CHUNK_SIZE)) {
    const { data, error } = await service
      .from("violations")
      .select("id, inspections(inspection_date)")
      .eq("client_id", clientId)
      .in("id", ids);
    if (error) {
      throw new Error(
        `Unable to load violation dates for evidence-request age-out: ${error.message}`
      );
    }
    for (const row of (data ?? []) as unknown as ViolationInspectionRow[]) {
      result.set(row.id, one(row.inspections)?.inspection_date ?? null);
    }
  }
  return result;
}

/**
 * Close, but never delete, client evidence work once its linked violation is
 * outside the canonical 24-month scoring window. The guarded update makes a
 * repeated cron invocation a no-op. If activity logging fails, the request is
 * restored to its exact prior open state before the error is surfaced.
 */
export async function closeAgedOutEvidenceRequests(
  service: SupabaseLike,
  input: {
    clientId: string;
    now?: Date;
    trigger: "monitoring_cron";
  }
) {
  const now = input.now ?? new Date();
  const closedAt = now.toISOString();
  const cutoffDate = evidenceRequestAgeOutCutoff(now);
  const requests = await loadOpenLinkedEvidenceRequests(
    service,
    input.clientId
  );
  if (requests.length === 0) {
    return { reviewedRequests: 0, closedRequestIds: [], cutoffDate };
  }

  const datesByViolation = await loadInspectionDatesByViolation(
    service,
    input.clientId,
    [...new Set(requests.map((request) => request.violation_id))]
  );
  const closedRequestIds: string[] = [];

  for (const request of requests) {
    const inspectionDate = datesByViolation.get(request.violation_id) ?? null;
    if (!violationIsOutsideScoringWindow(inspectionDate, now)) continue;

    const { data: closed, error: closeError } = await service
      .from("client_requests")
      .update({
        status: "cancelled",
        status_copy: EVIDENCE_REQUEST_AGE_OUT_REASON,
        closed_at: closedAt,
        next_reminder_at: null,
        updated_at: closedAt,
      })
      .eq("id", request.id)
      .eq("client_id", input.clientId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (closeError) {
      throw new Error(
        `Unable to close aged-out evidence request ${request.id}: ${closeError.message}`
      );
    }
    if (!closed) continue;

    const { data: activity, error: activityError } = await service
      .from("activity_log")
      .insert({
        client_id: input.clientId,
        action_type: "lane_b_evidence_request_aged_out",
        entity_type: "client_requests",
        entity_id: request.id,
        description: "Evidence request closed because its violation aged out",
        metadata: {
          violation_id: request.violation_id,
          inspection_date: inspectionDate,
          cutoff_date: cutoffDate,
          trigger: input.trigger,
          reason: EVIDENCE_REQUEST_AGE_OUT_REASON,
        },
      })
      .select("id")
      .maybeSingle();
    if (activityError || !activity) {
      const { data: restored, error: restoreError } = await service
        .from("client_requests")
        .update({
          status: "open",
          status_copy: request.status_copy,
          closed_at: request.closed_at,
          next_reminder_at: request.next_reminder_at,
          updated_at: request.updated_at,
        })
        .eq("id", request.id)
        .eq("client_id", input.clientId)
        .eq("status", "cancelled")
        .eq("updated_at", closedAt)
        .select("id")
        .maybeSingle();
      throw new Error(
        `Evidence request ${request.id} was closed, but age-out activity logging failed: ${
          activityError?.message ?? "row not inserted"
        }${
          restoreError || !restored
            ? `; restoring the open request also failed: ${
                restoreError?.message ?? "row not updated"
              }`
            : "; the request was restored"
        }`
      );
    }
    closedRequestIds.push(request.id);
  }

  return {
    reviewedRequests: requests.length,
    closedRequestIds,
    cutoffDate,
  };
}
