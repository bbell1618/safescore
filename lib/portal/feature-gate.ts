import type { ClientTier } from "@/lib/supabase/types";
import { tierHasFeature, type TierFeature } from "@/lib/tiers";

export type PortalFeatureGate = {
  tier: ClientTier;
  feature: TierFeature;
  allowed: boolean;
};

/** Pure entitlement decision used by the server page and API guards. */
export function evaluatePortalFeatureGate(
  tier: ClientTier,
  feature: TierFeature
): PortalFeatureGate {
  return {
    tier,
    feature,
    allowed: tierHasFeature(tier, feature),
  };
}
