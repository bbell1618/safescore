import { LockKeyhole } from "lucide-react";
import {
  minimumTierForFeature,
  TIER_LABELS,
  type TierFeature,
} from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";

export function TierUpgradeNote({
  feature,
  currentTier,
  title,
}: {
  feature: TierFeature;
  currentTier: ClientTier;
  title: string;
}) {
  const minimumTier = minimumTierForFeature(feature);
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center">
      <div className="w-full rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#FDF4E7]">
          <LockKeyhole className="h-5 w-5 text-[#C67A1E]" />
        </div>
        <h1 className="text-lg font-bold text-[#1E1C1A]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          This feature is included with {TIER_LABELS[minimumTier]} and higher plans.
          Your current plan is {TIER_LABELS[currentTier]}.
        </p>
        <p className="mt-3 text-xs text-gray-500">
          Contact your Golden Era SafeScore team to discuss an upgrade.
        </p>
      </div>
    </div>
  );
}
