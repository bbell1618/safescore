import "server-only";
import { stripe } from "@/lib/stripe/client";
import { activatePaidSubscription } from "@/lib/billing/activation";
import { isSubscriptionTier } from "@/lib/tiers";
import { serviceClient } from "./queue";

export type PlanCheckoutResult =
  | { status: "activated"; tier: string; alreadyActive: boolean }
  | { status: "not_paid" | "mismatch" }
  | { status: "error"; message: string };

function id(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

/**
 * Activates a carrier as soon as they land back on their plan page after a
 * paid Stripe checkout, so activation never depends on the webhook alone.
 * Idempotent: the activation function returns alreadyActive on repeats.
 */
export async function syncPlanCheckout(clientId: string, sessionId: string): Promise<PlanCheckoutResult> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return { status: "mismatch" };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.client_id !== clientId) return { status: "mismatch" };
    if (session.mode !== "subscription" || session.status !== "complete" || session.payment_status !== "paid") return { status: "not_paid" };
    const tier = session.metadata?.tier;
    const subscriptionId = id(session.subscription);
    const customerId = id(session.customer);
    if (!isSubscriptionTier(tier) || !subscriptionId || !customerId) return { status: "error", message: "Checkout is missing plan details." };
    const result = await activatePaidSubscription(serviceClient(), {
      clientId,
      tier,
      subscriptionId,
      customerId,
      mrr: (session.amount_total ?? 0) / 100,
      source: "billing_sync",
    });
    return { status: "activated", tier: result.tier, alreadyActive: result.alreadyActive };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
