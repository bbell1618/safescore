import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCrashes, type FMCSACrashRecord } from "@/lib/fmcsa/client";
import {
  buildPublicCrashUpdate,
  type PublicCrashSource,
} from "@/lib/fmcsa/ingest-write-policy";
import { createServiceClient } from "@/lib/supabase/server";

type ExistingCrash = {
  id: string;
  report_number: string | null;
  report_sequence_number: string | null;
  raw_data: Record<string, unknown> | null;
};

export type PublicCrashRefreshResult = {
  crashesPulled: number;
  hadExistingCrashes: boolean;
  newCrashIds: string[];
  updatedCrashIds: string[];
};

function dbError(
  label: string,
  error: { message: string; details?: string | null; hint?: string | null }
) {
  return new Error(
    `${label}: ${error.message}${error.details ? `; ${error.details}` : ""}${
      error.hint ? `; ${error.hint}` : ""
    }`
  );
}

function normalizedIdentityPart(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function crashIdentity(reportNumber: string, reportSequenceNumber: string | null) {
  return `${normalizedIdentityPart(reportNumber)}::${normalizedIdentityPart(
    reportSequenceNumber
  )}`;
}

export function publicCrashSource(crash: FMCSACrashRecord): PublicCrashSource {
  return {
    crash_date: crash.crashDate,
    state: crash.state || null,
    city: crash.city || null,
    report_sequence_number: crash.reportSequenceNumber,
    location: crash.location,
    fatalities: crash.fatalities,
    injuries: crash.injuries,
    tow_away: crash.towAway,
    hazmat_release: crash.hazmatRelease,
    trafficway: crash.trafficway,
    access_control_desc: crash.accessControlDesc,
    road_surface_condition: crash.roadSurfaceCondition,
    weather_condition: crash.weatherCondition,
    light_condition: crash.lightCondition,
    vehicle_configuration: crash.vehicleConfiguration,
    severity_weight: crash.severityWeight,
    time_weight: crash.timeWeight,
    citation_issued: crash.citationIssued,
    fmcsa_not_preventable: crash.fmcsaNotPreventable,
    vehicle_identification_number: crash.vehicleIdentificationNumber,
    vehicle_license_number: crash.vehicleLicenseNumber,
    vehicle_license_state: crash.vehicleLicenseState,
    federal_recordable: crash.federalRecordable,
    state_recordable: crash.stateRecordable,
    raw_data: crash.rawData,
  };
}

async function loadExistingCrashes(supabase: SupabaseClient, clientId: string) {
  const rows: ExistingCrash[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("crashes")
      .select("id, report_number, report_sequence_number, raw_data")
      .eq("client_id", clientId)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw dbError("Unable to load existing crashes", error);
    rows.push(...((data ?? []) as ExistingCrash[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return rows;
}

function findExistingCrash(
  incoming: FMCSACrashRecord,
  existingByReport: Map<string, ExistingCrash[]>
) {
  const reportKey = normalizedIdentityPart(incoming.reportNumber);
  const candidates = existingByReport.get(reportKey) ?? [];
  if (candidates.length === 0) return null;

  const sequenceKey = normalizedIdentityPart(incoming.reportSequenceNumber);
  const exact = candidates.filter(
    (candidate) =>
      normalizedIdentityPart(candidate.report_sequence_number) === sequenceKey
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`Ambiguous existing crash key: ${reportKey}::${sequenceKey}`);
  }

  const legacyCandidates = candidates.filter(
    (candidate) => normalizedIdentityPart(candidate.report_sequence_number) === ""
  );
  // Legacy rows predate report_sequence_number. Adopt the incoming sequence
  // only when there is exactly one legacy candidate for that report.
  if (sequenceKey && legacyCandidates.length === 1) {
    return legacyCandidates[0];
  }
  if (sequenceKey && legacyCandidates.length === 0) return null;

  throw new Error(
    `Unable to identify one existing crash for report ${incoming.reportNumber}`
  );
}

/**
 * Persist an already-fetched public crash slice. Existing records receive only
 * source-owned fields; assessment/PAR/client fields are never part of the
 * update payload. The helper is exported so a scoped backfill can reuse the
 * exact same writer without running the rest of the monitoring pipeline.
 */
export async function persistPublicCrashes(
  {
    clientId,
    dotNumber,
    crashes,
  }: {
    clientId: string;
    dotNumber: string;
    crashes: FMCSACrashRecord[];
  },
  supabase: SupabaseClient
): Promise<PublicCrashRefreshResult> {
  const seenIncoming = new Set<string>();
  for (const crash of crashes) {
    if (!crash.reportNumber.trim()) {
      throw new Error("FMCSA crash row is missing report_number");
    }
    const key = crashIdentity(crash.reportNumber, crash.reportSequenceNumber);
    if (seenIncoming.has(key)) {
      throw new Error(`Ambiguous incoming crash key: ${key}`);
    }
    seenIncoming.add(key);
  }

  const existingRows = await loadExistingCrashes(supabase, clientId);
  const existingByReport = new Map<string, ExistingCrash[]>();
  for (const row of existingRows) {
    if (!row.report_number) continue;
    const key = normalizedIdentityPart(row.report_number);
    existingByReport.set(key, [...(existingByReport.get(key) ?? []), row]);
  }

  const newCrashIds: string[] = [];
  const updatedCrashIds: string[] = [];
  const fetchedAt = new Date().toISOString();
  for (const crash of crashes) {
    const existing = findExistingCrash(crash, existingByReport);
    const sourcePatch = buildPublicCrashUpdate(
      publicCrashSource(crash),
      existing?.raw_data
    );

    if (existing) {
      const { error } = await supabase
        .from("crashes")
        .update({ ...sourcePatch, fmcsa_crash_sources_fetched_at: fetchedAt })
        .eq("id", existing.id);
      if (error) throw dbError("Unable to update crash", error);
      updatedCrashIds.push(existing.id);
      existing.raw_data = sourcePatch.raw_data as Record<string, unknown>;
      existing.report_sequence_number = crash.reportSequenceNumber;
      continue;
    }

    const { data: inserted, error } = await supabase
      .from("crashes")
      .insert({
        client_id: clientId,
        dot_number: dotNumber,
        report_number: crash.reportNumber,
        crash_date: crash.crashDate,
        state: crash.state || null,
        city: crash.city || null,
        fatalities: crash.fatalities ?? 0,
        injuries: crash.injuries ?? 0,
        tow_away: crash.towAway ?? false,
        hazmat_release: crash.hazmatRelease ?? false,
        preventable: null,
        cpdp_eligible: null,
        cpdp_eligible_types: null,
        ai_assessed_at: null,
        ...sourcePatch,
        fmcsa_crash_sources_fetched_at: fetchedAt,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw dbError(
        "Unable to insert crash",
        error ?? { message: "insert returned no row" }
      );
    }

    newCrashIds.push(inserted.id);
    const added: ExistingCrash = {
      id: inserted.id,
      report_number: crash.reportNumber,
      report_sequence_number: crash.reportSequenceNumber,
      raw_data: sourcePatch.raw_data as Record<string, unknown>,
    };
    const reportKey = normalizedIdentityPart(crash.reportNumber);
    existingByReport.set(reportKey, [
      ...(existingByReport.get(reportKey) ?? []),
      added,
    ]);
  }

  return {
    crashesPulled: crashes.length,
    hadExistingCrashes: existingRows.length > 0,
    newCrashIds,
    updatedCrashIds,
  };
}

/** Fetch and persist only crashes; safe for a scoped source-field backfill. */
export async function refreshClientCrashes(
  { clientId, dotNumber }: { clientId: string; dotNumber: string },
  adminClient?: SupabaseClient
): Promise<PublicCrashRefreshResult> {
  const supabase = adminClient ?? (await createServiceClient());
  const crashes = await getCrashes(dotNumber, { throwOnError: true });
  return persistPublicCrashes({ clientId, dotNumber, crashes }, supabase);
}
