import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/client";
import { renderAutopilotEmail } from "@/lib/email/client";
import { appBase } from "@/lib/autopilot/account-invite";
import { firstName } from "@/lib/autopilot/onboarding-reminder-plan";
import { enqueueCard, serviceClient, supersedeCards } from "@/lib/autopilot/queue";
import { PER_DRIVER, TOTAL_SAFETY_BASE, priceChange, type PriceChange } from "./driver-pricing-math";

export { priceChange, type PriceChange } from "./driver-pricing-math";

/**
 * QF-227 (Brandon, 11/24/2026): Total Safety is $999 a month plus $29 per driver. When the driver
 * list a carrier confirms does not match what they are billed for, they agree to the new price
 * first, and the subscription really changes (Stripe quantity, prorated). If the list changes from
 * the agency side, the carrier gets an email (approval card first) asking them to confirm.
 */

export async function activeDriverCount(service: SupabaseClient, clientId: string): Promise<number> {
  const { count } = await service.from("drivers").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "active");
  return count ?? 0;
}

/** Charges the subscription for `count` drivers from now on. */
export async function applyBilledDriverCount(service: SupabaseClient, clientId: string, count: number, actor: string): Promise<{ ok: true; change: PriceChange | null } | { ok: false; error: string }> {
  const { data: client } = await service.from("clients").select("id, tier, status, billed_driver_count").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Carrier not found." };
  const change = priceChange(client.tier, client.billed_driver_count, count);
  if (client.tier !== "total_safety" || client.status !== "active") {
    await service.from("clients").update({ driver_count: count }).eq("id", clientId);
    return { ok: true, change: null };
  }
  if (!change) {
    await service.from("clients").update({ driver_count: count, billed_driver_count: count, price_confirm_card_count: null }).eq("id", clientId);
    return { ok: true, change: null };
  }
  const { data: sub } = await service.from("subscriptions").select("id, stripe_subscription_id").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const addonPrice = process.env.STRIPE_PRICE_DRIVER_ADDON?.trim();
  if (!sub?.stripe_subscription_id || !addonPrice) return { ok: false, error: "Billing is not set up for this account yet. We will contact you." };
  try {
    const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, { expand: ["items"] });
    const item = subscription.items.data.find((i) => i.price.id === addonPrice);
    if (item) {
      await stripe.subscriptionItems.update(item.id, { quantity: count, proration_behavior: "create_prorations" });
    } else {
      await stripe.subscriptionItems.create({ subscription: subscription.id, price: addonPrice, quantity: count, proration_behavior: "create_prorations" });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await service.from("activity_log").insert({
      client_id: clientId, action_type: "billing_update_failed", entity_type: "client", entity_id: clientId,
      description: `Could not change the monthly charge to ${count} drivers: ${message}`, metadata: { count, actor },
    });
    return { ok: false, error: "Your list is saved, but we could not update your monthly price. We will fix it and let you know." };
  }
  await service.from("subscriptions").update({ mrr: TOTAL_SAFETY_BASE + PER_DRIVER * count }).eq("id", sub.id);
  await service.from("clients").update({ driver_count: count, billed_driver_count: count, price_confirm_card_count: null }).eq("id", clientId);
  await service.from("activity_log").insert({
    client_id: clientId, action_type: "billing_driver_count_changed", entity_type: "client", entity_id: clientId,
    description: `Carrier agreed to the new monthly price: ${change.from} to ${change.to} drivers, $${change.fromMonthly.toLocaleString()} to $${change.toMonthly.toLocaleString()} a month (${actor})`,
    metadata: { ...change, actor },
  });
  return { ok: true, change };
}

function priceEmail(contactName: string | null, change: PriceChange) {
  const first = firstName(contactName);
  const body = [
    first ? `Hi ${first},` : "Hello,",
    `This is Sunny, the AI assistant at Golden Era Insurance Agency. Your driver list was updated, so your SafeScore price needs your OK. Use the button below to sign in and confirm it.`,
    `Drivers: ${change.from} before, ${change.to} now.\nMonthly price: $${change.fromMonthly.toLocaleString()} before, $${change.toMonthly.toLocaleString()} now ($${TOTAL_SAFETY_BASE} plus $${PER_DRIVER} per driver).`,
    "If the new list is wrong, you can fix it on the same page before you confirm. Nothing changes on your bill until you confirm.",
    "Reply to this email with any question.",
  ].join("\n\n");
  return { subject: "Please confirm your SafeScore driver count", body };
}

/**
 * Every minute: a paid Total Safety carrier whose active driver list no longer matches what they
 * are billed for (a change made from the agency side) gets one approval card asking them to confirm.
 */
export async function processDriverPriceChecks(service: SupabaseClient = serviceClient(), limit = 25) {
  const { data: clients, error } = await service
    .from("clients")
    .select("id, name, email, primary_contact, is_practice, tier, billed_driver_count, price_confirm_card_count")
    .eq("status", "active").eq("tier", "total_safety").not("billed_driver_count", "is", null)
    .limit(limit);
  if (error) throw new Error(`driver price checks: ${error.message}`);
  const out: Array<{ client: string; from: number; to: number }> = [];
  for (const client of clients ?? []) {
    const active = await activeDriverCount(service, client.id);
    const change = priceChange(client.tier, client.billed_driver_count, active);
    if (!change || client.price_confirm_card_count === active || !client.email) continue;
    const email = priceEmail(client.primary_contact, change);
    const cta = { label: "Sign in to confirm", href: `${appBase()}/login`, position: "top" };
    await supersedeCards(`driver-price:${client.id}`, service);
    await enqueueCard({
      clientId: client.id,
      kind: "email",
      template: "autopilot_driver_price_confirm",
      title: `${client.is_practice ? "PRACTICE: " : ""}Ask ${client.name} to confirm ${change.to} drivers and the new price`,
      why: `Their driver list changed from ${change.from} to ${change.to}. The monthly price changes from $${change.fromMonthly.toLocaleString()} to $${change.toMonthly.toLocaleString()} once they confirm.`
        + (client.is_practice ? " Practice copy: this goes only to you." : ""),
      toAddress: client.email,
      cc: null,
      subject: email.subject,
      bodyText: email.body,
      bodyHtml: renderAutopilotEmail({ bodyText: email.body, cta }),
      editable: true,
      payload: { cta, change },
      dedupeKey: `driver-price:${client.id}:${active}:${Date.now()}`,
    }, service);
    await service.from("clients").update({ price_confirm_card_count: active }).eq("id", client.id);
    await service.from("activity_log").insert({
      client_id: client.id, action_type: "driver_price_confirm_drafted", entity_type: "client", entity_id: client.id,
      description: `Price confirmation email written for approval: ${change.from} to ${change.to} drivers.`, metadata: change,
    });
    out.push({ client: client.name, from: change.from, to: change.to });
  }
  return out;
}
