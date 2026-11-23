import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { appUrl } from "@/lib/autopilot/intake";
import { isSubscriptionTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

const PRICE_ENV = {
  monitor: "STRIPE_PRICE_MONITOR",
  remediate: "STRIPE_PRICE_REMEDIATE",
  total_safety: "STRIPE_PRICE_TOTAL_SAFETY",
} as const;

function price(name: string) {
  const value = process.env[name]?.trim();
  if (!value?.startsWith("price_")) throw new Error(`Checkout is not set up yet (${name}). Reply to our email and we will start your service.`);
  return value;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    if (client.status === "active") return NextResponse.json({ error: "Your service is already active." }, { status: 409 });
    if (client.service_agreement_accepted !== true) return NextResponse.json({ error: "Please sign the agreement above first." }, { status: 409 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const tier = body.tier;
    if (!isSubscriptionTier(tier)) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
    // QF-215: sign and pay first. Driver count and phone come from the confirmed details; the
    // questions about how the carrier runs are homework after payment.
    const driverCount = Number(body.driverCount ?? client.driver_count);
    if (!Number.isInteger(driverCount) || driverCount < 1 || driverCount > 5000) return NextResponse.json({ error: "Enter how many drivers you have (step 1)." }, { status: 400 });
    const phone = cleanString(body.phone, 40) || cleanString(client.phone, 40);
    if (phone.replace(/\D/g, "").length < 10) return NextResponse.json({ error: "Enter a phone number (step 1)." }, { status: 400 });

    const service = serviceClient();
    const { error: updateError } = await service
      .from("clients")
      .update({
        tier,
        status: client.status === "prospect" ? "onboarding" : client.status,
        driver_count: driverCount,
        phone,
      })
      .eq("id", client.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const lineItems: Stripe.Checkout.SessionCreateParams["line_items"] = [{ price: price(PRICE_ENV[tier]), quantity: 1 }];
    if (tier === "total_safety") lineItems.push({ price: price("STRIPE_PRICE_DRIVER_ADDON"), quantity: driverCount });
    // QF-221: sign-up happens inside the carrier's account, so payment returns there.
    const back = `${appUrl()}/onboarding`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      success_url: `${back}?started=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}`,
      customer_email: client.email ?? undefined,
      metadata: { client_id: client.id, tier, source: "plan_link" },
      subscription_data: { metadata: { client_id: client.id, tier } },
    });
    if (!session.url) return NextResponse.json({ error: "Checkout could not start. Please try again." }, { status: 502 });
    await logPlanEvent(client.id, "plan_checkout_started", `Carrier started checkout for ${tier}`, { tier, driverCount });
    return NextResponse.json({ url: session.url });
  });
}
