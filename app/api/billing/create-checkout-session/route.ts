import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import Stripe from "stripe";
import { isClientPostOnboardingLifecycle } from "@/lib/auth/access";

const TIER_PRICE_MAP: Record<string, string> = {
  monitor: process.env.STRIPE_PRICE_MONITOR ?? "STRIPE_PRICE_MONITOR_PLACEHOLDER",
  remediate: process.env.STRIPE_PRICE_REMEDIATE ?? "STRIPE_PRICE_REMEDIATE_PLACEHOLDER",
  total_safety: process.env.STRIPE_PRICE_TOTAL_SAFETY ?? "STRIPE_PRICE_TOTAL_SAFETY_PLACEHOLDER",
};

const DRIVER_ADDON_PRICE = process.env.STRIPE_PRICE_DRIVER_ADDON ?? "STRIPE_PRICE_DRIVER_ADDON_PLACEHOLDER";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tier: string = body.tier ?? "monitor";

  if (!TIER_PRICE_MAP[tier]) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const { data: userRecord, error: userRecordError } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (userRecordError) {
    return NextResponse.json(
      { error: userRecordError.message },
      { status: 500 }
    );
  }

  if (!userRecord?.client_id) {
    return NextResponse.json(
      { error: "No client associated with this account" },
      { status: 400 }
    );
  }

  const clientId = userRecord.client_id;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("name, driver_count, status")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    return NextResponse.json(
      { error: clientError?.message ?? "Client record not found" },
      { status: 500 }
    );
  }

  if (isClientPostOnboardingLifecycle(client)) {
    return NextResponse.json(
      {
        error:
          "This carrier has already completed onboarding. A second checkout cannot be created.",
        code: "ONBOARDING_LOCKED",
      },
      { status: 409 }
    );
  }

  const lineItems: Stripe.Checkout.SessionCreateParams["line_items"] = [
    {
      price: TIER_PRICE_MAP[tier],
      quantity: 1,
    },
  ];

  // Total Safety tier adds a per-driver line item
  if (tier === "total_safety" && client?.driver_count && client.driver_count > 0) {
    lineItems.push({
      price: DRIVER_ADDON_PRICE,
      quantity: client.driver_count,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: lineItems,
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding`,
    customer_email: user.email,
    metadata: {
      client_id: clientId,
      user_id: user.id,
      tier,
    },
    subscription_data: {
      metadata: {
        client_id: clientId,
        tier,
      },
    },
  });

  return NextResponse.json({ url: session.url });
}
