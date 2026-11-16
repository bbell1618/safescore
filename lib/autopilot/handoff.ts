import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goldenDeskClient } from "./contacts";
import { serviceClient } from "./queue";

/**
 * QF-215: the hand-off. When a carrier has signed and paid, Brandon gets ONE task that says what is
 * still missing before the case can be worked, so he never has to go looking for who finished.
 */

const SAFESCORE_PROJECT = { type: "project", id: "e642d966-a374-4317-8b10-6c9a003ffb67", name: "Golden Era SafeScore" };
const TIER_NAME: Record<string, string> = { monitor: "Monitor", remediate: "Remediate", total_safety: "Total Safety" };

type ActiveClient = {
  id: string; name: string; dot_number: string | null; tier: string | null; is_practice: boolean | null;
  eld_provider: string | null; operating_radius: string | null; fmcsa_pin: string | null; filing_authorized_at: string | null;
};

export async function createHandoffTasks(service: SupabaseClient = serviceClient(), limit = 3) {
  const { data: clients, error } = await service
    .from("clients")
    .select("id, name, dot_number, tier, is_practice, eld_provider, operating_radius, fmcsa_pin, filing_authorized_at")
    .eq("status", "active")
    .is("handoff_task_id", null)
    .limit(limit);
  if (error) throw new Error(`hand-off: ${error.message}`);
  if (!clients?.length) return [];
  const gd = goldenDeskClient();
  if (!gd) return [];

  const created: Array<{ client: string; taskId: string }> = [];
  for (const client of clients as ActiveClient[]) {
    const [drivers, vehicles, eld, requests, challengeable, plan] = await Promise.all([
      service.from("drivers").select("id", { count: "exact", head: true }).eq("client_id", client.id),
      service.from("vehicles").select("id", { count: "exact", head: true }).eq("client_id", client.id),
      service.from("activity_log").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("action_type", "plan_eld_access_confirmed"),
      service.from("client_requests").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "open").eq("responsibility", "client"),
      service.from("violations").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("challengeable", true),
      service.from("safety_plans").select("facts").eq("client_id", client.id).order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const crashCandidates = Number((plan.data?.facts as { crashReviewCandidates?: number } | null)?.crashReviewCandidates ?? 0);

    const missing: string[] = [];
    if (!drivers.count) missing.push("Driver list: none on file. The carrier has not added drivers yet.");
    if (!(client.eld_provider && eld.count)) missing.push("ELD access: the carrier has not added our user to their ELD.");
    if (!client.operating_radius) missing.push("How they run: distance, states and truck types not answered yet.");
    if (!client.fmcsa_pin) missing.push("FMCSA portal access: not set up. Needed to see their private scores and to file for them.");
    if (requests.count) missing.push(`${requests.count} open item${requests.count === 1 ? "" : "s"} the carrier still owes us (see Requests and documents).`);

    const ready: string[] = [
      `${drivers.count ?? 0} drivers and ${vehicles.count ?? 0} vehicles on file.`,
      `${challengeable.count ?? 0} violations look challengeable.`,
      `${crashCandidates} crash${crashCandidates === 1 ? "" : "es"} may qualify for a not-preventable review.`,
    ];
    const tier = TIER_NAME[client.tier ?? ""] ?? client.tier ?? "their service";
    const label = client.is_practice ? "PRACTICE: " : "";
    const description = [
      `${client.name}${client.dot_number ? ` (DOT ${client.dot_number})` : ""} signed and paid for ${tier}. Onboarding is finished on their side.`,
      "",
      missing.length ? "STILL MISSING" : "NOTHING IS MISSING",
      ...missing.map((m) => `- ${m}`),
      "",
      "READY TO WORK",
      ...ready.map((r) => `- ${r}`),
      "",
      "Open the carrier in SafeScore. The Onboarding section at the top shows each step and its date.",
    ].join("\n");

    const { data: task, error: taskError } = await gd.from("tasks").insert({
      title: `${label}${client.name} signed and paid: review the file and start work`,
      description,
      status: "To Do",
      priority: "Medium",
      assigned_to: "Brandon",
      category: "Onboarding",
      project_id: SAFESCORE_PROJECT.id,
      entity_links: [SAFESCORE_PROJECT],
      summary: `${client.name} finished SafeScore sign-up for ${tier}.`,
      current_state: missing.length ? `Signed and paid. ${missing.length} thing${missing.length === 1 ? "" : "s"} still missing.` : "Signed and paid. Nothing missing.",
      next_action: missing.length ? "Open the carrier in SafeScore and work the Still missing list." : "Open the carrier in SafeScore and start on the challengeable violations.",
      definition_of_done: "Every missing item is requested or received, and the first challenges are prepared.",
      key_facts: ready,
    }).select("id").single();
    if (taskError || !task) throw new Error(`hand-off task for ${client.name}: ${taskError?.message ?? "no task returned"}`);

    const { data: linked } = await service.from("clients").update({ handoff_task_id: task.id }).eq("id", client.id).is("handoff_task_id", null).select("id").maybeSingle();
    if (!linked) {
      // Another run got there first: retire this duplicate.
      await gd.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", task.id);
      continue;
    }
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "onboarding_handoff_task_created", entity_type: "client", entity_id: client.id,
      description: `Onboarding finished. Hand-off task created with ${missing.length} missing item${missing.length === 1 ? "" : "s"}.`,
      metadata: { taskId: task.id, missing },
    });
    created.push({ client: client.name, taskId: task.id as string });
  }
  return created;
}
