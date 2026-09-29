import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverApprovedEmail, renderAutopilotEmail } from "@/lib/email/client";
import { serviceClient, type OutboundRow } from "./queue";

export class DecisionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Hook =
  | { type: "publish_plan"; planId: string }
  | { type: "report_sent"; reportId: string }
  | { type: "playbook_publish"; playbookId: string };

async function runHooks(service: SupabaseClient, row: OutboundRow, decidedBy: string | null) {
  const hooks = (Array.isArray(row.payload?.onApprove) ? row.payload.onApprove : []) as Hook[];
  const results: string[] = [];
  for (const hook of hooks) {
    if (hook.type === "publish_plan") {
      const { data: plan } = await service.from("safety_plans").select("client_id").eq("id", hook.planId).maybeSingle();
      if (!plan) continue;
      await service
        .from("safety_plans")
        .update({ status: "superseded" })
        .eq("client_id", plan.client_id)
        .eq("status", "published")
        .neq("id", hook.planId);
      const { error } = await service
        .from("safety_plans")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", hook.planId);
      results.push(error ? `plan publish failed: ${error.message}` : "plan published");
    } else if (hook.type === "report_sent") {
      const now = new Date().toISOString();
      const { data, error } = await service
        .from("reports")
        .update({ status: "sent", sent_at: now, sent_by: decidedBy, reviewed_at: now, reviewed_by: decidedBy })
        .eq("id", hook.reportId)
        .in("status", ["draft", "reviewed"])
        .select("id");
      results.push(error ? `report send failed: ${error.message}` : data?.length ? "report marked sent" : "report already sent");
    } else if (hook.type === "playbook_publish") {
      const now = new Date().toISOString();
      const { error } = await service
        .from("client_playbooks")
        .update({ review_status: "published", reviewed_by: decidedBy, reviewed_at: now, published_by: decidedBy, published_at: now })
        .eq("id", hook.playbookId);
      results.push(error ? `playbook publish failed: ${error.message}` : "playbook published");
    }
  }
  return results;
}

async function logDecision(service: SupabaseClient, row: OutboundRow, action: string, userId: string | null, metadata: Record<string, unknown>) {
  await service.from("activity_log").insert({
    client_id: row.client_id,
    user_id: userId,
    action_type: action,
    entity_type: "outbound_queue",
    entity_id: row.id,
    description: `${action === "outbound_approved" ? "Approved" : "Rejected"}: ${row.title}`,
    metadata: { template: row.template, to: row.to_address, ...metadata },
  });
}

async function claim(service: SupabaseClient, id: string, update: Record<string, unknown>): Promise<OutboundRow> {
  const { data, error } = await service
    .from("outbound_queue")
    .update(update)
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new DecisionError(error.message, 500);
  if (!data) throw new DecisionError("This card was already decided. Reload the Inbox.", 409);
  return data as OutboundRow;
}

export async function approveCard(
  id: string,
  userId: string | null,
  edits: { subject?: string | null; bodyText?: string | null; toAddress?: string | null; cc?: string | null } = {}
) {
  const service = serviceClient();
  const { data: current, error } = await service.from("outbound_queue").select("*").eq("id", id).maybeSingle();
  if (error) throw new DecisionError(error.message, 500);
  if (!current) throw new DecisionError("Card not found.", 404);
  const row = current as OutboundRow;
  if (row.status !== "pending") throw new DecisionError("This card was already decided. Reload the Inbox.", 409);
  if (row.kind === "needs_info") throw new DecisionError("This card needs an answer, not an approval.", 400);

  const update: Record<string, unknown> = { status: "approved", decided_at: new Date().toISOString(), decided_by: userId };
  let edited = false;
  if (row.kind === "email" || row.kind === "report_send") {
    const subject = edits.subject?.trim();
    const bodyText = edits.bodyText?.trim();
    const to = edits.toAddress?.trim();
    if (to && to !== row.to_address) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new DecisionError("The To address is not a valid email.");
      update.to_address = to; edited = true;
    }
    if (edits.cc !== undefined && (edits.cc ?? "") !== (row.cc ?? "")) { update.cc = edits.cc?.trim() || null; edited = true; }
    if (subject && subject !== row.subject) { update.subject = subject; edited = true; }
    if (bodyText && bodyText !== (row.body_text ?? "").trim()) {
      if (!row.editable) throw new DecisionError("This system message can be approved or rejected, not edited.");
      const cta = (row.payload?.cta ?? null) as { label: string; href: string } | null;
      update.body_text = bodyText;
      update.body_html = renderAutopilotEmail({ bodyText, cta, fromIdentity: row.from_identity });
      edited = true;
    }
  }
  update.edited = edited;
  const claimed = await claim(service, id, update);

  let finalStatus: "sent" | "failed" | "approved" = "approved";
  let sendResult: Record<string, unknown> | null = null;
  let errorText: string | null = null;
  if (claimed.kind === "email" || claimed.kind === "report_send") {
    if (!claimed.to_address || !claimed.subject || !claimed.body_html) {
      finalStatus = "failed";
      errorText = "Missing recipient, subject or body.";
    } else {
      const result = await deliverApprovedEmail({
        to: claimed.to_address,
        cc: claimed.cc,
        subject: claimed.subject,
        htmlBody: claimed.body_html,
        template: claimed.template,
        clientId: claimed.client_id,
        fromIdentity: claimed.from_identity,
      });
      sendResult = { ...result };
      finalStatus = result.success ? "sent" : "failed";
      errorText = result.success ? null : result.error ?? "Delivery failed";
    }
  }
  const hookResults = finalStatus === "failed" ? [] : await runHooks(service, claimed, userId);
  await service
    .from("outbound_queue")
    .update({
      status: finalStatus,
      sent_at: finalStatus === "sent" ? new Date().toISOString() : null,
      send_result: { delivery: sendResult, hooks: hookResults },
      error: errorText,
    })
    .eq("id", id);
  await logDecision(service, claimed, "outbound_approved", userId, { edited, status: finalStatus, dryRun: sendResult?.dryRun ?? null, hooks: hookResults });
  return { status: finalStatus, dryRun: Boolean(sendResult?.dryRun), error: errorText, hooks: hookResults };
}

export async function rejectCard(id: string, userId: string | null, note: string | null) {
  const service = serviceClient();
  const claimed = await claim(service, id, {
    status: "rejected",
    decided_at: new Date().toISOString(),
    decided_by: userId,
    decision_note: note?.trim() || null,
  });
  await logDecision(service, claimed, "outbound_rejected", userId, { note });
  return { status: "rejected" as const };
}
