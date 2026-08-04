import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientTier } from "@/lib/supabase/types";
import { transitionFailure } from "@/lib/onboarding/server";
import { runPostActivationInitialization } from "@/lib/activation/post-activation-server";

export async function activatePaidSubscription(
  service: SupabaseClient,
  input: {
    clientId: string;
    tier: ClientTier;
    subscriptionId: string;
    customerId: string;
    mrr: number;
    source: "billing_sync" | "stripe_webhook";
    userId?: string | null;
  }
) {
  const { data, error } = await service
    .rpc("activate_paid_subscription_v1", {
      p_client_id: input.clientId,
      p_tier: input.tier,
      p_subscription_id: input.subscriptionId,
      p_customer_id: input.customerId,
      p_mrr: input.mrr,
      p_source: input.source,
      p_user_id: input.userId ?? null,
    })
    .single();
  if (error || !data) {
    throw transitionFailure(error, "Paid subscription activation failed");
  }
  const result = data as {
    result_status: string;
    result_tier: string;
    already_active: boolean;
  };
  const initialization = await runPostActivationInitialization(service, {
    clientId: input.clientId,
    tier: input.tier,
    source: input.source,
    newlyActivated: result.already_active !== true,
    actorUserId: input.userId ?? null,
  });
  if (initialization.status === "in_progress") {
    throw new Error(
      "Activation initialization is still running. Retry after it finishes."
    );
  }

  return {
    status: String(result.result_status),
    tier: String(result.result_tier) as ClientTier,
    alreadyActive: result.already_active === true,
    initialization,
  };
}
