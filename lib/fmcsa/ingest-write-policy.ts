export const VIOLATION_ENRICHMENT_COLUMNS = [
  "convicted",
  "citation_number",
  "citation_result",
  "challengeable",
  "challenge_tier",
  "challenge_reason",
  "challenge_priority",
  "ai_assessed_at",
] as const;

export const INSPECTION_ENRICHMENT_COLUMNS = [
  "mcmis_inspection_id",
  "start_time",
  "end_time",
  "location_text",
  "facility_name",
  "post_accident_indicator",
  "raw_data",
] as const;

export const CRASH_ENRICHMENT_COLUMNS = [
  "hazmat_release",
  "preventable",
  "cpdp_eligible",
  "cpdp_eligible_types",
  "ai_assessed_at",
  "raw_data",
] as const;

export const AUTHENTICATED_SCORE_COLUMNS = [
  "unsafe_driving_measure",
  "unsafe_driving_pct",
  "unsafe_driving_alert",
  "hos_compliance_measure",
  "hos_compliance_pct",
  "hos_compliance_alert",
  "driver_fitness_measure",
  "driver_fitness_pct",
  "driver_fitness_alert",
  "controlled_substance_measure",
  "controlled_substance_pct",
  "controlled_substance_alert",
  "vehicle_maint_measure",
  "vehicle_maint_pct",
  "vehicle_maint_alert",
  "hm_compliance_measure",
  "hm_compliance_pct",
  "hm_compliance_alert",
  "crash_indicator_measure",
  "crash_indicator_pct",
  "crash_indicator_alert",
  "official_basics",
  "source_file_hash",
  "source",
] as const;

/**
 * Authoritative carrier facts are stored in one source-scoped child row. A
 * successful refresh may replace only these fields for that exact source; it
 * never writes carrier_profiles census fields or another source's data.
 */
export const CARRIER_PROFILE_ENRICHMENT_WRITE_COLUMNS = [
  "source_url",
  "source_as_of",
  "fetched_at",
  "currentness",
  "data",
  "parser_version",
] as const;

export type PublicViolationSource = {
  violation_description: string;
  basic_category: string | null;
  severity_weight: number | null;
  time_weight: number;
  oos_violation: boolean;
};

export type DetailViolationCandidate = PublicViolationSource & {
  inspection_id: string;
  client_id: string;
  violation_code: string;
  citation_number: string | null;
  citation_result: string | null;
};

export type ExistingViolationIdentity = {
  id: string;
  inspection_id: string;
  violation_code: string;
};

export function compactSourceFields<T extends Record<string, unknown>>(
  fields: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      return typeof value !== "string" || value.trim().length > 0;
    })
  ) as Partial<T>;
}

/** Public SMS data owns only these five violation columns. */
export function buildPublicViolationUpdate(
  source: PublicViolationSource
): Partial<PublicViolationSource> {
  return compactSourceFields({
    violation_description: source.violation_description,
    basic_category: source.basic_category,
    severity_weight: source.severity_weight,
    time_weight: source.time_weight,
    oos_violation: source.oos_violation,
  });
}

/** Portal detail may enrich citations, but nulls never erase prior enrichment. */
export function buildDetailViolationUpdate(
  source: DetailViolationCandidate
): Record<string, unknown> {
  return compactSourceFields({
    ...buildPublicViolationUpdate(source),
    citation_number: source.citation_number,
    citation_result: source.citation_result,
  });
}

export function planDetailViolationWrites(
  existingRows: ExistingViolationIdentity[],
  incomingRows: DetailViolationCandidate[]
) {
  const existingByKey = new Map<string, ExistingViolationIdentity>();
  for (const row of existingRows) {
    const key = violationIdentityKey(row.inspection_id, row.violation_code);
    if (existingByKey.has(key)) {
      throw new Error(`Ambiguous existing violation key: ${key}`);
    }
    existingByKey.set(key, row);
  }

  const incomingKeys = new Set<string>();
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];

  for (const incoming of incomingRows) {
    const key = violationIdentityKey(incoming.inspection_id, incoming.violation_code);
    if (incomingKeys.has(key)) {
      throw new Error(`Ambiguous incoming violation key: ${key}`);
    }
    incomingKeys.add(key);

    const existing = existingByKey.get(key);
    if (existing) {
      updates.push({ id: existing.id, payload: buildDetailViolationUpdate(incoming) });
      continue;
    }

    inserts.push({
      ...incoming,
      convicted: null,
      challengeable: null,
      challenge_tier: null,
      challenge_reason: null,
      challenge_priority: null,
      ai_assessed_at: null,
    });
  }

  return { updates, inserts };
}

export function violationIdentityKey(inspectionId: string, violationCode: string) {
  return `${inspectionId}:${violationCode.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

/** Null/blank fields from a sparse source are absence, not deletion instructions. */
export function buildSourceUpdate<T extends Record<string, unknown>>(
  source: T
): Partial<T> {
  return compactSourceFields(source);
}

export function buildCarrierProfileEnrichmentUpdate(input: {
  source_url: string;
  source_as_of: string | null;
  fetched_at: string;
  currentness: "current" | "historical_only" | "no_data";
  data: Record<string, unknown>;
  parser_version: string;
}): Record<string, unknown> {
  if (!input.source_url.trim()) {
    throw new Error("Carrier enrichment source_url is required");
  }
  if (Number.isNaN(Date.parse(input.fetched_at))) {
    throw new Error("Carrier enrichment fetched_at must be an ISO timestamp");
  }
  if (!input.data || Array.isArray(input.data)) {
    throw new Error("Carrier enrichment data must be a JSON object");
  }
  if (!input.parser_version.trim()) {
    throw new Error("Carrier enrichment parser_version is required");
  }

  return {
    source_url: input.source_url,
    source_as_of: input.source_as_of,
    fetched_at: input.fetched_at,
    currentness: input.currentness,
    data: input.data,
    parser_version: input.parser_version,
  };
}

const PUBLIC_OOS_SCORE_COLUMNS = [
  "oos_vehicle_rate",
  "oos_driver_rate",
  "oos_hazmat_rate",
] as const;

/** Authenticated All-BASIC data outranks a public same-date refresh. */
export function buildPublicScoreSnapshotUpdate(
  source: Record<string, unknown>,
  existingSource: string | null
): Record<string, unknown> {
  const compact = compactSourceFields(source) as Record<string, unknown>;
  delete compact.client_id;
  delete compact.snapshot_date;

  if (existingSource !== "authenticated") return compact;

  const oosOnly: Record<string, unknown> = {};
  for (const column of PUBLIC_OOS_SCORE_COLUMNS) {
    if (column in compact) oosOnly[column] = compact[column];
  }
  return oosOnly;
}
