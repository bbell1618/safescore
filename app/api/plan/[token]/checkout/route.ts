import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { appUrl } from "@/lib/autopilot/intake";
import { PLAN_RADIUS, PLAN_VEHICLE_TYPES, US_STATES } from "@/lib/autopilot/plan-options";
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
    const driverCount = Number(body.driverCount);
    if (!Number.isInteger(driverCount) || driverCount < 1 || driverCount > 5000) return NextResponse.json({ error: "Enter how many drivers you have." }, { status: 400 });
    const phone = cleanString(body.phone, 40);
    if (phone.replace(/\D/g, "").length < 10) return NextResponse.json({ error: "Enter a phone number." }, { status: 400 });
    const radius = PLAN_RADIUS.find((r) => r.value === body.operatingRadius)?.value;
    if (!radius) return NextResponse.json({ error: "Choose how far your trucks go." }, { status: 400 });
    const states = (Array.isArray(body.operatingStates) ? body.operatingStates : [])
      .map((s) => String(s).toUpperCase())
      .filter((s): s is (typeof US_STATES)[number] => (US_STATES as readonly string[]).includes(s));
    if (states.length === 0) return NextResponse.json({ error: "Choose at least one state you drive in." }, { status: 400 });
    const vehicles = (Array.isArray(body.vehicleTypes) ? body.vehicleTypes : [])
      .map(String)
      .filter((v) => (PLAN_VEHICLE_TYPES as readonly string[]).includes(v));
    if (vehicles.length === 0) return NextResponse.json({ error: "Choose at least one truck type." }, { status: 400 });
    if (typeof body.ticketAnswer !== "boolean") return NextResponse.json({ error: "Answer the ticket question." }, { status: 400 });

    const service = serviceClient();
    const { error: updateError } = await service
      .from("clients")
      .update({
        tier,
        status: client.status === "prospect" ? "onboarding" : client.status,
        driver_count: driverCount,
        phone,
        operating_radius: radius,
        operating_states: states,
        vehicle_types: vehicles,
        citation_dismissed_last_24_months: body.ticketAnswer,
      })
      .eq("id", client.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const lineItems: Stripe.Checkout.SessionCreateParams["line_items"] = [{ price: price(PRICE_ENV[tier]), quantity: 1 }];
    if (tier === "total_safety") lineItems.push({ price: price("STRIPE_PRICE_DRIVER_ADDON"), quantity: driverCount });
    const back = `${appUrl()}/plan/${(await params).token}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      success_url: `${back}?started=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}#start`,
      customer_email: client.email ?? undefined,
      metadata: { client_id: client.id, tier, source: "plan_link" },
      subscription_data: { metadata: { client_id: client.id, tier } },
    });
    if (!session.url) return NextResponse.json({ error: "Checkout could not start. Please try again." }, { status: 502 });
    await logPlanEvent(client.id, "plan_checkout_started", `Carrier started checkout for ${tier}`, { tier, driverCount });
    return NextResponse.json({ url: session.url });
  });
}
