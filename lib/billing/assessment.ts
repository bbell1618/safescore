import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { OnboardingRouteFailure, transitionFailure } from "@/lib/onboarding/server";

export type AssessmentBilling = {
  geia_insured: boolean;
  waived_by: string | null;
  waived_at: string | null;
  paid_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_livemode: boolean | null;
};

export function assessmentPriceId() {
  const price = process.env.STRIPE_PRICE_ASSESSMENT?.trim();
  return price?.startsWith("price_") ? price : null;
}

export async function getAssessmentBilling(service: SupabaseClient, clientId: string): Promise<AssessmentBilling | null> {
  const { data, error } = await service.from("assessment_billing")
    .select("geia_insured, waived_by, waived_at, paid_at, stripe_checkout_session_id, stripe_livemode")
    .eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(`Unable to load Assessment billing: ${error.message}`);
  return data;
}

export function assessmentCovered(billing: AssessmentBilling | null) {
  return Boolean(billing?.paid_at || (billing?.geia_insured && billing.waived_by && billing.waived_at));
}

export async function requireAssessmentCovered(service: SupabaseClient, clientId: string) {
  if (!assessmentCovered(await getAssessmentBilling(service, clientId))) {
    throw new OnboardingRouteFailure("Pay the $299 Assessment fee or ask GEIA to record an insured-client waiver before activation.", 409, "ASSESSMENT_PAYMENT_REQUIRED");
  }
}

// Called only after Stripe signature verification or server-side session retrieval.
export async function recordPaidAssessment(service: SupabaseClient, session: Stripe.Checkout.Session) {
  const clientId = session.metadata?.client_id;
  const userId = session.metadata?.user_id;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid" || session.metadata?.tier !== "assessment" || session.amount_total !== 29900 || session.currency !== "usd" || !clientId || !uuid.test(clientId) || !userId || !uuid.test(userId)) {
    throw new OnboardingRouteFailure("Assessment checkout is not a complete, paid $299 USD payment with valid account metadata.", 409, "ASSESSMENT_PAYMENT_INVALID");
  }
  const { data: caller, error: callerError } = await service.from("users").select("client_id, role").eq("id", userId).single();
  if (callerError) throw new Error(`Unable to verify Assessment purchaser: ${callerError.message}`);
  if (caller?.role !== "client_user" || caller.client_id !== clientId) throw new Error("Assessment purchaser does not belong to the client");
  const { data: client, error: clientError } = await service.from("clients").select("tier").eq("id", clientId).single();
  if (clientError) throw new Error(`Unable to verify Assessment client: ${clientError.message}`);
  if (client?.tier !== "assessment") throw new Error("Assessment payment client has a different service tier");
  const existing = await getAssessmentBilling(service, clientId);
  if (existing?.stripe_checkout_session_id && existing.stripe_checkout_session_id !== session.id) throw new Error("A different Assessment payment is already recorded for this client");
  if (!existing?.paid_at) {
    const receipt = { paid_at: new Date().toISOString(), stripe_checkout_session_id: session.id, stripe_livemode: session.livemode };
    const result = existing
      ? await service.from("assessment_billing").update(receipt).eq("client_id", clientId).is("paid_at", null)
      : await service.from("assessment_billing").insert({ client_id: clientId, ...receipt });
    if (result.error) {
      const retry = await getAssessmentBilling(service, clientId);
      if (retry?.stripe_checkout_session_id !== session.id) throw new Error(`Unable to record Assessment payment: ${result.error.message}`);
    }
  }
  const recorded = await getAssessmentBilling(service, clientId);
  if (!recorded?.paid_at || recorded.stripe_checkout_session_id !== session.id) throw new Error("Assessment payment changed concurrently; receipt was not recorded for this checkout");
  const { data, error } = await service.rpc("submit_assessment_activation_v1", { p_client_id: clientId, p_user_id: userId }).single();
  if (error || !data) throw transitionFailure(error, "Paid Assessment activation was not submitted");
  return { status: (data as { result_status: string }).result_status, tier: "assessment", alreadyActive: false, nextPath: "/onboarding" };
}
