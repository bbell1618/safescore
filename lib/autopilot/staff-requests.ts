import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/client";
import { renderAutopilotEmail } from "@/lib/email/client";
import { appBase } from "./account-invite";
import { firstName } from "./onboarding-reminder-plan";
import { enqueueCard, serviceClient } from "./queue";

/**
 * QF-229 (Brandon, 11/24/2026): GoldenDesk runs the GEIA side of SafeScore. Anything that needs
 * this app's engine or Stripe is asked for as a row in safescore.staff_requests, and the
 * every-minute job does it here. Kinds so far:
 * - billing_refresh: copy the carrier's Stripe invoices into safescore.invoices.
 * - pay_link_email: draft an approval-card email with a link to pay what they owe.
 */

type StaffRequest = { id: string; client_id: string; kind: string; payload: Record<string, unknown>; requested_by: string | null };

const money = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`;

export async function syncInvoices(service: SupabaseClient, clientId: string) {
  const { data: subs } = await service.from("subscriptions").select("stripe_customer_id").eq("client_id", clientId).not("stripe_customer_id", "is", null);
  const customers = [...new Set((subs ?? []).map((s) => s.stripe_customer_id as string).filter(Boolean))];
  let count = 0;
  for (const customer of customers) {
    const list = await stripe.invoices.list({ customer, limit: 50 });
    for (const inv of list.data) {
      const row = {
        id: inv.id,
        client_id: clientId,
        number: inv.number ?? null,
        status: inv.status ?? null,
        description: inv.lines?.data?.map((l) => l.description).filter(Boolean).join("; ") || inv.description || null,
        amount_due: inv.amount_due ?? 0,
        amount_paid: inv.amount_paid ?? 0,
        amount_remaining: inv.amount_remaining ?? 0,
        currency: inv.currency ?? "usd",
        created_at: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        due_date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
        paid_at: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
        hosted_invoice_url: inv.hosted_invoice_url ?? null,
        invoice_pdf: inv.invoice_pdf ?? null,
        livemode: inv.livemode,
        synced_at: new Date().toISOString(),
      };
      const { error } = await service.from("invoices").upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
      count += 1;
    }
  }
  await service.from("clients").update({ invoices_synced_at: new Date().toISOString() }).eq("id", clientId);
  return { customers: customers.length, invoices: count };
}

async function payLinkEmail(service: SupabaseClient, req: StaffRequest) {
  await syncInvoices(service, req.client_id);
  const { data: client } = await service.from("clients").select("id,name,email,primary_contact,is_practice").eq("id", req.client_id).single();
  if (!client?.email) throw new Error("No email on file for this carrier.");
  const { data: open } = await service.from("invoices").select("*").eq("client_id", req.client_id).eq("status", "open").gt("amount_remaining", 0).order("created_at", { ascending: true });
  const owed = open ?? [];
  if (!owed.length) throw new Error("Nothing is owed right now, so there is nothing to ask them to pay.");
  const total = owed.reduce((sum, i) => sum + Number(i.amount_remaining ?? 0), 0);
  const first = firstName(client.primary_contact);
  const lines = owed.map((i) => `- ${i.number ?? "Invoice"}: ${money(Number(i.amount_remaining))}${i.due_date ? `, due ${new Date(i.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })}` : ""}`);
  const link = owed.length === 1 && owed[0].hosted_invoice_url ? owed[0].hosted_invoice_url : `${appBase()}/portal/account`;
  const body = [
    first ? `Hi ${first},` : "Hello,",
    `This is Sunny, the AI assistant at Golden Era Insurance Agency. Your SafeScore account shows ${money(total)} due.`,
    lines.join("\n"),
    "Use the button below to pay securely by card or bank transfer. If you already paid, reply and let us know.",
    "Reply to this email with any question.",
  ].join("\n\n");
  const cta = { label: owed.length === 1 ? "Pay this invoice" : "Open your account to pay", href: link };
  await enqueueCard({
    clientId: client.id,
    kind: "email",
    template: "autopilot_pay_link",
    title: `${client.is_practice ? "PRACTICE: " : ""}Ask ${client.name} to pay ${money(total)}`,
    why: `${owed.length} unpaid invoice${owed.length === 1 ? "" : "s"} on their SafeScore account.${client.is_practice ? " Practice copy: this goes only to you." : ""}`,
    toAddress: client.email,
    subject: `Your SafeScore payment of ${money(total)}`,
    bodyText: body,
    bodyHtml: renderAutopilotEmail({ bodyText: body, cta }),
    editable: true,
    payload: { cta, invoices: owed.map((i) => i.id), total },
    dedupeKey: `pay-link:${client.id}`,
  }, service);
  await service.from("activity_log").insert({
    client_id: client.id, action_type: "pay_link_drafted", entity_type: "client", entity_id: client.id,
    description: `Pay-link email written for approval: ${money(total)} across ${owed.length} invoice${owed.length === 1 ? "" : "s"}.`,
    metadata: { by: req.requested_by, invoices: owed.map((i) => i.id) },
  });
  return { total, invoices: owed.length };
}

const HANDLERS: Record<string, (service: SupabaseClient, req: StaffRequest) => Promise<unknown>> = {
  billing_refresh: (service, req) => syncInvoices(service, req.client_id),
  pay_link_email: payLinkEmail,
};

/** Runs every pending request once. A failure is written on the request for GoldenDesk to show. */
export async function processStaffRequests(service: SupabaseClient = serviceClient()) {
  const { data, error } = await service.from("staff_requests").select("id,client_id,kind,payload,requested_by")
    .eq("status", "pending").in("kind", Object.keys(HANDLERS)).order("created_at", { ascending: true }).limit(10);
  if (error) throw new Error(error.message);
  const done: Array<{ id: string; kind: string; ok: boolean }> = [];
  for (const req of (data ?? []) as StaffRequest[]) {
    const claimed = await service.from("staff_requests").update({ status: "running", started_at: new Date().toISOString() }).eq("id", req.id).eq("status", "pending").select("id");
    if (!claimed.data?.length) continue;
    try {
      const result = await HANDLERS[req.kind](service, req);
      await service.from("staff_requests").update({ status: "done", result: result ?? {}, finished_at: new Date().toISOString() }).eq("id", req.id);
      done.push({ id: req.id, kind: req.kind, ok: true });
    } catch (e) {
      await service.from("staff_requests").update({ status: "failed", error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() }).eq("id", req.id);
      done.push({ id: req.id, kind: req.kind, ok: false });
    }
  }
  return done;
}
