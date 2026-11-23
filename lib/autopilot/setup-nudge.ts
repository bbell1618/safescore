import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAutopilotEmail } from "@/lib/email/client";
import { appBase } from "./account-invite";
import { firstName, isPacificWeekend, planReminder, REMINDER_DAYS } from "./onboarding-reminder-plan";
import { enqueueCard, serviceClient, supersedeCards } from "./queue";
import { loadSetupChecklist } from "./setup-checklist";
import { nudgeItemLabel, nudgeItemOpen, setupItemStates } from "./setup-items";

/**
 * QF-223 (Brandon, 11/23/2026): from the carrier's page Brandon can draft one email asking the
 * carrier to sign in and finish their setup list. He picks the items (default: everything the
 * carrier still has to do) and whether up to 3 reminders may follow. Like the invite, approving
 * the email approves the reminders. Reminders go on days 2, 5 and 9, never on a weekend, list only
 * what is still open, and stop once every item he asked about is done.
 *
 * GoldenDesk writes the request onto the carrier row; the every-minute job turns it into an
 * approval card here, because the email layout lives in this app.
 */

export const NUDGE_TEMPLATE = "autopilot_setup_nudge";
export const NUDGE_REMINDER_TEMPLATE = "autopilot_setup_nudge_reminder";

type NudgeRequest = { items?: Array<{ key?: string; label?: string }>; reminders?: boolean; requested_at?: string; by?: string };

const numbered = (lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`).join("\n");

function nudgeEmail(contactName: string | null, items: string[]) {
  const first = firstName(contactName);
  const body = [
    first ? `Hi ${first},` : "Hello,",
    "This is Sunny, the AI assistant at Golden Era Insurance Agency. Your SafeScore service has started. To work on your record we still need a few things from you. Use the button below to sign in to your setup list.",
    `What is left:\n${numbered(items)}`,
    "Each one takes a few minutes, and you can do them in any order. Sign in with your email and the password you made. If you forgot it, the sign-in page can email you a code.",
    "Reply to this email with any question.",
  ].join("\n\n");
  return { subject: "A few things left on your SafeScore setup list", body };
}

function reminderEmail(contactName: string | null, items: string[], number: number) {
  const first = firstName(contactName);
  const lines = [
    first ? `Hi ${first},` : "Hello,",
    "This is Sunny, the AI assistant at Golden Era Insurance Agency, with a quick reminder. Use the button below to sign in to your setup list.",
    `Still open:\n${numbered(items)}`,
  ];
  if (number >= REMINDER_DAYS.length) lines.push("This is our last reminder about these items. Your setup list stays in your account whenever you are ready.");
  lines.push("Reply to this email with any question.");
  return { subject: "Reminder: a few things left on your SafeScore setup list", body: lines.join("\n\n") };
}

/** What the approval card shows under "approving also approves up to 3 reminders". */
export function nudgeReminderPreview(contactName: string | null, items: string[]) {
  const sample = reminderEmail(contactName, items, 1);
  return {
    days: [...REMINDER_DAYS],
    variants: [{ stage: "open", when: "If anything on this list is still open", subject: sample.subject, body: sample.body }],
    lastLine: "Each reminder lists only the items still open. The third one says it is the last.",
  };
}

const signInCta = () => ({ label: "Sign in to your setup list", href: `${appBase()}/login`, position: "top" });

/** Every minute: turn GoldenDesk's "Ask them to finish" requests into approval cards. */
export async function processSetupNudgeRequests(service: SupabaseClient = serviceClient()) {
  const { data: clients, error } = await service
    .from("clients")
    .select("id, name, email, primary_contact, is_practice, status, setup_nudge_request")
    .not("setup_nudge_request", "is", null)
    .limit(20);
  if (error) throw new Error(`setup emails: ${error.message}`);
  const done: Array<{ client: string; result: string }> = [];
  for (const client of clients ?? []) {
    const request = (client.setup_nudge_request ?? {}) as NudgeRequest;
    const clear = () => service.from("clients").update({ setup_nudge_request: null }).eq("id", client.id);
    const data = await loadSetupChecklist(client.id, service);
    if (!data || !client.email) {
      await clear();
      await service.from("activity_log").insert({ client_id: client.id, action_type: "setup_nudge_skipped", entity_type: "client", entity_id: client.id, description: !client.email ? "Could not write the setup-list email: no email on file." : "Could not write the setup-list email: carrier not found." });
      done.push({ client: client.name, result: "skipped" });
      continue;
    }
    const states = setupItemStates(data);
    const keys = [...new Set((request.items ?? []).map((i) => String(i.key ?? "")).filter(Boolean))];
    const items = keys.filter((k) => nudgeItemOpen(k, data, states)).map((k) => ({ key: k, label: nudgeItemLabel(k, data, states) })).filter((i): i is { key: string; label: string } => Boolean(i.label));
    if (!items.length) {
      await clear();
      await service.from("activity_log").insert({ client_id: client.id, action_type: "setup_nudge_skipped", entity_type: "client", entity_id: client.id, description: "Setup-list email not written: every item you picked is already done." });
      done.push({ client: client.name, result: "nothing open" });
      continue;
    }
    const reminders = request.reminders !== false;
    const email = nudgeEmail(client.primary_contact, items.map((i) => i.label));
    const cta = signInCta();
    await supersedeCards(`setup-nudge:${client.id}`, service);
    await enqueueCard({
      clientId: client.id,
      kind: "email",
      template: NUDGE_TEMPLATE,
      title: `${client.is_practice ? "PRACTICE: " : ""}Ask ${client.name} to finish their setup list`,
      why: `The carrier has paid but still owes us ${items.length} item${items.length === 1 ? "" : "s"}.`
        + (client.is_practice ? " Practice copy: this goes only to you." : "")
        + (reminders ? " Approving this also approves up to 3 short reminders (days 2, 5 and 9) while any of these stay open." : " Reminders are off, so approving sends only this email."),
      toAddress: client.email,
      cc: null,
      subject: email.subject,
      bodyText: email.body,
      bodyHtml: renderAutopilotEmail({ bodyText: email.body, cta }),
      editable: true,
      payload: { cta, items, reminders, reminderPlan: reminders ? nudgeReminderPreview(client.primary_contact, items.map((i) => i.label)) : null },
      dedupeKey: `setup-nudge:${client.id}:${Date.now()}`,
    }, service);
    await service.from("clients").update({ setup_nudge_request: null, setup_reminders: reminders }).eq("id", client.id);
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "setup_nudge_drafted", entity_type: "client", entity_id: client.id,
      description: `Setup-list email written for approval: ${items.length} item${items.length === 1 ? "" : "s"}${reminders ? ", reminders on" : ", reminders off"}.`,
      metadata: { items, reminders, by: request.by ?? null },
    });
    done.push({ client: client.name, result: `card with ${items.length} items` });
  }
  return done;
}

/** Daily: up to 3 pre-approved reminders after an approved setup-list email, while items stay open. */
export async function runSetupNudgeReminders(options: { now?: Date; service?: SupabaseClient; dryRun?: boolean } = {}) {
  const service = options.service ?? serviceClient();
  const now = options.now ?? new Date();
  const result = { checked: 0, queued: [] as Array<{ client: string; number: number }>, skipped: [] as Array<{ client: string; reason: string }> };
  if (isPacificWeekend(now)) return { ...result, skipped: [{ client: "all", reason: "no reminders on a weekend" }] };
  const { data: clients, error } = await service.from("clients").select("id, name, email, primary_contact, setup_reminders, status").eq("status", "active");
  if (error) throw new Error(`setup reminders: ${error.message}`);
  for (const client of clients ?? []) {
    const { data: nudge } = await service.from("outbound_queue")
      .select("id, to_address, sent_at, decided_by, payload")
      .eq("client_id", client.id).eq("template", NUDGE_TEMPLATE).eq("status", "sent")
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (!nudge?.sent_at) continue;
    result.checked += 1;
    const payload = (nudge.payload ?? {}) as { items?: Array<{ key: string; label: string }>; reminders?: boolean };
    if (payload.reminders === false) { result.skipped.push({ client: client.name, reason: "reminders were off when the email was approved" }); continue; }
    const { data: sent } = await service.from("outbound_queue").select("created_at")
      .eq("client_id", client.id).eq("template", NUDGE_REMINDER_TEMPLATE).gte("created_at", nudge.sent_at)
      .order("created_at", { ascending: false });
    const data = await loadSetupChecklist(client.id, service);
    if (!data) continue;
    const states = setupItemStates(data);
    const open = (payload.items ?? []).filter((i) => nudgeItemOpen(i.key, data, states)).map((i) => nudgeItemLabel(i.key, data, states) ?? i.label);
    const to = (nudge.to_address as string | null) ?? client.email;
    const decision = planReminder({
      inviteSentAt: nudge.sent_at as string,
      remindersSent: sent?.length ?? 0,
      lastReminderAt: (sent?.[0]?.created_at as string | undefined) ?? null,
      opened: true,
      signed: true,
      paid: open.length === 0, // "paid" here means: nothing left to remind about
      enabled: client.setup_reminders !== false,
      hasEmail: Boolean(to),
    }, now);
    if (!decision.send) { result.skipped.push({ client: client.name, reason: open.length ? decision.reason : "every item asked about is done" }); continue; }
    const dedupeKey = `setup-nudge-reminder:${nudge.id}:${decision.number}`;
    const { count: exists } = await service.from("outbound_queue").select("id", { count: "exact", head: true }).eq("dedupe_key", dedupeKey);
    if (exists) { result.skipped.push({ client: client.name, reason: "already queued" }); continue; }
    result.queued.push({ client: client.name, number: decision.number });
    if (options.dryRun) continue;
    const email = reminderEmail(client.primary_contact, open, decision.number);
    const cta = signInCta();
    const stamp = now.toISOString();
    const { error: insertError } = await service.from("outbound_queue").insert({
      client_id: client.id,
      kind: "email",
      template: NUDGE_REMINDER_TEMPLATE,
      status: "approved",
      title: `Setup-list reminder ${decision.number} of 3 to ${client.name}`,
      why: "You approved these reminders when you approved the setup-list email.",
      to_address: to,
      cc: null,
      from_identity: "sunny",
      subject: email.subject,
      body_text: email.body,
      body_html: renderAutopilotEmail({ bodyText: email.body, cta }),
      editable: false,
      payload: { cta, reminder: decision.number, open },
      dedupe_key: dedupeKey,
      created_by: "autopilot",
      decided_at: stamp,
      decided_by: (nudge.decided_by as string | null) ?? null,
      decision_note: "Pre-approved with the setup-list email",
    });
    if (insertError) throw new Error(`setup reminder for ${client.name}: ${insertError.message}`);
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "setup_nudge_reminder_queued", entity_type: "client", entity_id: client.id,
      description: `Setup-list reminder ${decision.number} of 3 queued (${open.length} item${open.length === 1 ? "" : "s"} still open). Pre-approved with the email.`,
      metadata: { reminder: decision.number, open },
    });
  }
  return result;
}
