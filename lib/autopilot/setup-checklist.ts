import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./queue";
import { ensureRosterRequest } from "./plan-page-server";
import { setupItemStates } from "./setup-items";

/**
 * QF-221: everything we still need from a carrier after they have signed and paid.
 *
 * Brandon (11/23/2026): the first thing on the carrier's account home is the list of what they still
 * owe us, it can be skipped, and it collects enough to actually start working the case.
 * This file builds that list and creates the document requests ("intake pack") that go with the
 * service they bought. Everything here is idempotent: it runs on every home-page load and in the
 * hand-off cron.
 */

export const INTAKE_CATEGORY = "intake_documents";

type PackItem = { key: string; title: string; why: string; tiers: string[]; optional: boolean };

/** Document asks by service. "optional" only changes the wording; every ask can be answered "I do not have this". */
const PACK: PackItem[] = [
  {
    key: "fmcsa-letters",
    title: "Any letter from FMCSA or DOT in the last 2 years",
    why: "A warning letter, an audit result or a fine notice tells us what the government is already watching.",
    tiers: ["monitor", "remediate", "total_safety"],
    optional: true,
  },
  {
    key: "disputed-inspections",
    title: "Inspection reports you think are wrong",
    why: "If an inspector wrote up the wrong truck, the wrong driver, or something that was not broken, we can ask to have it removed.",
    tiers: ["remediate", "total_safety"],
    optional: true,
  },
  {
    key: "repair-receipts",
    title: "Repair receipts for write-ups from the last 6 months",
    why: "Proof a problem was fixed backs up a challenge and shows an auditor you act on inspections.",
    tiers: ["remediate", "total_safety"],
    optional: true,
  },
  {
    key: "drug-alcohol-program",
    title: "Proof of your drug and alcohol testing program",
    why: "The enrollment letter or certificate from your testing company. Auditors ask for this first.",
    tiers: ["total_safety"],
    optional: false,
  },
  {
    key: "annual-inspections",
    title: "The latest annual inspection for your trucks",
    why: "Every truck and trailer needs one each year. We track the dates so none runs out.",
    tiers: ["total_safety"],
    optional: false,
  },
  {
    key: "safety-policy",
    title: "Your safety policy or driver handbook",
    why: "If you have one, we build on it. If you do not, we write one with you.",
    tiers: ["total_safety"],
    optional: true,
  },
];

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

/** Creates the document requests for the carrier's service. Safe to call again and again. */
export async function ensureIntakePack(service: SupabaseClient, client: { id: string; tier: string | null; status: string; intake_pack_at?: string | null }) {
  if (client.status !== "active" || !client.tier) return { created: 0 };
  const tier = client.tier;
  const wanted: Array<{ dedupe: string; title: string; why: string; optional: boolean }> = PACK
    .filter((item) => item.tiers.includes(tier))
    .map((item) => ({ dedupe: `${client.id}:intake:${item.key}`, title: item.title, why: item.why, optional: item.optional }));

  if (tier === "remediate" || tier === "total_safety") {
    const since = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
    const { data: crashes } = await service
      .from("crashes")
      .select("id, crash_date, state, city, par_document_id, fmcsa_not_preventable")
      .eq("client_id", client.id)
      .gte("crash_date", since)
      .order("crash_date", { ascending: false })
      .limit(8);
    for (const crash of crashes ?? []) {
      if (crash.par_document_id || crash.fmcsa_not_preventable) continue;
      const where = [crash.city, crash.state].filter(Boolean).join(", ");
      wanted.push({
        dedupe: `${client.id}:intake:crash:${crash.id}`,
        title: `Police report for the crash on ${dateLabel(crash.crash_date as string)}${where ? ` in ${where}` : ""}`,
        why: "If the report shows the crash was not your driver's fault, we ask FMCSA to stop counting it against you.",
        optional: true,
      });
    }
  }
  if (!wanted.length) return { created: 0 };

  const { data: existing } = await service.from("client_requests").select("dedupe_key").in("dedupe_key", wanted.map((w) => w.dedupe));
  const have = new Set((existing ?? []).map((row) => row.dedupe_key as string));
  const rows = wanted.filter((w) => !have.has(w.dedupe)).map((w) => ({
    client_id: client.id,
    dedupe_key: w.dedupe,
    category: INTAKE_CATEGORY,
    title: w.title,
    description: w.optional ? "If you have it. A phone photo works." : "A phone photo works.",
    why_copy: w.why,
    source: "standing",
    responsibility: "client",
    requested_items: [],
    status: "open",
    reminder_limit: 3,
    reminder_interval_days: 7,
  }));
  if (rows.length) {
    const { error } = await service.from("client_requests").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) throw new Error(`intake pack: ${error.message}`);
  }
  if (!client.intake_pack_at) {
    await service.from("clients").update({ intake_pack_at: new Date().toISOString() }).eq("id", client.id).is("intake_pack_at", null);
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "intake_pack_created", entity_type: "client", entity_id: client.id,
      description: `Asked the carrier for ${rows.length} document${rows.length === 1 ? "" : "s"} for their ${tier.replace("_", " ")} service.`,
      metadata: { tier, requests: rows.map((r) => r.title) },
    });
  }
  return { created: rows.length };
}

/**
 * Drivers copied from the agency's client file are put into the carrier's own driver list, so the
 * carrier sees them there, corrects them and confirms them, instead of typing a second copy.
 */
export async function stageClientFileDrivers(service: SupabaseClient, clientId: string) {
  const { data: pending } = await service
    .from("drivers")
    .select("id")
    .eq("client_id", clientId)
    .eq("source", "operator")
    .is("carrier_confirmed_at", null)
    .is("request_id", null)
    .eq("status", "active")
    .limit(500);
  if (!pending?.length) return 0;
  const token = await ensureRosterRequest(service, clientId);
  const { data: request } = await service.from("client_requests").select("id").eq("upload_token", token).maybeSingle();
  if (!request) return 0;
  const { error } = await service
    .from("drivers")
    .update({ source: "client_portal", request_id: request.id, approved_at: null, approved_by: null, updated_at: new Date().toISOString() })
    .in("id", pending.map((row) => row.id as string));
  if (error) throw new Error(`staging drivers: ${error.message}`);
  return pending.length;
}

export type SetupDriver = { id: string; name: string; state: string | null; license: string | null; licenseExpiry: string | null; medicalExpiry: string | null; confirmed: boolean };
export type SetupTruck = { id: string; unit: string | null; unitType: "truck" | "trailer"; year: number | null; make: string | null; model: string | null; vin: string | null; plate: string | null; plateState: string | null; confirmed: boolean };
export type SetupRequest = { id: string; title: string; why: string | null; hint: string | null; state: "open" | "received" | "skipped"; question: boolean; items: Array<{ key: string; label: string }> };

export type SetupChecklist = {
  planToken: string;
  clientName: string;
  tier: string | null;
  fromClientFile: boolean;
  drivers: { list: SetupDriver[]; rosterUrl: string | null; submittedAt: string | null };
  trucks: { list: SetupTruck[]; confirmedAt: string | null; note: string | null };
  eld: { provider: string | null; connected: boolean; helpAsked: boolean };
  operation: { radius: string | null; states: string[]; vehicleTypes: string[] };
  fmcsa: { method: string | null; at: string | null; requestSentAt: string | null };
  safetyContact: { name: string | null; phone: string | null; email: string | null; confirmedAt: string | null; ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null };
  notes: { text: string | null; at: string | null };
  requests: SetupRequest[];
  progress: { done: number; total: number };
  /** QF-227: what a Total Safety carrier is billed for (null for other plans or before payment). */
  billing: { tier: string | null; active: boolean; billedDrivers: number | null };
  /** QF-227: the read-only user address this carrier adds to their ELD (unique per carrier). */
  eldLoginEmail: string;
};

/** QF-227: one address per carrier, so ELDs that allow a user on only one company still work. All land in Sunny's inbox. */
export function eldLoginEmailFor(dot: string | number | null | undefined, stored?: string | null): string {
  if (stored && stored.includes("@")) return stored;
  const digits = String(dot ?? "").replace(/\D/g, "");
  return digits ? `sunnykapoor+${digits}@goldenerainsurance.com` : "sunnykapoor@goldenerainsurance.com";
}

const CLIENT_COLUMNS =
  "id, name, tier, status, geia_client, plan_token, eld_provider, operating_radius, operating_states, vehicle_types, primary_contact, phone, email, " +
  "fmcsa_portal_access_at, fmcsa_portal_access_method, fmcsa_request_sent_at, safety_contact_name, safety_contact_email, safety_contact_phone, safety_contact_confirmed_at, " +
  "trucks_confirmed_at, trucks_note, intake_pack_at, carrier_notes, carrier_notes_at, billed_driver_count, dot_number, eld_login_email";

function items(value: unknown): Array<{ key: string; label: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const key = typeof item.itemKey === "string" ? item.itemKey : typeof item.evidenceId === "string" ? item.evidenceId : null;
    return key && typeof item.label === "string" ? [{ key, label: item.label }] : [];
  });
}

/** Loads the list for one carrier. Creates the intake requests and stages client-file drivers on the way. */
export async function loadSetupChecklist(clientId: string, service: SupabaseClient = serviceClient()): Promise<SetupChecklist | null> {
  const { data: row, error } = await service.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
  if (error) throw new Error(`setup list: ${error.message}`);
  if (!row) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one wide row, read field by field below
  const client = row as unknown as Record<string, any>;
  if (client.status === "active") {
    await ensureIntakePack(service, { id: client.id, tier: client.tier, status: client.status, intake_pack_at: client.intake_pack_at });
  }

  const [drivers, trucks, roster, eldDone, eldHelp, requests] = await Promise.all([
    service.from("drivers").select("id, full_name, cdl_number, cdl_state, cdl_expiry, medical_cert_expiry, carrier_confirmed_at").eq("client_id", clientId).eq("status", "active").order("full_name"),
    service.from("vehicles").select("id, unit_number, unit_type, year, make, model, vin, license_plate, plate_state, carrier_confirmed_at").eq("client_id", clientId).eq("status", "active").order("unit_number"),
    service.from("client_requests").select("upload_token, submitted_at, status").eq("dedupe_key", `roster_collection:${clientId}`).maybeSingle(),
    service.from("activity_log").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("action_type", "plan_eld_access_confirmed"),
    service.from("activity_log").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("action_type", "plan_eld_help_requested"),
    service
      .from("client_requests")
      .select("id, category, title, description, why_copy, status, request_type, requested_items, response, submitted_at, created_at")
      .eq("client_id", clientId)
      .eq("responsibility", "client")
      .or(`status.eq.open,category.eq.${INTAKE_CATEGORY}`)
      .order("created_at", { ascending: true }),
  ]);

  const driverList: SetupDriver[] = (drivers.data ?? []).map((d) => ({
    id: d.id as string,
    name: d.full_name as string,
    state: (d.cdl_state as string | null) ?? null,
    // Only the last 4 characters ever leave the server.
    license: d.cdl_number ? `•••${String(d.cdl_number).slice(-4)}` : null,
    licenseExpiry: (d.cdl_expiry as string | null) ?? null,
    medicalExpiry: (d.medical_cert_expiry as string | null) ?? null,
    confirmed: Boolean(d.carrier_confirmed_at),
  }));
  const truckList: SetupTruck[] = (trucks.data ?? []).map((v) => ({
    id: v.id as string, unit: v.unit_number as string | null, unitType: v.unit_type === "trailer" ? "trailer" as const : "truck" as const, year: v.year as number | null, make: v.make as string | null, model: v.model as string | null,
    vin: v.vin as string | null, plate: v.license_plate as string | null, plateState: v.plate_state as string | null, confirmed: Boolean(v.carrier_confirmed_at),
  }));
  const requestList: SetupRequest[] = (requests.data ?? [])
    .filter((r) => r.request_type !== "roster_collection")
    .map((r) => {
      const skipped = r.status === "cancelled";
      const received = r.status === "fulfilled" || Boolean(r.submitted_at);
      return {
        id: r.id as string,
        title: r.title as string,
        why: (r.why_copy as string | null) ?? null,
        hint: (r.description as string | null) ?? null,
        state: skipped ? "skipped" as const : received ? "received" as const : "open" as const,
        question: r.request_type === "question",
        items: items(r.requested_items),
      };
    });

  const rosterOpen = roster.data?.status === "open";
  const submittedAt = (roster.data?.submitted_at as string | null) ?? null;
  const eldConnected = Boolean(client.eld_provider && eldDone.count);
  const result: SetupChecklist = {
    planToken: client.plan_token,
    clientName: client.name,
    tier: client.tier,
    fromClientFile: Boolean(client.geia_client),
    drivers: { list: driverList, rosterUrl: rosterOpen && roster.data?.upload_token ? `/roster/${roster.data.upload_token}` : null, submittedAt },
    trucks: { list: truckList, confirmedAt: client.trucks_confirmed_at, note: client.trucks_note },
    eld: { provider: client.eld_provider, connected: eldConnected, helpAsked: Boolean(eldHelp.count) },
    operation: { radius: client.operating_radius, states: client.operating_states ?? [], vehicleTypes: client.vehicle_types ?? [] },
    fmcsa: { method: client.fmcsa_portal_access_method, at: client.fmcsa_portal_access_at, requestSentAt: client.fmcsa_request_sent_at ?? null },
    safetyContact: {
      name: client.safety_contact_name, phone: client.safety_contact_phone, email: client.safety_contact_email, confirmedAt: client.safety_contact_confirmed_at,
      ownerName: client.primary_contact, ownerPhone: client.phone, ownerEmail: client.email,
    },
    notes: { text: client.carrier_notes, at: client.carrier_notes_at },
    requests: requestList,
    progress: { done: 0, total: 0 },
    billing: { tier: client.tier, active: client.status === "active", billedDrivers: client.billed_driver_count ?? null },
    eldLoginEmail: eldLoginEmailFor(client.dot_number, client.eld_login_email),
  };
  const states = setupItemStates(result);
  result.progress = { done: states.filter((x) => x.done).length, total: states.length };
  return result;
}
