import type { ClientTier } from "@/lib/supabase/types";

export const CLIENT_TIERS = [
  "assessment",
  "monitor",
  "remediate",
  "total_safety",
] as const satisfies readonly ClientTier[];

export type TierFeature =
  | "monitoring_alerts"
  | "monthly_reports"
  | "trend_history"
  | "case_visibility"
  | "evidence_requests"
  | "playbook_coach"
  | "compliance_layer"
  | "truth_up_service";

export const TIER_FEATURES = {
  monitoring_alerts: "monitor",
  monthly_reports: "monitor",
  trend_history: "monitor",
  case_visibility: "remediate",
  evidence_requests: "remediate",
  playbook_coach: "remediate",
  compliance_layer: "total_safety",
  truth_up_service: "monitor",
} as const satisfies Record<TierFeature, ClientTier>;

export const SUBSCRIPTION_TIERS = [
  "monitor",
  "remediate",
  "total_safety",
] as const satisfies readonly ClientTier[];

export const TIER_LABELS: Record<ClientTier, string> = {
  assessment: "Assessment",
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
};

const TIER_RANK: Record<ClientTier, number> = {
  assessment: 0,
  monitor: 1,
  remediate: 2,
  total_safety: 3,
};

export function isClientTier(value: unknown): value is ClientTier {
  return typeof value === "string" && (CLIENT_TIERS as readonly string[]).includes(value);
}

export function isSubscriptionTier(
  value: unknown
): value is (typeof SUBSCRIPTION_TIERS)[number] {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_TIERS as readonly string[]).includes(value)
  );
}

/** Unknown or unassigned tiers fail closed to the lowest entitlement. */
export function normalizeClientTier(value: unknown): ClientTier {
  return isClientTier(value) ? value : "assessment";
}

export function tierHasFeature(
  tier: ClientTier | string | null | undefined,
  feature: TierFeature
): boolean {
  return TIER_RANK[normalizeClientTier(tier)] >= TIER_RANK[TIER_FEATURES[feature]];
}

export function minimumTierForFeature(feature: TierFeature): ClientTier {
  return TIER_FEATURES[feature];
}

export function tierBadgeVariant(
  tier: ClientTier | string | null | undefined
): "gold" | "info" | "default" | "outline" {
  const normalized = normalizeClientTier(tier);
  if (normalized === "total_safety") return "gold";
  if (normalized === "remediate") return "info";
  if (normalized === "assessment") return "outline";
  return "default";
}
