import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CARRIER_ENRICHMENT_PARSER_VERSION,
  CARRIER_ENRICHMENT_SOURCES,
  assertCarrierEnrichmentData,
  countInspectionLevels,
  dueCarrierEnrichmentSources,
  type CarrierEnrichmentRow,
  type CarrierEnrichmentSource,
  type CarrierEnrichmentTrigger,
} from "@/lib/fmcsa/carrier-profile-enrichment";
import {
  buildCarrierProfileEnrichmentUpdate,
} from "@/lib/fmcsa/ingest-write-policy";
import {
  getMotusCarrierSnapshot,
} from "@/lib/fmcsa/motus";
import {
  getSAFERSnapshot,
  type SAFERSnapshot,
} from "@/lib/fmcsa/safer";
import { createServiceClient } from "@/lib/supabase/server";

const SAFER_URL = (dotNumber: string) =>
  `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(
    dotNumber,
  )}`;
const MOTUS_URL = (dotNumber: string) =>
  `https://motus.dot.gov/api/carriers/${encodeURIComponent(dotNumber)}`;
const SMS_INSPECTION_URL =
  "https://data.transportation.gov/resource/rbkj-cgst.json";

type ExtendedSaferSnapshot = SAFERSnapshot & {
  operationClassifications?: string[];
  carrierOperations?: string[];
  carrierOperation?: string | null;
  docketNumbers?: string[];
  mcNumber?: string | null;
};

export type CarrierEnrichmentSourceResult = {
  source: CarrierEnrichmentSource;
  status: "succeeded" | "failed" | "skipped";
  reason: string;
  row: CarrierEnrichmentRow | null;
};

export type CarrierProfileEnrichmentResult = {
  status: "refreshed" | "skipped";
  refreshId: string;
  due: CarrierEnrichmentSource[];
  sources: CarrierEnrichmentSourceResult[];
  rows: CarrierEnrichmentRow[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbError(
  label: string,
  error: {
    message: string;
    details?: string | null;
    hint?: string | null;
  },
): Error {
  return new Error(
    `${label}: ${error.message}${error.details ? `; ${error.details}` : ""}${
      error.hint ? `; ${error.hint}` : ""
    }`,
  );
}

async function loadRows(
  supabase: SupabaseClient,
  clientId: string,
): Promise<CarrierEnrichmentRow[]> {
  const { data, error } = await supabase
    .from("carrier_profile_enrichments")
    .select("*")
    .eq("client_id", clientId)
    .order("source", { ascending: true });
  if (error) throw dbError("Unable to load carrier enrichment", error);
  return (data ?? []) as CarrierEnrichmentRow[];
}

async function recordAttempt(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    userId?: string | null;
    refreshId: string;
    source: CarrierEnrichmentSource;
    trigger: CarrierEnrichmentTrigger;
    status: "started" | "succeeded" | "failed";
    reason: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    client_id: input.clientId,
    user_id: input.userId ?? null,
    action_type: "carrier_profile_enrichment_attempt",
    entity_type: "carrier_profile_enrichment",
    entity_id: input.refreshId,
    description:
      `Carrier-profile ${input.source} enrichment ${input.status}: ` +
      input.reason,
    metadata: {
      refresh_id: input.refreshId,
      source: input.source,
      trigger: input.trigger,
      status: input.status,
      reason: input.reason,
      ...input.metadata,
    },
  });
  if (error) {
    throw dbError(
      `Unable to log ${input.source} enrichment ${input.status}`,
      error,
    );
  }
}

function normalizedSaferData(snapshot: ExtendedSaferSnapshot, dotNumber: string) {
  const operationClassifications =
    snapshot.operationClassifications ??
    (snapshot.operationClassification
      ? snapshot.operationClassification.split(" | ")
      : []);
  const carrierOperations =
    snapshot.carrierOperations ??
    (snapshot.carrierOperation ? [snapshot.carrierOperation] : []);
  const docketNumbers =
    snapshot.docketNumbers ??
    (snapshot.mcNumber ? [`MC-${snapshot.mcNumber.replace(/^MC-?/i, "")}`] : []);

  return {
    dotNumber,
    legalName: snapshot.legalName,
    dbaName: snapshot.dbaName,
    entityType: snapshot.entityType,
    operatingStatus: snapshot.operatingStatus,
    operatingAuthority: snapshot.operatingAuthority,
    operationClassifications,
    carrierOperations,
    docketNumbers,
    powerUnits: snapshot.powerUnits,
    drivers: snapshot.drivers,
    mcs150Date: snapshot.mcs150Date,
    mcs150Mileage: snapshot.mcs150Mileage,
    mcs150MileageYear: snapshot.mcs150MileageYear,
    cargoTypes: snapshot.cargoTypes,
    safetyRating: snapshot.safetyRating,
    safetyRatingDate: snapshot.safetyRatingDate,
    reviewType: snapshot.reviewType,
    reviewDate: snapshot.reviewDate,
    inspections: {
      vehicle: {
        inspections: snapshot.vehicleInspections,
        outOfService: snapshot.vehicleOosCount,
        oosRate: snapshot.vehicleOosRate,
        nationalRate: snapshot.nationalVehicleOosRate,
      },
      driver: {
        inspections: snapshot.driverInspections,
        outOfService: snapshot.driverOosCount,
        oosRate: snapshot.driverOosRate,
        nationalRate: snapshot.nationalDriverOosRate,
      },
      hazmat: {
        inspections: snapshot.hazmatInspections,
        outOfService: snapshot.hazmatOosCount,
        oosRate: snapshot.hazmatOosRate,
        nationalRate: snapshot.nationalHazmatOosRate,
      },
    },
  };
}

async function upsertRow(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    source: CarrierEnrichmentSource;
    sourceUrl: string;
    sourceAsOf: string | null;
    fetchedAt: string;
    data: Record<string, unknown>;
  },
): Promise<CarrierEnrichmentRow> {
  assertCarrierEnrichmentData(input.source, input.data);
  const update = buildCarrierProfileEnrichmentUpdate({
    source_url: input.sourceUrl,
    source_as_of: input.sourceAsOf,
    fetched_at: input.fetchedAt,
    currentness: "current",
    data: input.data,
    parser_version: CARRIER_ENRICHMENT_PARSER_VERSION,
  });
  const { data, error } = await supabase
    .from("carrier_profile_enrichments")
    .upsert(
      {
        client_id: input.clientId,
        source: input.source,
        ...update,
      },
      { onConflict: "client_id,source" },
    )
    .select("*")
    .single();
  if (error || !data) {
    throw dbError(
      `Unable to persist ${input.source} enrichment`,
      error ?? { message: "write returned no row" },
    );
  }
  return data as CarrierEnrichmentRow;
}

export async function refreshCarrierProfileEnrichment(
  input: {
    clientId: string;
    dotNumber: string;
    force?: boolean;
    trigger: CarrierEnrichmentTrigger;
    userId?: string | null;
    freshSafer?: SAFERSnapshot | null;
    now?: Date;
  },
  adminClient?: SupabaseClient,
): Promise<CarrierProfileEnrichmentResult> {
  const supabase = adminClient ?? (await createServiceClient());
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Carrier enrichment received an invalid current time");
  }
  const existingRows = await loadRows(supabase, input.clientId);
  const due = input.force
    ? [...CARRIER_ENRICHMENT_SOURCES]
    : dueCarrierEnrichmentSources(existingRows, now);
  const refreshId = randomUUID();
  if (due.length === 0) {
    return {
      status: "skipped",
      refreshId,
      due,
      sources: CARRIER_ENRICHMENT_SOURCES.map((source) => ({
        source,
        status: "skipped",
        reason: "fresh_within_weekly_cadence",
        row: existingRows.find((row) => row.source === source) ?? null,
      })),
      rows: existingRows,
    };
  }

  const results: CarrierEnrichmentSourceResult[] = [];
  for (const source of CARRIER_ENRICHMENT_SOURCES) {
    if (!due.includes(source)) {
      results.push({
        source,
        status: "skipped",
        reason: "fresh_within_weekly_cadence",
        row: existingRows.find((row) => row.source === source) ?? null,
      });
      continue;
    }

    await recordAttempt(supabase, {
      clientId: input.clientId,
      userId: input.userId,
      refreshId,
      source,
      trigger: input.trigger,
      status: "started",
      reason: "source_refresh_started",
    });

    try {
      const fetchedAt = now.toISOString();
      let row: CarrierEnrichmentRow;
      if (source === "safer_company_snapshot") {
        const snapshot =
          (input.freshSafer as ExtendedSaferSnapshot | null | undefined) ??
          (await getSAFERSnapshot(input.dotNumber));
        row = await upsertRow(supabase, {
          clientId: input.clientId,
          source,
          sourceUrl: SAFER_URL(input.dotNumber),
          sourceAsOf: snapshot.saferAsOf,
          fetchedAt,
          data: normalizedSaferData(snapshot, input.dotNumber),
        });
      } else if (source === "fmcsa_motus") {
        const snapshot = await getMotusCarrierSnapshot(input.dotNumber);
        const data = snapshot as unknown as Record<string, unknown>;
        const sourceAsOf =
          typeof data.sourceAsOf === "string" ? data.sourceAsOf : null;
        row = await upsertRow(supabase, {
          clientId: input.clientId,
          source,
          sourceUrl: MOTUS_URL(input.dotNumber),
          sourceAsOf,
          fetchedAt,
          data,
        });
      } else {
        const { data: inspectionRows, error } = await supabase
          .from("inspections")
          .select("level")
          .eq("client_id", input.clientId);
        if (error) {
          throw dbError("Unable to derive inspection-level counts", error);
        }
        const levels = countInspectionLevels(inspectionRows ?? []);
        row = await upsertRow(supabase, {
          clientId: input.clientId,
          source,
          sourceUrl: SMS_INSPECTION_URL,
          sourceAsOf: null,
          fetchedAt,
          data: {
            dotNumber: input.dotNumber,
            total: levels.reduce((sum, item) => sum + item.count, 0),
            levels,
          },
        });
      }

      await recordAttempt(supabase, {
        clientId: input.clientId,
        userId: input.userId,
        refreshId,
        source,
        trigger: input.trigger,
        status: "succeeded",
        reason: "validated_and_persisted",
        metadata: {
          enrichment_row_id: row.id,
          source_as_of: row.source_as_of,
          fetched_at: row.fetched_at,
          parser_version: row.parser_version,
        },
      });
      results.push({
        source,
        status: "succeeded",
        reason: "validated_and_persisted",
        row,
      });
    } catch (error) {
      let reason = errorMessage(error);
      try {
        await recordAttempt(supabase, {
          clientId: input.clientId,
          userId: input.userId,
          refreshId,
          source,
          trigger: input.trigger,
          status: "failed",
          reason,
          metadata: { retained_last_good_row: true },
        });
      } catch (loggingError) {
        reason += `; attempt logging also failed: ${errorMessage(loggingError)}`;
      }
      results.push({
        source,
        status: "failed",
        reason,
        row: existingRows.find((row) => row.source === source) ?? null,
      });
    }
  }

  return {
    status: "refreshed",
    refreshId,
    due,
    sources: results,
    rows: await loadRows(supabase, input.clientId),
  };
}
