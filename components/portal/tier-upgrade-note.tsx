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
  headingLevel = "h1",
}: {
  feature: TierFeature;
  currentTier: ClientTier;
  title: string;
  headingLevel?: "h1" | "h2";
}) {
  const minimumTier = minimumTierForFeature(feature);
  const Heading = headingLevel;
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center">
      <div className="w-full rounded-xl border border-sand bg-warm-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber-subtle">
          <LockKeyhole className="h-5 w-5 text-amber" />
        </div>
        <Heading className="font-heading text-xl font-semibold tracking-tight text-warm-dark">
          {title}
        </Heading>
        <p className="mt-2 text-sm leading-6 text-warm-mid">
          This feature is included with {TIER_LABELS[minimumTier]} and higher plans.
          Your current plan is {TIER_LABELS[currentTier]}.
        </p>
        <p className="mt-3 text-xs text-warm-gray">
          Contact your Golden Era SafeScore team to discuss an upgrade.
        </p>
      </div>
    </div>
  );
}
