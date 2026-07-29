export const CARRIER_ENRICHMENT_SOURCES = [
  "safer_company_snapshot",
  "fmcsa_motus",
  "fmcsa_sms_inspections",
] as const;

export type CarrierEnrichmentSource =
  (typeof CARRIER_ENRICHMENT_SOURCES)[number];

export type CarrierEnrichmentCurrentness =
  | "current"
  | "historical_only"
  | "no_data";

export type CarrierEnrichmentTrigger = "scheduled" | "operator";

export const CARRIER_ENRICHMENT_CADENCE_MS =
  7 * 24 * 60 * 60 * 1_000;

export const CARRIER_ENRICHMENT_PARSER_VERSION =
  "authoritative-carrier-v1";

export type CarrierEnrichmentRow = {
  id: string;
  client_id: string;
  source: CarrierEnrichmentSource;
  source_url: string;
  source_as_of: string | null;
  fetched_at: string;
  currentness: CarrierEnrichmentCurrentness;
  data: Record<string, unknown>;
  parser_version: string;
  created_at: string;
  updated_at: string;
};

export type InspectionLevelCount = {
  level: string;
  count: number;
};

/**
 * The weekly gate is source-specific. A partial prior run therefore retries only
 * its missing/stale source instead of replacing the last good values elsewhere.
 */
export function dueCarrierEnrichmentSources(
  rows: Array<Pick<CarrierEnrichmentRow, "source" | "fetched_at">>,
  now = new Date(),
): CarrierEnrichmentSource[] {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Carrier enrichment cadence received an invalid current time");
  }

  const fetchedBySource = new Map<CarrierEnrichmentSource, number>();
  for (const row of rows) {
    const fetchedAt = Date.parse(row.fetched_at);
    if (Number.isNaN(fetchedAt)) {
      throw new Error(
        `Carrier enrichment row has invalid fetched_at for ${row.source}`,
      );
    }
    fetchedBySource.set(row.source, fetchedAt);
  }

  return CARRIER_ENRICHMENT_SOURCES.filter((source) => {
    const fetchedAt = fetchedBySource.get(source);
    return (
      fetchedAt === undefined ||
      now.getTime() - fetchedAt >= CARRIER_ENRICHMENT_CADENCE_MS
    );
  });
}

export function countInspectionLevels(
  rows: Array<{ level: string | null }>,
): InspectionLevelCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const level = row.level?.trim() || "Unknown";
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => {
      const aNumber = Number(a.level);
      const bNumber = Number(b.level);
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
        return aNumber - bNumber;
      }
      return a.level.localeCompare(b.level);
    });
}

export function assertCarrierEnrichmentData(
  source: CarrierEnrichmentSource,
  data: unknown,
): asserts data is Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${source} normalization did not produce a JSON object`);
  }
}
