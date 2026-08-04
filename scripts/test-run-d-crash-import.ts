import assert from "node:assert/strict";
import { mergeCrashSourceRows } from "../lib/fmcsa/datahub-client";
import {
  CRASH_ENRICHMENT_COLUMNS,
  PUBLIC_CRASH_SOURCE_COLUMNS,
  buildPublicCrashUpdate,
  type PublicCrashSource,
} from "../lib/fmcsa/ingest-write-policy";

const dailyRow = {
  crash_id: "5108477",
  report_state: "CA",
  report_number: "CA2652600387",
  report_date: "20260131",
  report_time: "2110",
  report_seq_no: "1",
  dot_number: "2533650",
  location: "I-5 SB",
  city: "LATHROP",
  trafficway_id: "2",
  access_control_id: "1",
  road_surface_condition_id: "1",
  weather_condition_id: "1",
  vehicle_configuration_id: "9",
  light_condition_id: "2",
  vehicle_identification_number: "TESTVIN0000000001",
  vehicle_license_number: "TESTPLATE",
  vehicle_lic_state: "CA",
  fatalities: "0",
  injuries: "0",
  tow_away: "Y",
  federal_recordable: "Y",
  state_recordable: "N",
  future_daily_field: "preserve-me",
};

const smsRow = {
  report_number: "CA2652600387",
  report_seq_no: "1",
  dot_number: "2533650",
  report_date: "31-JAN-26",
  report_state: "CA",
  fatalities: "0",
  injuries: "0",
  tow_away: "true",
  hazmat_released: "false",
  trafficway_desc: "Two-Way Trafficway Divided Unprotected Median",
  access_control_desc: "Full Control",
  road_surface_condition_desc: "Dry",
  weather_condition_desc: "No Adverse Conditions",
  light_condition_desc: "Dark - Not Lighted",
  vehicle_id_number: "TESTVIN0000000001",
  vehicle_license_number: "TESTPLATE",
  vehicle_license_state: "CA",
  severity_weight: "1",
  time_weight: "3",
  citation_issued_desc: "YES",
  not_preventable: "Y",
  future_sms_field: "preserve-me-too",
};

const merged = mergeCrashSourceRows(
  [dailyRow, { ...dailyRow, report_number: "OLD", report_date: "20200101" }],
  [smsRow],
  "2024-08-04"
);
assert.equal(merged.length, 1, "24-month cutoff should remove old crashes");
const crash = merged[0];
assert.deepEqual(
  {
    reportNumber: crash.reportNumber,
    reportSequenceNumber: crash.reportSequenceNumber,
    crashDate: crash.crashDate,
    state: crash.reportState,
    city: crash.city,
    location: crash.location,
    fatalities: crash.fatalities,
    injuries: crash.injuries,
    towAway: crash.towAway,
    hazmatRelease: crash.hazmatRelease,
    trafficway: crash.trafficway,
    accessControlDesc: crash.accessControlDesc,
    roadSurfaceCondition: crash.roadSurfaceCondition,
    weatherCondition: crash.weatherCondition,
    lightCondition: crash.lightCondition,
    vehicleConfiguration: crash.vehicleConfiguration,
    severityWeight: crash.severityWeight,
    timeWeight: crash.timeWeight,
    citationIssued: crash.citationIssued,
    fmcsaNotPreventable: crash.fmcsaNotPreventable,
    federalRecordable: crash.federalRecordable,
    stateRecordable: crash.stateRecordable,
  },
  {
    reportNumber: "CA2652600387",
    reportSequenceNumber: "1",
    crashDate: "2026-01-31",
    state: "CA",
    city: "LATHROP",
    location: "I-5 SB",
    fatalities: 0,
    injuries: 0,
    towAway: true,
    hazmatRelease: false,
    trafficway: "Two-Way Trafficway Divided Unprotected Median",
    accessControlDesc: "Full Control",
    roadSurfaceCondition: "Dry",
    weatherCondition: "No Adverse Conditions",
    lightCondition: "Dark - Not Lighted",
    vehicleConfiguration: "Tractor/Semi-Trailer (one trailer)",
    severityWeight: 1,
    timeWeight: 3,
    citationIssued: true,
    fmcsaNotPreventable: true,
    federalRecordable: true,
    stateRecordable: false,
  }
);
assert.deepEqual(crash.rawData.fmcsa_datahub_daily_crash, dailyRow);
assert.deepEqual(crash.rawData.fmcsa_sms_input_crash, smsRow);

const source: PublicCrashSource = {
  crash_date: crash.crashDate,
  state: crash.reportState,
  city: crash.city,
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

const existingRawData = {
  client_evidence: { note: "must survive" },
  par_extraction: { identity: "reviewed" },
  fmcsa_sms_input_crash: { stale: true },
};
const patch = buildPublicCrashUpdate(
  {
    ...source,
    preventable: true,
    cpdp_eligible: true,
    ai_assessed_at: "2026-08-04T00:00:00.000Z",
  } as PublicCrashSource,
  existingRawData
);

const existingAssessment = {
  preventable: false,
  cpdp_eligible: true,
  cpdp_eligible_types: ["Struck in rear"],
  ai_assessed_at: "2026-07-01T12:00:00.000Z",
};
for (const [key, value] of Object.entries(existingAssessment)) {
  assert.deepEqual(
    ({ ...existingAssessment, ...patch } as Record<string, unknown>)[key],
    value,
    `Public refresh changed assessment field ${key}`
  );
}

assert.deepEqual(patch.raw_data, {
  client_evidence: existingRawData.client_evidence,
  par_extraction: existingRawData.par_extraction,
  fmcsa_sms_input_crash: smsRow,
  fmcsa_datahub_daily_crash: dailyRow,
});
for (const enrichmentColumn of CRASH_ENRICHMENT_COLUMNS) {
  assert.equal(
    enrichmentColumn in patch,
    false,
    `Public crash update included enrichment column ${enrichmentColumn}`
  );
}
for (const key of Object.keys(patch)) {
  assert.equal(
    (PUBLIC_CRASH_SOURCE_COLUMNS as readonly string[]).includes(key),
    true,
    `Unexpected public crash source column ${key}`
  );
}
assert.equal(patch.hazmat_release, false, "known false must not be compacted away");
assert.equal(patch.fatalities, 0, "known zero must not be compacted away");

const sparsePatch = buildPublicCrashUpdate(
  {
    ...source,
    city: null,
    location: null,
    hazmat_release: null,
    citation_issued: null,
    raw_data: {
      fmcsa_datahub_daily_crash: dailyRow,
    },
  },
  existingRawData
);
assert.equal("city" in sparsePatch, false);
assert.equal("location" in sparsePatch, false);
assert.equal("hazmat_release" in sparsePatch, false);
assert.equal("citation_issued" in sparsePatch, false);
assert.deepEqual(sparsePatch.raw_data, {
  ...existingRawData,
  fmcsa_datahub_daily_crash: dailyRow,
});

console.log(
  JSON.stringify(
    {
      passed: true,
      sourceRowsPreserved: Object.keys(crash.rawData),
      publicColumns: Object.keys(patch),
      enrichmentColumnsExcluded: CRASH_ENRICHMENT_COLUMNS,
      unrelatedRawDataPreserved: ["client_evidence", "par_extraction"],
    },
    null,
    2
  )
);
