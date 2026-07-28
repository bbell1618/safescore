import { NextResponse } from "next/server";
import { isClientPostOnboardingLifecycle } from "@/lib/auth/access";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { isSubscriptionTier } from "@/lib/tiers";

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
    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed" },
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

    const { data: client, error: clientError } = await service
      .from("clients")
      .select("status")
      .eq("id", caller.client_id)
      .single();
    if (clientError || !client) {
      return NextResponse.json(
        { error: clientError?.message ?? "Client record not found" },
        { status: 500 }
      );
    }
    if (client.status === "active") {
      return NextResponse.json({
        success: true,
        tier,
        alreadyActive: true,
      });
    }
    if (isClientPostOnboardingLifecycle(client)) {
      return NextResponse.json(
        {
          error:
            "This carrier has already completed onboarding and cannot be reactivated through checkout sync.",
          code: "ONBOARDING_LOCKED",
        },
        { status: 409 }
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

    const { error: subscriptionError } = await service
      .from("subscriptions")
      .upsert(
        {
          client_id: caller.client_id,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          status: "active",
          tier,
          mrr: (session.amount_total ?? 0) / 100,
        },
        { onConflict: "client_id" }
      );
    if (subscriptionError) {
      return NextResponse.json(
        { error: subscriptionError.message },
        { status: 500 }
      );
    }

    const { data: activatedClient, error: activationError } = await service
      .from("clients")
      .update({ status: "active" })
      .eq("id", caller.client_id)
      .in("status", ["onboarding", "prospect"])
      .select("id, status")
      .maybeSingle();
    if (activationError) {
      return NextResponse.json(
        { error: activationError.message },
        { status: 500 }
      );
    }
    if (!activatedClient || activatedClient.status !== "active") {
      return NextResponse.json(
        {
          error:
            "Subscription was recorded, but the client could not be activated from its current lifecycle state.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, tier, alreadyActive: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Billing sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
