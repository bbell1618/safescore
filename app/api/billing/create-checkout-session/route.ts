import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import Stripe from "stripe";
import { isClientPostOnboardingLifecycle } from "@/lib/auth/access";
import { isSubscriptionTier } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";
import { missingOnboardingProfileFields } from "@/lib/onboarding/completeness";

const TIER_PRICE_ENV: Record<
  Exclude<ClientTier, "assessment">,
  "STRIPE_PRICE_MONITOR" | "STRIPE_PRICE_REMEDIATE" | "STRIPE_PRICE_TOTAL_SAFETY"
> = {
  monitor: "STRIPE_PRICE_MONITOR",
  remediate: "STRIPE_PRICE_REMEDIATE",
  total_safety: "STRIPE_PRICE_TOTAL_SAFETY",
};

function configuredPrice(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !value.startsWith("price_")) {
    throw new Error(`${name} is not configured with a Stripe price ID`);
  }
  return value;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { tier?: unknown }
    | null;
  if (!body || !isSubscriptionTier(body.tier)) {
    return NextResponse.json(
      {
        error: "Choose a recurring SafeScore service tier before checkout.",
        code: "INVALID_SUBSCRIPTION_TIER",
      },
      { status: 400 }
    );
  }
  const tier = body.tier;

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
    .select(
      "name, driver_count, status, tier, service_agreement_accepted, primary_contact, phone, vehicle_types, operating_states, operating_radius, citation_dismissed_last_24_months"
    )
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

  if (client.status !== "onboarding" && client.status !== "prospect") {
    return NextResponse.json(
      {
        error: "Checkout is unavailable from the current onboarding state.",
        code: "ONBOARDING_LOCKED",
      },
      { status: 409 }
    );
  }
  if (!client.tier) {
    return NextResponse.json(
      {
        error: "GEIA must assign a service tier before checkout.",
        code: "CLIENT_TIER_REQUIRED",
      },
      { status: 409 }
    );
  }
  if (client.tier !== tier) {
    return NextResponse.json(
      {
        error:
          "The checkout tier does not match your confirmed service tier. Return to Step 4 and confirm the service option again.",
        code: "TIER_MISMATCH",
      },
      { status: 409 }
    );
  }
  if (
    (!Number.isInteger(client.driver_count) || (client.driver_count ?? 0) < 1)
  ) {
    return NextResponse.json(
      {
        error:
          "Enter a billing driver count of at least 1 before checkout.",
        code: "DRIVER_COUNT_REQUIRED",
      },
      { status: 409 }
    );
  }

  const missingProfileFields = missingOnboardingProfileFields(client);
  if (missingProfileFields.length > 0) {
    return NextResponse.json(
      {
        error: `Complete onboarding before checkout. Still needed: ${missingProfileFields.join(", ")}.`,
        code: "ONBOARDING_PROFILE_INCOMPLETE",
        missingFields: missingProfileFields,
      },
      { status: 409 }
    );
  }

  let tierPrice: string;
  let driverAddonPrice: string | null = null;
  try {
    tierPrice = configuredPrice(TIER_PRICE_ENV[tier]);
    driverAddonPrice =
      tier === "total_safety"
        ? configuredPrice("STRIPE_PRICE_DRIVER_ADDON")
        : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe pricing is not configured";
    return NextResponse.json(
      { error: message, code: "STRIPE_PRICE_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  const lineItems: Stripe.Checkout.SessionCreateParams["line_items"] = [
    {
      price: tierPrice,
      quantity: 1,
    },
  ];

  // Total Safety tier adds a per-driver line item
  if (tier === "total_safety" && driverAddonPrice && client.driver_count) {
    lineItems.push({
      price: driverAddonPrice,
      quantity: client.driver_count,
    });
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
    if (!appUrl) {
      throw new Error("NEXT_PUBLIC_APP_URL is not configured");
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      success_url: `${appUrl}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/onboarding`,
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
    if (!session.url) {
      throw new Error("Stripe created a checkout session without a redirect URL");
    }

    return NextResponse.json({ url: session.url, tier });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe checkout failure";
    return NextResponse.json(
      { error: message, code: "STRIPE_CHECKOUT_FAILED" },
      { status: 502 }
    );
  }
}
