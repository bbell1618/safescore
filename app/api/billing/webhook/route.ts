import { activatePaidSubscription } from "@/lib/billing/activation";
import { OnboardingRouteFailure } from "@/lib/onboarding/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isSubscriptionTier } from "@/lib/tiers";
import { stripe } from "@/lib/stripe/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const maxDuration = 300;

function stripeId(value: string | { id: string } | null): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof value.id === "string" &&
    value.id.trim()
  ) {
    return value.id;
  }
  return null;
}

async function activateCheckoutSession(
  session: Stripe.Checkout.Session,
  source: "stripe_webhook"
) {
  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    return { activated: false as const, reason: "checkout_not_paid" };
  }

  const clientId = session.metadata?.client_id?.trim();
  const tier = session.metadata?.tier;
  const subscriptionId = stripeId(session.subscription);
  const customerId = stripeId(session.customer);
  if (!clientId) {
    throw new Error("Stripe checkout metadata is missing client_id");
  }
  if (!isSubscriptionTier(tier)) {
    throw new Error("Stripe checkout metadata has an invalid subscription tier");
  }
  if (!subscriptionId || !customerId) {
    throw new Error("Stripe checkout is missing subscription or customer data");
  }

  const service = await createServiceClient();
  const activated = await activatePaidSubscription(service, {
    clientId,
    tier,
    subscriptionId,
    customerId,
    mrr: (session.amount_total ?? 0) / 100,
    source,
  });
  return { activated: true as const, ...activated };
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      {
        error: "STRIPE_WEBHOOK_SECRET is not configured",
        code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  if (!signature) {
    return NextResponse.json(
      { error: "Stripe signature is required", code: "STRIPE_SIGNATURE_REQUIRED" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown signature failure";
    return NextResponse.json(
      {
        error: `Webhook signature verification failed: ${message}`,
        code: "STRIPE_SIGNATURE_INVALID",
      },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const activation = await activateCheckoutSession(
          event.data.object as Stripe.Checkout.Session,
          "stripe_webhook"
        );
        return NextResponse.json({ received: true, activation });
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const service = await createServiceClient();
        const { error } = await service
          .from("subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", subscription.id);
        if (error) {
          throw new Error(`Unable to record canceled subscription: ${error.message}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = stripeId(invoice.customer);
        if (!customerId) {
          throw new Error("Failed invoice is missing its Stripe customer ID");
        }
        const service = await createServiceClient();
        const { error } = await service
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_customer_id", customerId);
        if (error) {
          throw new Error(`Unable to record failed subscription payment: ${error.message}`);
        }
        break;
      }

      default:
        break;
    }
  } catch (error) {
    if (error instanceof OnboardingRouteFailure) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status >= 500 ? error.status : 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown Stripe webhook failure";
    return NextResponse.json(
      { error: message, code: "STRIPE_WEBHOOK_PROCESSING_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
