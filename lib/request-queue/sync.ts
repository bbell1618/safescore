import type { SupabaseClient } from "@supabase/supabase-js";
import { laneBItemCoversLegacyEvidence } from "@/lib/evidence-loop/lifecycle";

type SupabaseLike = SupabaseClient;

type CaseRow = { id: string; status: string | null };
type TypedRequestRow = {
  case_id: string | null;
  requested_items: Array<{ itemKey?: string }> | null;
};

export type RequestedEvidenceItem = {
  caseType: "dataq" | "cpdp";
  caseId: string;
  evidenceId: string;
  label: string;
  contextNote: string | null;
};

const CLOSED_DATAQ = ["approved", "denied", "closed"];
const CLOSED_CPDP = ["determination_made", "closed"];
const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 150;

function chunks<T>(values: T[], size = ID_CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadClientCaseRows(
  service: SupabaseLike,
  table: "dataq_cases" | "cpdp_cases",
  clientId: string
) {
  const rows: CaseRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from(table)
      .select("id, status")
      .eq("client_id", clientId)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as CaseRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadActiveTypedRequests(
  service: SupabaseLike,
  clientId: string
) {
  const rows: TypedRequestRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from("client_requests")
      .select("case_id, requested_items")
      .eq("client_id", clientId)
      .eq("request_type", "evidence")
      .eq("status", "open")
      .in("evidence_status", ["open", "submitted", "insufficient"])
      .not("case_id", "is", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as TypedRequestRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Consolidate every client-supplied evidence item across open cases into one portal request. */
export async function syncClientEvidenceRequest(service: SupabaseLike, clientId: string) {
  const [dataqCases, cpdpCases, typedRequests] = await Promise.all([
    loadClientCaseRows(service, "dataq_cases", clientId),
    loadClientCaseRows(service, "cpdp_cases", clientId),
    loadActiveTypedRequests(service, clientId),
  ]);
  const typedItemKeysByCase = new Map<string, Set<string>>();
  for (const request of typedRequests) {
    if (!request.case_id) continue;
    const itemKeys = typedItemKeysByCase.get(request.case_id) ?? new Set<string>();
    for (const item of request.requested_items ?? []) {
      if (typeof item.itemKey === "string") itemKeys.add(item.itemKey);
    }
    typedItemKeysByCase.set(request.case_id, itemKeys);
  }

  const openDataqIds = dataqCases
    .filter((row) => !CLOSED_DATAQ.includes(row.status ?? ""))
    .map((row) => row.id);
  const openCpdpIds = cpdpCases
    .filter((row) => !CLOSED_CPDP.includes(row.status ?? ""))
    .map((row) => row.id);

  const items: RequestedEvidenceItem[] = [];
  if (openDataqIds.length > 0) {
    for (const caseIds of chunks(openDataqIds)) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await service
          .from("dataq_evidence")
          .select("id, case_id, doc_type, label, context_note, status, acquisition_method")
          .in("case_id", caseIds)
          .eq("required", true)
          .neq("status", "received")
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          const typedItemKeys = typedItemKeysByCase.get(row.case_id);
          if (
            typedItemKeys &&
            laneBItemCoversLegacyEvidence(row.doc_type, typedItemKeys)
          ) {
            continue;
          }
          // Only client-supplied items belong in the portal. GEIA-pull/automatic sources do not.
          if (row.acquisition_method !== "client") continue;
          items.push({
            caseType: "dataq",
            caseId: row.case_id,
            evidenceId: row.id,
            label: row.label,
            contextNote: row.context_note,
          });
        }
        if ((data ?? []).length < PAGE_SIZE) break;
      }
    }
  }

  if (openCpdpIds.length > 0) {
    for (const caseIds of chunks(openCpdpIds)) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await service
          .from("cpdp_evidence")
          .select("id, case_id, doc_type, label, context_note, status")
          .in("case_id", caseIds)
          .eq("required", true)
          .neq("status", "received")
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          // Police Accident Reports are obtained by GEIA and must never become a client to-do.
          if (row.doc_type === "police_report") continue;
          items.push({
            caseType: "cpdp",
            caseId: row.case_id,
            evidenceId: row.id,
            label: row.label,
            contextNote: row.context_note,
          });
        }
        if ((data ?? []).length < PAGE_SIZE) break;
      }
    }
  }

  const dedupeKey = `${clientId}:case:consolidated-evidence`;
  const now = new Date();
  if (items.length === 0) {
    const { error } = await service
      .from("client_requests")
      .update({ status: "fulfilled", closed_at: now.toISOString(), next_reminder_at: null, updated_at: now.toISOString() })
      .eq("dedupe_key", dedupeKey)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    return { status: "fulfilled" as const, itemCount: 0 };
  }

  const nextReminder = new Date(now.getTime() + 7 * 86400000).toISOString();
  const { data, error } = await service
    .from("client_requests")
    .upsert(
      {
        client_id: clientId,
        dedupe_key: dedupeKey,
        category: "case_evidence",
        title: "Documents needed for your open case work",
        description: "Upload the client-held records below. GEIA-obtained records are tracked separately and are not shown here.",
        source: "case",
        responsibility: "client",
        requested_items: items,
        status: "open",
        next_reminder_at: nextReminder,
        closed_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "dedupe_key" }
    )
    .select("id, status, requested_items, next_reminder_at")
    .single();
  if (error) throw new Error(error.message);
  return { status: "open" as const, itemCount: items.length, request: data };
}
