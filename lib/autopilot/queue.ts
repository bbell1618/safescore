import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { outboxText } from "@/lib/email/outbox";

/**
 * The approval Inbox. Every client-facing message and every outside-world
 * action is a row here first; it only leaves GEIA after Brandon approves it.
 */

export type OutboundKind = "email" | "report_send" | "playbook_publish" | "filing_packet" | "needs_info";
export type OutboundStatus = "pending" | "approved" | "sent" | "rejected" | "failed" | "superseded";

export type OutboundRow = {
  id: string;
  client_id: string | null;
  kind: OutboundKind;
  template: string;
  status: OutboundStatus;
  title: string;
  why: string | null;
  to_address: string | null;
  cc: string | null;
  from_identity: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  editable: boolean;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  edited: boolean;
  sent_at: string | null;
  send_result: Record<string, unknown> | null;
  error: string | null;
};

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Plain-English label + reason for each legacy system template. */
const LEGACY_TEMPLATE_COPY: Record<string, { title: string; why: string }> = {
  safescore_live: { title: "Tell the carrier their SafeScore is live", why: "Service was just activated." },
  fmcsa_pin_request: { title: "Ask the carrier for their FMCSA Portal PIN", why: "We need it to see their authenticated FMCSA data and to file challenges for them." },
  driver_roster_request: { title: "Ask the carrier for their driver list", why: "The driver list powers driver-file tracking and coaching." },
  new_violation_alert: { title: "Tell the carrier about a new violation", why: "A new roadside violation appeared on their FMCSA record." },
  case_status_change: { title: "Tell the carrier a challenge changed status", why: "FMCSA or the state moved one of their filed cases." },
  report_ready: { title: "Tell the carrier a new report is ready", why: "A report was marked sent and is now visible in their portal." },
  welcome: { title: "Welcome email", why: "A new portal account was created." },
  portal_invite: { title: "Invite the carrier to the SafeScore portal", why: "A portal invite link was created for this carrier." },
  request_queue_reminder: { title: "Remind the carrier about something we still need", why: "An open request reached its reminder date." },
  lane_b_evidence_request: { title: "Ask the carrier for evidence to challenge a violation", why: "A violation looks challengeable if the carrier can supply proof." },
  lane_b_intake_question: { title: "Ask the carrier a quick yes/no question", why: "The answer decides whether a court record can clear a ticket." },
};

/**
 * Per-event client emails that the weekly check-in replaces. They are recorded
 * (so nothing is lost) but never become their own card: the carrier gets one
 * weekly email covering new violations, case changes and open asks.
 */
export const WEEKLY_DIGEST_TEMPLATES = new Set([
  "new_violation_alert",
  "request_queue_reminder",
  "lane_b_evidence_request",
  "lane_b_intake_question",
  "driver_roster_request",
  "case_status_change",
  "fmcsa_pin_request",
]);

export async function enqueueLegacyEmail(message: {
  to: string;
  cc?: string;
  subject: string;
  htmlBody: string;
  template: string;
  trigger: string;
  clientId: string | null;
}): Promise<string> {
  const service = serviceClient();
  let clientId = message.clientId;
  if (!clientId) {
    const match = await service.from("clients").select("id").eq("email", message.to.trim().toLowerCase()).limit(2);
    if (!match.error && match.data?.length === 1) clientId = match.data[0].id as string;
  }
  const copy = LEGACY_TEMPLATE_COPY[message.template] ?? { title: message.subject, why: `System message (${message.trigger}).` };
  const folded = WEEKLY_DIGEST_TEMPLATES.has(message.template);
  const { data, error } = await service
    .from("outbound_queue")
    .insert({
      client_id: clientId,
      kind: "email",
      template: message.template,
      ...(folded
        ? { status: "superseded", decided_at: new Date().toISOString(), decision_note: "Folded into the weekly check-in" }
        : {}),
      title: copy.title,
      why: copy.why,
      to_address: message.to,
      cc: message.cc ?? null,
      from_identity: "sunny",
      subject: message.subject,
      body_html: message.htmlBody,
      body_text: outboxText(message.htmlBody),
      editable: false,
      payload: { trigger: message.trigger },
      created_by: "system",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "no queue row returned");
  return data.id as string;
}

export type EnqueueInput = {
  clientId: string | null;
  kind: OutboundKind;
  template: string;
  title: string;
  why: string;
  toAddress?: string | null;
  cc?: string | null;
  fromIdentity?: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  editable?: boolean;
  payload?: Record<string, unknown>;
  /** Pending cards with the same key are replaced, never duplicated. */
  dedupeKey?: string | null;
};

/**
 * Creates (or refreshes) a pending card. When a pending card with the same
 * dedupe key exists, its content is updated in place so the Inbox always
 * shows the newest version of the same ask.
 */
export async function enqueueCard(input: EnqueueInput, service: SupabaseClient = serviceClient()): Promise<string> {
  const row = {
    client_id: input.clientId,
    kind: input.kind,
    template: input.template,
    title: input.title,
    why: input.why,
    to_address: input.toAddress ?? null,
    cc: input.cc ?? null,
    from_identity: input.fromIdentity ?? "sunny",
    subject: input.subject ?? null,
    body_text: input.bodyText ?? null,
    body_html: input.bodyHtml ?? null,
    editable: input.editable ?? false,
    payload: input.payload ?? {},
    dedupe_key: input.dedupeKey ?? null,
    created_by: "autopilot",
  };
  if (input.dedupeKey) {
    const existing = await service
      .from("outbound_queue")
      .select("id")
      .eq("dedupe_key", input.dedupeKey)
      .eq("status", "pending")
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      const updated = await service.from("outbound_queue").update(row).eq("id", existing.data.id).eq("status", "pending");
      if (updated.error) throw new Error(updated.error.message);
      return existing.data.id as string;
    }
  }
  const { data, error } = await service.from("outbound_queue").insert(row).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "no queue row returned");
  return data.id as string;
}

/** Marks every pending card with this key superseded (the ask no longer applies). */
export async function supersedeCards(dedupeKeyPrefix: string, service: SupabaseClient = serviceClient()) {
  const { error } = await service
    .from("outbound_queue")
    .update({ status: "superseded", decided_at: new Date().toISOString(), decision_note: "No longer needed" })
    .like("dedupe_key", `${dedupeKeyPrefix}%`)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}
