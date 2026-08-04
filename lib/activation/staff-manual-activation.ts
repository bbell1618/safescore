import type { ClientStatus, ClientTier } from "@/lib/supabase/types";
import { isSubscriptionTier } from "@/lib/tiers";

export type SubscriptionTier = Exclude<ClientTier, "assessment">;

const SUBSCRIPTION_BASE_MRR: Record<SubscriptionTier, number> = {
  monitor: 199,
  remediate: 599,
  total_safety: 999,
};

const TOTAL_SAFETY_DRIVER_MRR = 29;

/**
 * Calculates the same monthly amount shown during onboarding. The operational
 * driver roster is intentionally not an input: clients.driver_count remains
 * the sole billing count.
 */
export function subscriptionMrr(
  tier: SubscriptionTier,
  driverCount: number | null
): number {
  if (tier !== "total_safety") return SUBSCRIPTION_BASE_MRR[tier];
  if (!Number.isInteger(driverCount) || (driverCount ?? 0) < 1) {
    throw new Error(
      "Total Safety activation requires a billing driver count of at least 1."
    );
  }
  return SUBSCRIPTION_BASE_MRR.total_safety + driverCount! * TOTAL_SAFETY_DRIVER_MRR;
}

/**
 * Controls only whether the console offers the staff activation action. The
 * server repeats all lifecycle and onboarding-completeness checks.
 */
export function isStaffManualActivationCandidate(input: {
  tier: ClientTier | string | null;
  status: ClientStatus | string | null;
  serviceAgreementAccepted: boolean | null;
}): boolean {
  if (input.tier === "assessment") {
    return input.status === "awaiting_activation";
  }
  return (
    isSubscriptionTier(input.tier) &&
    (input.status === "onboarding" || input.status === "prospect") &&
    input.serviceAgreementAccepted === true
  );
}
