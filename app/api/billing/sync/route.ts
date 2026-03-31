import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/client";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { session_id } = await request.json();
    if (!session_id) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 400 });
    }

    const clientId = session.metadata?.client_id;
    const tier = session.metadata?.tier ?? "monitor";
    const subscriptionId = session.subscription as string;
    const customerId = session.customer as string;

    if (!clientId) {
      return NextResponse.json({ error: "No client_id in session metadata" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: subError } = await supabase
      .from("subscriptions")
      .upsert(
        {
          client_id: clientId,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          status: "active",
          tier,
          mrr: (session.amount_total ?? 0) / 100,
        },
        { onConflict: "client_id" }
      );

    if (subError) {
      console.error("Subscription sync error:", subError);
      return NextResponse.json({ error: subError.message }, { status: 500 });
    }

    await supabase
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId);

    return NextResponse.json({ success: true, tier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Billing sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
