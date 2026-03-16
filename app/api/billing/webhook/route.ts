import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;

  if (secret) {
    // Production: verify webhook signature
    try {
      event = stripe.webhooks.constructEvent(body, sig!, secret);
    } catch (err: any) {
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${err.message}` },
        { status: 400 }
      );
    }
  } else {
    // Development: parse JSON directly (no signature check)
    try {
      event = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const supabase = await createServiceClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as any;
      const clientId = session.metadata?.client_id;
      const subscriptionId = session.subscription;
      const customerId = session.customer;

      if (clientId) {
        // Upsert subscription record
        await (supabase as any)
          .from("subscriptions")
          .upsert(
            {
              client_id: clientId,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              status: "active",
              tier: "tier_1",
              mrr: 299,
            },
            { onConflict: "client_id" }
          );

        // Update client status to active
        await (supabase as any)
          .from("clients")
          .update({ status: "active" })
          .eq("id", clientId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as any;

      await (supabase as any)
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", subscription.id);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as any;
      const customerId = invoice.customer;

      await (supabase as any)
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_customer_id", customerId);
      break;
    }

    default:
      // Unhandled event type — ignore
      break;
  }

  return NextResponse.json({ received: true });
}
