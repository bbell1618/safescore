import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getCrashes } from "../lib/fmcsa/client";
import {
  buildPublicCrashUpdate,
  type PublicCrashSource,
} from "../lib/fmcsa/ingest-write-policy";

loadEnvConfig(process.cwd());

const CLIENT_ID = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const DOT_NUMBER = "2533650";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main() {
  const service = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: before, error: beforeError } = await service
    .from("crashes")
    .select(
      "id, report_number, preventable, cpdp_eligible, cpdp_eligible_types, ai_assessed_at, par_document_id, raw_data",
    )
    .eq("client_id", CLIENT_ID)
    .order("report_number");
  if (beforeError) throw beforeError;

  const incoming = await getCrashes(DOT_NUMBER, { throwOnError: true });
  const existingReports = new Set(
    (before ?? []).map((row) => String(row.report_number)),
  );
  const incomingReports = new Set(incoming.map((row) => row.reportNumber));

  assert.equal(before?.length, 4, "Nationwide must still have exactly four crashes");
  assert.equal(incoming.length, 4, "FMCSA must return exactly the four known crashes");
  assert.deepEqual(
    [...incomingReports].sort(),
    [...existingReports].sort(),
    "FMCSA report numbers must match the four existing Nationwide crashes",
  );

  const protectedBefore = new Map(
    (before ?? []).map((row) => [
      row.id,
      {
        preventable: row.preventable,
        cpdp_eligible: row.cpdp_eligible,
        cpdp_eligible_types: row.cpdp_eligible_types,
        ai_assessed_at: row.ai_assessed_at,
        par_document_id: row.par_document_id,
      },
    ]),
  );

  const fetchedAt = new Date().toISOString();
  const updatedCrashIds: string[] = [];
  for (const crash of incoming) {
    const existing = before?.find(
      (row) => row.report_number === crash.reportNumber,
    );
    assert.ok(existing, `Missing existing crash ${crash.reportNumber}`);

    const source: PublicCrashSource = {
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
    const patch = buildPublicCrashUpdate(
      source,
      existing.raw_data as Record<string, unknown> | null,
    );
    const { error } = await service
      .from("crashes")
      .update({ ...patch, fmcsa_crash_sources_fetched_at: fetchedAt })
      .eq("id", existing.id)
      .eq("client_id", CLIENT_ID)
      .eq("report_number", crash.reportNumber);
    if (error) throw error;
    updatedCrashIds.push(existing.id);
  }

  const { data: after, error: afterError } = await service
    .from("crashes")
    .select(
      "id, report_number, report_sequence_number, location, trafficway, access_control_desc, road_surface_condition, weather_condition, light_condition, vehicle_configuration, severity_weight, time_weight, citation_issued, fmcsa_not_preventable, vehicle_identification_number, vehicle_license_number, vehicle_license_state, federal_recordable, state_recordable, fmcsa_crash_sources_fetched_at, preventable, cpdp_eligible, cpdp_eligible_types, ai_assessed_at, par_document_id, raw_data",
    )
    .eq("client_id", CLIENT_ID)
    .order("report_number");
  if (afterError) throw afterError;

  for (const row of after ?? []) {
    assert.deepEqual(
      {
        preventable: row.preventable,
        cpdp_eligible: row.cpdp_eligible,
        cpdp_eligible_types: row.cpdp_eligible_types,
        ai_assessed_at: row.ai_assessed_at,
        par_document_id: row.par_document_id,
      },
      protectedBefore.get(row.id),
      `Protected crash fields changed for ${row.report_number}`,
    );
    const raw = row.raw_data as Record<string, unknown>;
    assert.ok(raw.fmcsa_datahub_daily_crash);
    assert.ok(raw.fmcsa_sms_input_crash);
  }

  console.log(
    JSON.stringify(
      {
        result: {
          crashesPulled: incoming.length,
          newCrashIds: [],
          updatedCrashIds,
        },
        crashes: (after ?? []).map(({ raw_data, ...row }) => ({
          ...row,
          raw_data_sources: Object.keys(raw_data as Record<string, unknown>).sort(),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
