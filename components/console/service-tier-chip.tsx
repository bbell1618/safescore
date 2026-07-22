import { Badge } from "@/components/ui/badge";
import {
  minimumTierForFeature,
  tierHasFeature,
  TIER_LABELS,
  type TierFeature,
} from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";

export function ServiceTierChip({
  tier,
  feature,
  compact = false,
}: {
  tier: ClientTier;
  feature: TierFeature;
  compact?: boolean;
}) {
  if (tierHasFeature(tier, feature)) return null;
  const minimumTier = minimumTierForFeature(feature);
  return (
    <Badge
      variant="warning"
      className={compact ? "px-1.5 py-0 text-[9px]" : undefined}
    >
      <span title={`Available from ${TIER_LABELS[minimumTier]}`}>Not in tier</span>
    </Badge>
  );
}
