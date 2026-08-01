import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { isSubscriptionTier } from "@/lib/tiers";
import { activatePaidSubscription } from "@/lib/billing/activation";
import { OnboardingRouteFailure } from "@/lib/onboarding/server";

export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();
    if (authError) {
      return NextResponse.json(
        { error: `Unable to verify session: ${authError.message}` },
        { status: 401 }
      );
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { session_id: sessionId } = await request
      .json()
      .catch(() => ({ session_id: null }));
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return NextResponse.json(
        { error: "session_id required" },
        { status: 400 }
      );
    }

    const service = await createServiceClient();
    const { data: caller, error: callerError } = await service
      .from("users")
      .select("client_id, role")
      .eq("id", user.id)
      .single();
    if (callerError) {
      return NextResponse.json(
        { error: `Unable to load portal account: ${callerError.message}` },
        { status: 500 }
      );
    }
    if (caller.role !== "client_user" || !caller.client_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (
      session.mode !== "subscription" ||
      session.status !== "complete" ||
      session.payment_status !== "paid"
    ) {
      return NextResponse.json(
        {
          error: "The Stripe subscription checkout is not complete and paid.",
          code: "PAYMENT_NOT_COMPLETED",
        },
        { status: 400 }
      );
    }

    const metadataClientId = session.metadata?.client_id;
    const tier = session.metadata?.tier;
    if (!metadataClientId) {
      return NextResponse.json(
        { error: "No client_id in session metadata" },
        { status: 400 }
      );
    }
    if (metadataClientId !== caller.client_id) {
      return NextResponse.json(
        { error: "Checkout session does not belong to this portal account" },
        { status: 403 }
      );
    }
    if (!isSubscriptionTier(tier)) {
      return NextResponse.json(
        { error: "Checkout session has an invalid subscription tier" },
        { status: 400 }
      );
    }

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
    if (!subscriptionId || !customerId) {
      return NextResponse.json(
        { error: "Checkout session is missing subscription or customer data" },
        { status: 400 }
      );
    }

    const activated = await activatePaidSubscription(service, {
      clientId: caller.client_id,
      tier,
      subscriptionId,
      customerId,
      mrr: (session.amount_total ?? 0) / 100,
      source: "billing_sync",
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      tier: activated.tier,
      status: activated.status,
      alreadyActive: activated.alreadyActive,
    });
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Billing sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
