import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAutopilotEmail } from "@/lib/email/client";
import { planUrl } from "./intake";
import { serviceClient } from "./queue";
import { REMINDER_NOTE, REMINDER_TEMPLATE, planReminder, reminderEmail } from "./onboarding-reminder-plan";

/**
 * QF-215: sends the onboarding reminders that were pre-approved with the invite.
 *
 * A reminder row is written already 'approved' (no new card for Brandon); the normal sender picks it
 * up, so it gets the same once-only claim, logging and failure handling as every other message.
 * It goes to the address the approved invite went to. Nobody is copied.
 */

type ReminderClient = {
  id: string;
  name: string;
  status: string;
  email: string | null;
  primary_contact: string | null;
  plan_token: string;
  plan_first_viewed_at: string | null;
  service_agreement_accepted: boolean | null;
  onboarding_reminders: boolean | null;
};

export type ReminderRunResult = { checked: number; queued: Array<{ client: string; number: number; stage: string }>; skipped: Array<{ client: string; reason: string }> };

export async function runOnboardingReminders(options: { now?: Date; dryRun?: boolean; service?: SupabaseClient } = {}): Promise<ReminderRunResult> {
  const service = options.service ?? serviceClient();
  const now = options.now ?? new Date();
  const { data: clients, error } = await service
    .from("clients")
    .select("id, name, status, email, primary_contact, plan_token, plan_first_viewed_at, service_agreement_accepted, onboarding_reminders")
    .in("status", ["prospect", "onboarding", "awaiting_activation"]);
  if (error) throw new Error(`reminders: ${error.message}`);

  const result: ReminderRunResult = { checked: 0, queued: [], skipped: [] };
  for (const client of (clients ?? []) as ReminderClient[]) {
    result.checked += 1;
    const [{ data: invite }, { data: sent }, { count: paid }] = await Promise.all([
      service.from("outbound_queue").select("to_address, sent_at, decided_by").eq("client_id", client.id).eq("template", "autopilot_intro").eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      service.from("outbound_queue").select("created_at").eq("client_id", client.id).eq("template", REMINDER_TEMPLATE).order("created_at", { ascending: false }),
      service.from("subscriptions").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "active"),
    ]);
    const to = (invite?.to_address as string | null) ?? client.email;
    const decision = planReminder({
      inviteSentAt: (invite?.sent_at as string | null) ?? null,
      remindersSent: sent?.length ?? 0,
      lastReminderAt: (sent?.[0]?.created_at as string | undefined) ?? null,
      opened: Boolean(client.plan_first_viewed_at),
      signed: Boolean(client.service_agreement_accepted),
      paid: Boolean(paid),
      enabled: client.onboarding_reminders !== false,
      hasEmail: Boolean(to),
    }, now);
    if (!decision.send) { result.skipped.push({ client: client.name, reason: decision.reason }); continue; }

    const dedupeKey = `onboard-reminder:${client.id}:${decision.number}`;
    const { count: exists } = await service.from("outbound_queue").select("id", { count: "exact", head: true }).eq("dedupe_key", dedupeKey);
    if (exists) { result.skipped.push({ client: client.name, reason: "already queued" }); continue; }

    result.queued.push({ client: client.name, number: decision.number, stage: decision.stage });
    if (options.dryRun) continue;

    const email = reminderEmail(decision.stage, decision.number, { company: client.name, contactName: client.primary_contact });
    const cta = { label: "Open your safety plan", href: planUrl(client.plan_token) };
    const stamp = now.toISOString();
    const { error: insertError } = await service.from("outbound_queue").insert({
      client_id: client.id,
      kind: "email",
      template: REMINDER_TEMPLATE,
      status: "approved",
      title: `Reminder ${decision.number} of 3 to ${client.name}`,
      why: "Onboarding reminder. You approved these when you approved the invite.",
      to_address: to,
      cc: null,
      from_identity: "sunny",
      subject: email.subject,
      body_text: email.body,
      body_html: renderAutopilotEmail({ bodyText: email.body, cta }),
      editable: false,
      payload: { cta, stage: decision.stage, reminder: decision.number },
      dedupe_key: dedupeKey,
      created_by: "autopilot",
      decided_at: stamp,
      decided_by: (invite?.decided_by as string | null) ?? null,
      decision_note: REMINDER_NOTE,
    });
    if (insertError) throw new Error(`reminder for ${client.name}: ${insertError.message}`);
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "onboarding_reminder_queued", entity_type: "client", entity_id: client.id,
      description: `Reminder ${decision.number} of 3 queued (${decision.stage.replace("_", " ")}). Pre-approved with the invite.`,
      metadata: { reminder: decision.number, stage: decision.stage },
    });
  }
  return result;
}
