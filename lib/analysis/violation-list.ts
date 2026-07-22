import type { ChallengeTier } from "@/lib/analysis/challengeability-v2";

export type ViolationTierFilter = "all" | ChallengeTier;

interface SearchableViolation {
  violation_code: string | null;
  violation_description: string | null;
  inspections?: {
    report_number?: string | null;
  } | null;
}

export function normalizeViolationCodeSearch(value: string): string {
  return value.replace(/[.\s]+/g, "").toUpperCase();
}

export function violationMatchesSearch(
  violation: SearchableViolation,
  searchText: string
): boolean {
  const query = searchText.trim();
  if (!query) return true;

  const normalizedCodeQuery = normalizeViolationCodeSearch(query);
  const normalizedViolationCode = normalizeViolationCodeSearch(
    violation.violation_code ?? ""
  );
  const textQuery = query.toLowerCase();

  return (
    (normalizedCodeQuery.length > 0 &&
      normalizedViolationCode.startsWith(normalizedCodeQuery)) ||
    (violation.violation_description ?? "").toLowerCase().includes(textQuery) ||
    (violation.inspections?.report_number ?? "").toLowerCase().includes(textQuery)
  );
}

export function countViolationTiers(
  tiers: readonly ChallengeTier[]
): Record<ViolationTierFilter, number> {
  const counts: Record<ViolationTierFilter, number> = {
    all: tiers.length,
    strong: 0,
    moderate: 0,
    investigate: 0,
    not_challengeable: 0,
    operational: 0,
  };

  for (const tier of tiers) {
    counts[tier] += 1;
  }

  return counts;
}

export function formatViolationWindowSummary(
  totalCount: number,
  inWindowCount: number
): string {
  const agedOutCount = Math.max(totalCount - inWindowCount, 0);
  return `${inWindowCount} score in the 24-month window \u00B7 ${agedOutCount} aged out (on file, no score impact)`;
}
