import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBasics,
  getCrashes,
  getInspections,
  getOosRates,
  type FMCSABasics,
} from "@/lib/fmcsa/client";
import { getSAFERSnapshot, type SAFERSnapshot } from "@/lib/fmcsa/safer";
import { normalizeViolationLookupCode } from "@/lib/fmcsa/inspection-detail-xml";
import { loadViolationReferenceLookup } from "@/lib/fmcsa/violation-reference";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import type { BurdenResult } from "@/lib/analysis/basic-measure";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildPublicScoreSnapshotUpdate,
  buildPublicViolationUpdate,
  buildSourceUpdate,
  violationIdentityKey,
} from "@/lib/fmcsa/ingest-write-policy";
import {
  detectOosRateChange,
  type MonitoringOosRateChange,
} from "@/lib/monitoring/alert-planner";

type ExistingViolation = {
  id: string;
  inspection_id: string;
  violation_code: string;
};

export type ClientRefreshResult = {
  newViolationIds: string[];
  newCrashIds: string[];
  newInspectionIds: string[];
  newInspectionCount: number;
  oosRateChange: MonitoringOosRateChange | null;
  burden: BurdenResult;
  inspectionsPulled: number;
  violationsProcessed: number;
  crashesPulled: number;
  hadExistingViolations: boolean;
  hadMonitoringBaseline: boolean;
  saferSnapshot: SAFERSnapshot | null;
  basics: FMCSABasics;
};

function dbError(label: string, error: { message: string; details?: string | null; hint?: string | null }) {
  return new Error(
    `${label}: ${error.message}${error.details ? `; ${error.details}` : ""}${error.hint ? `; ${error.hint}` : ""}`
  );
}

async function loadExistingViolations(supabase: SupabaseClient, clientId: string) {
  const rows: ExistingViolation[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("violations")
      .select("id, inspection_id, violation_code")
      .eq("client_id", clientId)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw dbError("Unable to load existing violations", error);
    rows.push(...((data ?? []) as ExistingViolation[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return rows;
}

/**
 * Shared Layer 1-2 refresh used by both the console rerun and the daily cron.
 * It deliberately excludes Layer 4 evidence work, snapshots, alerts, email,
 * activity logging, client activation, and challengeability assessment.
 */
export async function runClientRefresh(
  { clientId, dotNumber }: { clientId: string; dotNumber: string },
  adminClient?: SupabaseClient
): Promise<ClientRefreshResult> {
  const supabase = adminClient ?? (await createServiceClient());

  const [saferResult, basics, oos, inspections, crashes, referenceLookup] =
    await Promise.all([
      getSAFERSnapshot(dotNumber)
        .then((value) => ({ value, error: null as Error | null }))
        .catch((error: unknown) => ({
          value: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
      getBasics(dotNumber, { throwOnError: true }),
      getOosRates(dotNumber),
      getInspections(dotNumber, { throwOnError: true }),
      getCrashes(dotNumber, { throwOnError: true }),
      loadViolationReferenceLookup(supabase),
    ]);
  const saferSnapshot = saferResult.value;
  if (saferResult.error) {
    console.error(`[monitoring-refresh] SAFER failed for DOT ${dotNumber}:`, saferResult.error.message);
  }

  if (saferSnapshot) {
    const censusPayload = {
      dot_number: dotNumber,
      mc_number: null as string | null,
      legal_name: saferSnapshot.legalName,
      dba_name: saferSnapshot.dbaName,
      power_units: saferSnapshot.powerUnits,
      drivers: saferSnapshot.drivers,
      mcs150_date: saferSnapshot.mcs150Date,
      mcs150_mileage: saferSnapshot.mcs150Mileage,
      mcs150_mileage_year: saferSnapshot.mcs150MileageYear,
      cargo_types: saferSnapshot.cargoTypes.length > 0 ? saferSnapshot.cargoTypes : null,
      authority_status: saferSnapshot.operatingAuthority,
      safety_rating: saferSnapshot.safetyRating,
      safety_rating_date: saferSnapshot.safetyRatingDate,
      review_type: saferSnapshot.reviewType,
      review_date: saferSnapshot.reviewDate,
      entity_type: saferSnapshot.entityType,
      carrier_operation: saferSnapshot.operatingStatus,
      safer_as_of: saferSnapshot.saferAsOf,
      national_vehicle_oos_rate: saferSnapshot.nationalVehicleOosRate,
      national_driver_oos_rate: saferSnapshot.nationalDriverOosRate,
      national_hazmat_oos_rate: saferSnapshot.nationalHazmatOosRate,
      fetched_at: new Date().toISOString(),
    };

    const { data: existingProfile, error: profileReadError } = await supabase
      .from("carrier_profiles")
      .select("id, mc_number")
      .eq("client_id", clientId)
      .maybeSingle();
    if (profileReadError) throw dbError("Unable to load carrier profile", profileReadError);
    if (existingProfile?.mc_number) censusPayload.mc_number = existingProfile.mc_number;

    const profileWrite = existingProfile
      ? await supabase
          .from("carrier_profiles")
          .update(buildSourceUpdate(censusPayload))
          .eq("id", existingProfile.id)
      : await supabase.from("carrier_profiles").insert({ client_id: clientId, ...censusPayload });
    if (profileWrite.error) throw dbError("Unable to persist carrier profile", profileWrite.error);
  }

  const today = new Date().toISOString().slice(0, 10);
  const publicScorePayload: Record<string, unknown> = {
    client_id: clientId,
    snapshot_date: today,
    ...(basics.unsafeDriving
      ? {
          unsafe_driving_measure: basics.unsafeDriving.measureValue,
          unsafe_driving_pct: basics.unsafeDriving.percentile,
          unsafe_driving_alert: basics.unsafeDriving.alert,
        }
      : {}),
    ...(basics.hosCompliance
      ? {
          hos_compliance_measure: basics.hosCompliance.measureValue,
          hos_compliance_pct: basics.hosCompliance.percentile,
          hos_compliance_alert: basics.hosCompliance.alert,
        }
      : {}),
    ...(basics.driverFitness
      ? {
          driver_fitness_measure: basics.driverFitness.measureValue,
          driver_fitness_pct: basics.driverFitness.percentile,
          driver_fitness_alert: basics.driverFitness.alert,
        }
      : {}),
    ...(basics.controlledSubstances
      ? {
          controlled_substance_measure: basics.controlledSubstances.measureValue,
          controlled_substance_pct: basics.controlledSubstances.percentile,
          controlled_substance_alert: basics.controlledSubstances.alert,
        }
      : {}),
    ...(basics.vehicleMaintenance
      ? {
          vehicle_maint_measure: basics.vehicleMaintenance.measureValue,
          vehicle_maint_pct: basics.vehicleMaintenance.percentile,
          vehicle_maint_alert: basics.vehicleMaintenance.alert,
        }
      : {}),
    ...(basics.hmCompliance
      ? {
          hm_compliance_measure: basics.hmCompliance.measureValue,
          hm_compliance_pct: basics.hmCompliance.percentile,
          hm_compliance_alert: basics.hmCompliance.alert,
        }
      : {}),
    ...(basics.crashIndicator
      ? {
          crash_indicator_measure: basics.crashIndicator.measureValue,
          crash_indicator_pct: basics.crashIndicator.percentile,
          crash_indicator_alert: basics.crashIndicator.alert,
        }
      : {}),
    oos_vehicle_rate: saferSnapshot?.vehicleOosRate ?? oos.vehicleOosRate,
    oos_driver_rate: saferSnapshot?.driverOosRate ?? oos.driverOosRate,
    oos_hazmat_rate: saferSnapshot?.hazmatOosRate ?? oos.hazmatOosRate,
    source: "api",
  };
  const scoreSnapshotFields =
    "id, snapshot_date, source, oos_vehicle_rate, oos_driver_rate, oos_hazmat_rate";
  const [existingScoreResult, previousScoreResult] = await Promise.all([
    supabase
      .from("score_snapshots")
      .select(scoreSnapshotFields)
      .eq("client_id", clientId)
      .eq("snapshot_date", today)
      .maybeSingle(),
    supabase
      .from("score_snapshots")
      .select(scoreSnapshotFields)
      .eq("client_id", clientId)
      .order("snapshot_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (existingScoreResult.error) {
    throw dbError("Unable to load today's score snapshot", existingScoreResult.error);
  }
  if (previousScoreResult.error) {
    throw dbError("Unable to load previous score snapshot", previousScoreResult.error);
  }
  const existingScore = existingScoreResult.data;
  const previousScore = previousScoreResult.data;

  const scoreWrite = existingScore
    ? await supabase
        .from("score_snapshots")
        .update(buildPublicScoreSnapshotUpdate(publicScorePayload, existingScore.source))
        .eq("id", existingScore.id)
        .select(scoreSnapshotFields)
        .single()
    : await supabase
        .from("score_snapshots")
        .insert(publicScorePayload)
        .select(scoreSnapshotFields)
        .single();
  if (scoreWrite.error || !scoreWrite.data) {
    throw dbError(
      "Unable to persist score snapshot",
      scoreWrite.error ?? { message: "write returned no row" }
    );
  }

  const oosRateChange = detectOosRateChange(previousScore, scoreWrite.data);

  const [{ data: existingInspections, error: inspectionReadError }, existingViolations] =
    await Promise.all([
      supabase
        .from("inspections")
        .select("id, report_number, facility_name, total_violations, oos_violations")
        .eq("client_id", clientId),
      loadExistingViolations(supabase, clientId),
    ]);
  if (inspectionReadError) throw dbError("Unable to load existing inspections", inspectionReadError);

  const existingInspectionByReport = new Map(
    (existingInspections ?? []).map((row) => [row.report_number, row])
  );
  const existingViolationMap = new Map<string, ExistingViolation[]>();
  for (const row of existingViolations) {
    const key = violationIdentityKey(row.inspection_id, row.violation_code);
    const matches = existingViolationMap.get(key) ?? [];
    matches.push(row);
    existingViolationMap.set(key, matches);
  }
  const newViolationIds: string[] = [];
  const newInspectionIds: string[] = [];
  let newInspectionCount = 0;
  let violationsProcessed = 0;

  for (const inspection of inspections) {
    const priorInspection = existingInspectionByReport.get(inspection.reportNumber);
    const isNewInspection = !priorInspection;
    const sourceOosCount = inspection.violations.filter(
      (row) => row.oosViolation
    ).length;
    const { data: inspectionRow, error: inspectionError } = await supabase
      .from("inspections")
      .upsert(
        {
          client_id: clientId,
          dot_number: dotNumber,
          report_number: inspection.reportNumber,
          inspection_date: inspection.inspectionDate,
          state: inspection.state,
          level: inspection.level,
          facility_name:
            inspection.facilityName ||
            priorInspection?.facility_name ||
            `Level ${inspection.level} — ${inspection.state}`,
          time_weight: inspection.timeWeight,
          // The import is intentionally non-destructive. If a corrected source
          // no longer returns an old child row, retain a header count that is
          // consistent with the still-present children until scoped remediation.
          total_violations: Math.max(
            priorInspection?.total_violations ?? 0,
            inspection.violations.length
          ),
          oos_violations: Math.max(
            priorInspection?.oos_violations ?? 0,
            sourceOosCount
          ),
        },
        { onConflict: "client_id,report_number" }
      )
      .select("id")
      .single();
    if (inspectionError || !inspectionRow) {
      throw dbError("Unable to persist inspection", inspectionError ?? { message: "insert returned no row" });
    }
    if (isNewInspection) {
      newInspectionCount += 1;
      newInspectionIds.push(inspectionRow.id);
    }
    existingInspectionByReport.set(inspection.reportNumber, {
      id: inspectionRow.id,
      report_number: inspection.reportNumber,
      facility_name:
        inspection.facilityName ||
        priorInspection?.facility_name ||
        `Level ${inspection.level} — ${inspection.state}`,
      total_violations: Math.max(
        priorInspection?.total_violations ?? 0,
        inspection.violations.length
      ),
      oos_violations: Math.max(
        priorInspection?.oos_violations ?? 0,
        sourceOosCount
      ),
    });

    const { data: linkedViolations, error: linkedError } = await supabase
      .from("violations")
      .select("id")
      .eq("inspection_id", inspectionRow.id);
    if (linkedError) throw dbError("Unable to load linked violations", linkedError);
    if ((linkedViolations?.length ?? 0) > 0) {
      const { error: canonicalDateError } = await supabase
        .from("dataq_cases")
        .update({ canonical_inspection_date: inspection.inspectionDate })
        .in("violation_id", linkedViolations!.map((row: { id: string }) => row.id))
        .is("canonical_inspection_date", null);
      if (canonicalDateError) throw dbError("Unable to backfill canonical inspection date", canonicalDateError);
    }

    for (const violation of inspection.violations) {
      const reference =
        referenceLookup[violation.violationCode.toUpperCase()] ??
        referenceLookup[normalizeViolationLookupCode(violation.violationCode)];
      const basicCategory = reference?.basicCategory ?? violation.basicCategory;
      const severityWeight = reference?.severityWeight ?? violation.severityWeight;
      const key = violationIdentityKey(inspectionRow.id, violation.violationCode);
      const existing = existingViolationMap.get(key) ?? [];
      const publicPayload = buildPublicViolationUpdate({
        violation_description: violation.description,
        basic_category: basicCategory,
        severity_weight: severityWeight,
        time_weight: inspection.timeWeight,
        oos_violation: violation.oosViolation,
      });

      if (existing.length > 0) {
        for (const existingRow of existing) {
          const { error } = await supabase
            .from("violations")
            .update(publicPayload)
            .eq("id", existingRow.id);
          if (error) throw dbError("Unable to update violation", error);
        }
      } else {
        const { data: inserted, error } = await supabase
          .from("violations")
          .insert({
            inspection_id: inspectionRow.id,
            client_id: clientId,
            violation_code: violation.violationCode,
            ...publicPayload,
            // Public SMS data has no conviction or citation disposition.
            // Explicit null avoids the historical false/true fabrication.
            convicted: null,
            citation_number: null,
            citation_result: null,
            challengeable: null,
            challenge_tier: null,
            challenge_reason: null,
            challenge_priority: null,
            ai_assessed_at: null,
          })
          .select("id")
          .single();
        if (error || !inserted) {
          throw dbError("Unable to insert violation", error ?? { message: "insert returned no row" });
        }
        newViolationIds.push(inserted.id);
        existingViolationMap.set(key, [
          {
            id: inserted.id,
            inspection_id: inspectionRow.id,
            violation_code: violation.violationCode,
          },
        ]);
      }
      violationsProcessed += 1;
    }
  }

  const { data: existingCrashes, error: crashReadError } = await supabase
    .from("crashes")
    .select("id, report_number")
    .eq("client_id", clientId);
  if (crashReadError) throw dbError("Unable to load existing crashes", crashReadError);
  const existingCrashMap = new Map<string, string>();
  for (const row of existingCrashes ?? []) {
    if (row.report_number) existingCrashMap.set(row.report_number, row.id);
  }

  const newCrashIds: string[] = [];
  for (const crash of crashes) {
    const existingId = crash.reportNumber ? existingCrashMap.get(crash.reportNumber) : undefined;
    const payload = {
      crash_date: crash.crashDate,
      state: crash.state,
      city: crash.city,
      fatalities: crash.fatalities,
      injuries: crash.injuries,
      tow_away: crash.towAway,
    };
    if (existingId) {
      const { error } = await supabase
        .from("crashes")
        .update(buildSourceUpdate(payload))
        .eq("id", existingId);
      if (error) throw dbError("Unable to update crash", error);
    } else {
      const { data: inserted, error } = await supabase
        .from("crashes")
        .insert({
          client_id: clientId,
          dot_number: dotNumber,
          report_number: crash.reportNumber,
          ...payload,
          // The public Crash File exposes a placard flag, not a release result.
          // Keep the schema default until Portal/client evidence supplies one.
          hazmat_release: false,
          preventable: null,
          cpdp_eligible: null,
          raw_data: {},
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw dbError("Unable to insert crash", error ?? { message: "insert returned no row" });
      }
      newCrashIds.push(inserted.id);
      if (crash.reportNumber) existingCrashMap.set(crash.reportNumber, inserted.id);
    }
  }

  const burden = await getClientBurden(clientId, supabase);
  return {
    newViolationIds,
    newCrashIds,
    newInspectionIds,
    newInspectionCount,
    oosRateChange,
    burden,
    inspectionsPulled: inspections.length,
    violationsProcessed,
    crashesPulled: crashes.length,
    hadExistingViolations: existingViolations.length > 0,
    hadMonitoringBaseline:
      previousScore !== null ||
      (existingInspections?.length ?? 0) > 0 ||
      existingViolations.length > 0 ||
      (existingCrashes?.length ?? 0) > 0,
    saferSnapshot,
    basics,
  };
}
