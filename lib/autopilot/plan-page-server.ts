import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./queue";
import { appUrl } from "./intake";
import type { SafetyPlanContent } from "./plan";
import type { CarrierFacts } from "./facts";
import type { ClientTier } from "@/lib/supabase/types";

export const PLAN_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanClient = {
  id: string;
  name: string;
  dot_number: string;
  tier: ClientTier | null;
  status: string;
  primary_contact: string | null;
  primary_contact_title: string | null;
  phone: string | null;
  email: string | null;
  driver_count: number | null;
  eld_provider: string | null;
  filing_authorized: boolean | null;
  filing_authorized_by: string | null;
  filing_authorized_at: string | null;
  service_agreement_accepted: boolean | null;
  operating_states: string[] | null;
  operating_radius: string | null;
  vehicle_types: string[] | null;
  citation_dismissed_last_24_months: boolean | null;
  geia_client: boolean | null;
};

export type PlanRequest = {
  id: string;
  title: string;
  description: string | null;
  why_copy: string | null;
  request_type: string | null;
  upload_token: string;
  created_at: string;
  requested_items: unknown;
  category?: string | null;
};

export type PlanRequestItem = { key: string; label: string };

/** Upload targets inside a request (renewal items, Lane B items, case evidence). */
export function requestItems(value: unknown): PlanRequestItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const key = typeof item.itemKey === "string" ? item.itemKey : typeof item.evidenceId === "string" ? item.evidenceId : null;
    const label = typeof item.label === "string" ? item.label : null;
    return key && label ? [{ key, label }] : [];
  });
}

export type PlanPageData = {
  client: PlanClient;
  plan: SafetyPlanContent | null;
  planVersion: number | null;
  planStatus: string | null;
  facts: CarrierFacts | null;
  asOf: string | null;
  requests: PlanRequest[];
  rosterUrl: string | null;
  rosterDriverCount: number;
  eldConnected: boolean;
};

const CLIENT_COLUMNS =
  "id, name, dot_number, tier, status, primary_contact, primary_contact_title, phone, email, driver_count, eld_provider, filing_authorized, filing_authorized_by, filing_authorized_at, service_agreement_accepted, operating_states, operating_radius, vehicle_types, citation_dismissed_last_24_months, geia_client";

export async function clientForPlanToken(token: string, service: SupabaseClient = serviceClient()): Promise<PlanClient | null> {
  if (!PLAN_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await service.from("clients").select(CLIENT_COLUMNS).eq("plan_token", token).maybeSingle();
  if (error) throw new Error(`Unable to open plan: ${error.message}`);
  return (data as PlanClient | null) ?? null;
}

export async function loadPlanPage(token: string): Promise<PlanPageData | null> {
  const service = serviceClient();
  const client = await clientForPlanToken(token, service);
  if (!client) return null;

  const [planResult, requestsResult, rosterResult, eldResult] = await Promise.all([
    service
      .from("safety_plans")
      .select("version, status, content, facts, generated_at")
      .eq("client_id", client.id)
      .in("status", ["published", "draft"])
      .order("status", { ascending: false }) // "published" sorts before "draft"
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("client_requests")
      .select("id, title, description, why_copy, request_type, upload_token, created_at, requested_items, category")
      .eq("client_id", client.id)
      .eq("status", "open")
      .eq("responsibility", "client")
      .order("created_at", { ascending: true }),
    service
      .from("client_requests")
      .select("id, upload_token, status")
      .eq("dedupe_key", `roster_collection:${client.id}`)
      .eq("status", "open")
      .maybeSingle(),
    service
      .from("activity_log")
      .select("id")
      .eq("client_id", client.id)
      .eq("action_type", "plan_eld_access_confirmed")
      .limit(1),
  ]);
  const { count: driverCount } = await service
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id);

  const requests = ((requestsResult.data ?? []) as PlanRequest[]).filter((r) => r.request_type !== "roster_collection");
  const plan = planResult.data;
  return {
    client,
    plan: (plan?.content as SafetyPlanContent | undefined) ?? null,
    planVersion: (plan?.version as number | undefined) ?? null,
    planStatus: (plan?.status as string | undefined) ?? null,
    facts: (plan?.facts as CarrierFacts | undefined) ?? null,
    asOf: (plan?.generated_at as string | undefined) ?? null,
    requests,
    rosterUrl: rosterResult.data ? `${appUrl()}/roster/${rosterResult.data.upload_token}` : null,
    rosterDriverCount: driverCount ?? 0,
    eldConnected: Boolean(client.eld_provider) && (eldResult.data?.length ?? 0) > 0,
  };
}

export async function recordPlanView(clientId: string) {
  const service = serviceClient();
  const now = new Date().toISOString();
  await service.from("clients").update({ plan_last_viewed_at: now }).eq("id", clientId);
  await service.from("clients").update({ plan_first_viewed_at: now }).eq("id", clientId).is("plan_first_viewed_at", null);
}

/** Finds the open driver-list request for a carrier, creating one when missing. */
export async function ensureRosterRequest(service: SupabaseClient, clientId: string): Promise<string> {
  const dedupeKey = `roster_collection:${clientId}`;
  const { data: existing, error } = await service
    .from("client_requests")
    .select("id, status, upload_token")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const now = new Date();
  const nextReminderAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  if (existing?.status === "open") return existing.upload_token as string;
  if (existing) {
    const { data, error: reopenError } = await service
      .from("client_requests")
      .update({
        status: "open",
        upload_token: crypto.randomUUID(),
        submitted_at: null,
        response: null,
        status_copy: null,
        reminder_count: 0,
        last_reminded_at: null,
        next_reminder_at: nextReminderAt,
        escalated_at: null,
        closed_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", existing.id)
      .select("upload_token")
      .single();
    if (reopenError || !data) throw new Error(reopenError?.message ?? "Unable to reopen the driver list request");
    return data.upload_token as string;
  }
  const { data, error: insertError } = await service
    .from("client_requests")
    .insert({
      client_id: clientId,
      dedupe_key: dedupeKey,
      category: "compliance",
      request_type: "roster_collection",
      source: "standing",
      responsibility: "client",
      title: "Driver roster & qualification documents",
      description: "Add each driver's name and license number. A photo of the license and medical card helps. Progress saves as you go.",
      requested_items: [],
      status: "open",
      reminder_count: 0,
      reminder_limit: 3,
      reminder_interval_days: 7,
      next_reminder_at: nextReminderAt,
      updated_at: now.toISOString(),
    })
    .select("upload_token")
    .single();
  if (insertError || !data) throw new Error(insertError?.message ?? "Unable to create the driver list request");
  return data.upload_token as string;
}

export type PlanRequestView = {
  id: string;
  title: string;
  why: string | null;
  question: boolean;
  items: PlanRequestItem[];
};

export type PlanRequestGroup = {
  key: string;
  title: string;
  why: string;
  requests: PlanRequestView[];
};

function shortTicketLabel(title: string) {
  // "Court paperwork showing how the ticket ended — <violation>, <date>"
  const parts = title.split(" — ");
  return parts.length > 1 ? parts.slice(1).join(" — ") : title;
}

/**
 * Carrier-facing wording for open requests. Internal staff text (long MCS-150
 * notes, regulation names) never reaches the plan page, and many
 * same-kind asks collapse into one card.
 */
export function planRequestGroups(requests: PlanRequest[], categories: Map<string, string | null>): PlanRequestGroup[] {
  const groups = new Map<string, PlanRequestGroup>();
  const add = (key: string, title: string, why: string, view: PlanRequestView) => {
    const group = groups.get(key) ?? { key, title, why, requests: [] };
    group.requests.push(view);
    groups.set(key, group);
  };
  for (const r of requests) {
    const category = categories.get(r.id) ?? null;
    const items = requestItems(r.requested_items);
    const question = r.request_type === "question";
    if (category === "lane_b_evidence" && /court paperwork/i.test(r.title)) {
      add("court", "Court papers for tickets your drivers fought", "If a driver won a ticket in court, the court papers can get that violation removed from your record. Upload what you have. If you don't have them, reply and tell us which court.", {
        id: r.id, title: shortTicketLabel(r.title), why: null, question: false, items,
      });
    } else if (category === "lane_b_evidence") {
      add("evidence", "Proof we need to challenge violations", "These papers help us ask FMCSA to fix mistakes on your record.", {
        id: r.id, title: r.title, why: r.why_copy, question: false, items,
      });
    } else if (category === "mcs150_truth_up") {
      add(`single:${r.id}`, "Update your DOT registration (MCS-150)", "Your DOT registration looks out of date. Send us your current number of trucks and drivers, and your yearly miles (your IFTA report is fine). We fill in the form. You sign it.", {
        id: r.id, title: "Trucks, drivers and miles (IFTA report or a photo of your numbers)", why: null, question: false, items,
      });
    } else if (question) {
      add(`single:${r.id}`, r.title, "Tap Yes or No.", { id: r.id, title: r.title, why: null, question: true, items });
    } else {
      const why = r.why_copy ?? r.description;
      add(`single:${r.id}`, r.title, why && why.length <= 220 ? why : "Upload the document. A phone photo is fine.", {
        id: r.id, title: items.length ? r.title : "Upload the document (a phone photo is fine)", why: null, question: false, items,
      });
    }
  }
  return [...groups.values()];
}
