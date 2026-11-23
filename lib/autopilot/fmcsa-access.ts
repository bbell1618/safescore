import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goldenDeskClient } from "./contacts";
import { serviceClient } from "./queue";
import { dueTodayPacific, SAFESCORE_PROJECT } from "./handoff";
import { ingestFmcsaExport } from "@/lib/fmcsa/ingest-export";

/**
 * QF-225 (Brandon, 11/23/2026): "I clicked yes but nothing happened, and the scores still do not
 * load. We already have our own account, so make it actually work."
 *
 * How it works now:
 * 1. A paid carrier says they have an FMCSA Portal login (or that they approved us). Brandon gets
 *    ONE task per carrier: send our access request, then drop the two Portal downloads.
 * 2. "I sent the request" on the carrier page in GoldenDesk blocks the task on the carrier and asks
 *    them (their setup list reopens) to approve it.
 * 3. When the carrier presses "I approved it", the task comes back to To Do, due today.
 * 4. Files dropped on the carrier page wait in fmcsa_import_queue. This job imports them with the
 *    same importer staff use. The first official scores close the task.
 */

const ACCESS_METHODS = ["will_approve", "approved"];

type GdTask = { id: string; status: string | null; deleted_at: string | null };

export function fmcsaTaskSteps(dot: string | null) {
  return [
    `1. Sign in to the FMCSA Portal (portal.fmcsa.dot.gov) with Golden Era's login.`,
    `2. Request access to USDOT ${dot ?? "(their DOT number)"} with the A&I Carrier and DataQs Secure Access roles.`,
    `3. On the carrier's page in SafeScore (The record tab, Official FMCSA scores) press "I sent the request". The carrier is asked to approve it, and this task waits on them.`,
    `4. Once they approve: in the Portal open the carrier's SMS page and download the All BASICs file (CSV) and the inspection detail file (XML).`,
    `5. Drop both files on the carrier's page. The scores show within about a minute and this task closes itself.`,
  ];
}

/** Creates the one FMCSA task per carrier and moves it when the carrier approves. */
export async function processFmcsaAccess(service: SupabaseClient = serviceClient(), limit = 5) {
  const gd = goldenDeskClient();
  if (!gd) return [];
  const results: Array<{ client: string; action: string }> = [];

  // 1. New task for carriers who said yes and have none yet.
  const { data: fresh, error } = await service
    .from("clients")
    .select("id, name, dot_number, is_practice, fmcsa_portal_access_method, fmcsa_request_sent_at")
    .eq("status", "active")
    .in("fmcsa_portal_access_method", ACCESS_METHODS)
    .is("fmcsa_task_id", null)
    .limit(limit);
  if (error) throw new Error(`fmcsa access: ${error.message}`);
  for (const client of fresh ?? []) {
    const { count: official } = await service.from("score_snapshots").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("source", "authenticated");
    if (official) continue;
    const dot = client.dot_number ? String(client.dot_number).replace(/^PR/, "") : null;
    const label = client.is_practice && !/^ZZ PRACTICE/i.test(client.name) ? "PRACTICE: " : "";
    const approved = client.fmcsa_portal_access_method === "approved";
    const { data: task, error: taskError } = await gd.from("tasks").insert({
      title: `${label}Get ${client.name}'s official FMCSA scores${dot ? ` (DOT ${dot})` : ""}`,
      description: [
        approved
          ? `${client.name} says they approved Golden Era's FMCSA Portal access.`
          : `${client.name} has an FMCSA Portal login and will approve our access request.`,
        "",
        "Without this we only have the public record: no percentiles, no alerts, no Crash or Hazmat scores, and no driver names on inspections.",
        "",
        ...fmcsaTaskSteps(dot),
      ].join("\n"),
      status: "To Do",
      priority: "Urgent",
      due_date: dueTodayPacific(),
      assigned_to: "Brandon",
      category: "Onboarding",
      project_id: SAFESCORE_PROJECT.id,
      entity_links: [SAFESCORE_PROJECT],
      summary: `Official FMCSA scores for ${client.name}.`,
      current_state: approved ? "The carrier says they approved our access. Pull the two Portal files." : "The carrier is ready to approve. Our request has not been sent yet.",
      next_action: approved ? "Sign in to the FMCSA Portal and download All BASICs (CSV) and the inspection detail (XML)." : "Sign in to the FMCSA Portal and send our access request.",
      definition_of_done: "Official scores show on the carrier's page in SafeScore.",
      key_facts: [`DOT ${dot ?? "unknown"}`],
    }).select("id").single();
    if (taskError || !task) throw new Error(`fmcsa task for ${client.name}: ${taskError?.message ?? "no task returned"}`);
    const { data: linked } = await service.from("clients").update({ fmcsa_task_id: task.id }).eq("id", client.id).is("fmcsa_task_id", null).select("id").maybeSingle();
    if (!linked) { await gd.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", task.id); continue; }
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "fmcsa_access_task_created", entity_type: "client", entity_id: client.id,
      description: "Task created to get the official FMCSA scores", metadata: { taskId: task.id },
    });
    results.push({ client: client.name, action: "task_created" });
  }

  // 2. The carrier approved after we sent the request: bring a blocked task back, due today.
  const { data: approvedClients } = await service
    .from("clients")
    .select("id, name, fmcsa_task_id")
    .eq("fmcsa_portal_access_method", "approved")
    .not("fmcsa_task_id", "is", null)
    .limit(50);
  for (const client of approvedClients ?? []) {
    const { data: task } = await gd.from("tasks").select("id, status, deleted_at").eq("id", client.fmcsa_task_id).maybeSingle() as { data: GdTask | null };
    if (!task || task.deleted_at || task.status !== "Blocked") continue;
    await gd.from("tasks").update({
      status: "To Do", blocked_by: null, due_date: dueTodayPacific(),
      current_state: "The carrier says they approved our FMCSA Portal access.",
      next_action: "Sign in to the FMCSA Portal, download All BASICs (CSV) and the inspection detail (XML), and drop both on the carrier's page.",
    }).eq("id", task.id);
    results.push({ client: client.name, action: "task_unblocked" });
  }
  return results;
}

/** Imports files dropped on the carrier page in GoldenDesk. */
export async function processFmcsaImports(service: SupabaseClient = serviceClient(), limit = 4) {
  const { data: rows, error } = await service
    .from("fmcsa_import_queue")
    .select("id, client_id, filename, content")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`fmcsa imports: ${error.message}`);
  const done: Array<{ id: string; status: string }> = [];
  for (const row of rows ?? []) {
    const { data: client } = await service.from("clients").select("id, name, dot_number, fmcsa_task_id").eq("id", row.client_id).maybeSingle();
    if (!client) continue;
    let status = "failed";
    let body: Record<string, unknown> = {};
    try {
      const res = await ingestFmcsaExport({ clientId: client.id, dotNumber: String(client.dot_number ?? ""), content: row.content, filename: row.filename });
      body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      status = res.ok ? (body.status === "skipped" ? "skipped" : "done") : "failed";
    } catch (e) {
      body = { error: e instanceof Error ? e.message : String(e) };
    }
    const kind = typeof body.ingest_kind === "string" ? body.ingest_kind : null;
    await service.from("fmcsa_import_queue").update({
      status, ingest_kind: kind, result: body, error: status === "failed" ? String(body.error ?? "The file could not be read.") : null,
      processed_at: new Date().toISOString(),
    }).eq("id", row.id);
    await service.from("activity_log").insert({
      client_id: client.id, action_type: status === "failed" ? "fmcsa_import_failed" : "fmcsa_import_done", entity_type: "client", entity_id: client.id,
      description: status === "failed"
        ? `FMCSA file could not be imported (${row.filename ?? "file"}): ${String(body.error ?? "unknown error")}`
        : status === "skipped" ? `FMCSA file already imported (${row.filename ?? "file"})`
        : kind === "all_basics" ? `Official FMCSA scores imported (SMS run ${String(body.snapshot_date ?? "")})` : `Inspection detail imported (${row.filename ?? "file"})`,
      metadata: { queueId: row.id, kind },
    });
    if (status === "done" && kind === "all_basics" && client.fmcsa_task_id) {
      const gd = goldenDeskClient();
      if (gd) {
        await gd.from("tasks").update({
          status: "Done", blocked_by: null, completed_at: new Date().toISOString(),
          outcome: `Official FMCSA scores imported from the Portal (SMS run ${String(body.snapshot_date ?? "")}). They show on the carrier's page in SafeScore.`,
        }).eq("id", client.fmcsa_task_id).neq("status", "Done");
      }
    }
    done.push({ id: row.id, status });
  }
  return done;
}
