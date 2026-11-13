import "server-only";
import { deliverApprovedEmail, renderAutopilotEmail } from "@/lib/email/client";
import { runHooks } from "./decide";
import { planSend, type ApprovedRow } from "./send-plan";
import { serviceClient, type OutboundRow } from "./queue";

/**
 * QF-198: the carrier-side sender. GoldenDesk records Brandon's decision on the queue row and never emails.
 * This job picks up rows marked 'approved', claims each exactly once, sends, runs the approval hooks, and
 * writes sent or failed back. A row that is claimed but never finished stays 'approved', and the Health
 * check turns that into a task; it is never retried automatically, so a carrier cannot get two copies.
 *
 * Off until SAFESCORE_SENDER_ENABLED=true (set at the switch-over to the shared database).
 */
export async function sendApprovedCards(limit = 20) {
  if (process.env.SAFESCORE_SENDER_ENABLED?.trim().toLowerCase() !== "true") {
    return { enabled: false as const, sent: 0, applied: 0, failed: 0, skipped: 0 };
  }
  const service = serviceClient();
  const { data, error } = await service
    .from("outbound_queue")
    .select("*")
    .eq("status", "approved")
    .is("send_result", null)
    .order("decided_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`queue read failed: ${error.message}`);

  const out = { enabled: true as const, sent: 0, applied: 0, failed: 0, skipped: 0 };
  for (const candidate of (data ?? []) as OutboundRow[]) {
    const plan = planSend(candidate as unknown as ApprovedRow);
    if (plan.action === "skip") { out.skipped += 1; continue; }

    // Claim: only one run can flip send_result from null, so a double run cannot double send.
    const { data: claimed } = await service
      .from("outbound_queue")
      .update({ send_result: { claimed_at: new Date().toISOString() } })
      .eq("id", candidate.id)
      .eq("status", "approved")
      .is("send_result", null)
      .select("*")
      .maybeSingle();
    if (!claimed) { out.skipped += 1; continue; }
    const row = claimed as OutboundRow;

    let status: "sent" | "failed" = "sent";
    let errorText: string | null = null;
    let delivery: Record<string, unknown> | null = null;
    let hooks: string[] = [];

    if (plan.action === "fail") {
      status = "failed"; errorText = plan.reason;
    } else if (plan.action === "email") {
      const cta = (row.payload?.cta ?? null) as { label: string; href: string } | null;
      const html = plan.rerender
        ? renderAutopilotEmail({ bodyText: row.body_text ?? "", cta, fromIdentity: row.from_identity })
        : (row.body_html as string);
      try {
        const result = await deliverApprovedEmail({
          to: plan.to, cc: plan.cc, subject: plan.subject, htmlBody: html,
          template: row.template, clientId: row.client_id, fromIdentity: row.from_identity,
        });
        delivery = { ...result };
        if (!result.success) { status = "failed"; errorText = result.error ?? "Delivery failed"; }
      } catch (e) {
        status = "failed"; errorText = e instanceof Error ? e.message : String(e);
      }
    }
    if (status === "sent") hooks = await runHooks(service, row, row.decided_by ?? null);

    await service.from("outbound_queue").update({
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      send_result: { delivery, hooks },
      error: errorText,
    }).eq("id", row.id);
    await service.from("activity_log").insert({
      client_id: row.client_id,
      user_id: null,
      action_type: status === "sent" ? "outbound_sent" : "outbound_send_failed",
      entity_type: "outbound_queue",
      entity_id: row.id,
      description: `${status === "sent" ? "Sent" : "Failed to send"}: ${row.title}`,
      metadata: { template: row.template, to: row.to_address, dryRun: delivery?.dryRun ?? null, hooks, error: errorText },
    });
    if (status === "failed") out.failed += 1;
    else if (plan.action === "email") out.sent += 1;
    else out.applied += 1;
  }
  return out;
}
