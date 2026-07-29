import assert from "node:assert/strict";
import {
  CARRIER_ENRICHMENT_CADENCE_MS,
  CARRIER_ENRICHMENT_SOURCES,
  countInspectionLevels,
  dueCarrierEnrichmentSources,
} from "../lib/fmcsa/carrier-profile-enrichment";
import {
  CARRIER_PROFILE_ENRICHMENT_WRITE_COLUMNS,
  buildCarrierProfileEnrichmentUpdate,
} from "../lib/fmcsa/ingest-write-policy";
import {
  applyVehicleOosPriorityContext,
  type AssessmentResult,
  type ViolationInput,
} from "../lib/analysis/challengeability";

const now = new Date("2026-07-29T20:00:00.000Z");
const fresh = new Date(
  now.getTime() - CARRIER_ENRICHMENT_CADENCE_MS + 1,
).toISOString();
const due = new Date(
  now.getTime() - CARRIER_ENRICHMENT_CADENCE_MS,
).toISOString();

assert.deepEqual(dueCarrierEnrichmentSources([], now), [
  ...CARRIER_ENRICHMENT_SOURCES,
]);
assert.deepEqual(
  dueCarrierEnrichmentSources(
    CARRIER_ENRICHMENT_SOURCES.map((source) => ({
      source,
      fetched_at: fresh,
    })),
    now,
  ),
  [],
);
assert.deepEqual(
  dueCarrierEnrichmentSources(
    [
      { source: "safer_company_snapshot", fetched_at: fresh },
      { source: "fmcsa_motus", fetched_at: due },
      { source: "fmcsa_sms_inspections", fetched_at: fresh },
    ],
    now,
  ),
  ["fmcsa_motus"],
);
assert.throws(
  () =>
    dueCarrierEnrichmentSources(
      [{ source: "fmcsa_motus", fetched_at: "not-a-date" }],
      now,
    ),
  /invalid fetched_at/,
);

const oosViolation: ViolationInput = {
  id: "vehicle-maintenance",
  violationCode: "393.75",
  description: "Tire",
  basicCategory: "vehicle_maintenance",
  severityWeight: 8,
  oosViolation: true,
  convicted: null,
  citationNumber: null,
  citationResult: null,
  inspectionDate: "2026-06-19",
  state: "CA",
  inspectionLevel: "1",
};
const challengeableResult: AssessmentResult = {
  violationId: oosViolation.id,
  tier: "moderate",
  challengeable: true,
  reason: "A record-specific defect is documented.",
  priority: "medium",
  confidence: 80,
  suggestedApproach: "Submit the documented correction.",
};
const elevated = applyVehicleOosPriorityContext(
  [challengeableResult],
  [oosViolation],
  {
    carrierVehicleOosRate: 21.1,
    nationalVehicleOosRate: 20,
  },
);
assert.equal(elevated[0].priority, "high");
assert.match(elevated[0].reason, /Priority elevated/);
const noBasisCreated = applyVehicleOosPriorityContext(
  [{ ...challengeableResult, challengeable: false, tier: "operational" }],
  [oosViolation],
  {
    carrierVehicleOosRate: 21.1,
    nationalVehicleOosRate: 20,
  },
);
assert.equal(noBasisCreated[0].challengeable, false);
assert.equal(noBasisCreated[0].priority, "medium");

assert.deepEqual(
  countInspectionLevels([
    { level: "3" },
    { level: "1" },
    { level: "3" },
    { level: null },
  ]),
  [
    { level: "1", count: 1 },
    { level: "3", count: 2 },
    { level: "Unknown", count: 1 },
  ],
);

const sourceUpdate = buildCarrierProfileEnrichmentUpdate({
  source_url: "https://example.test/source",
  source_as_of: null,
  fetched_at: now.toISOString(),
  currentness: "current",
  data: { authority: "Active" },
  parser_version: "test-v1",
});
assert.deepEqual(Object.keys(sourceUpdate), [
  ...CARRIER_PROFILE_ENRICHMENT_WRITE_COLUMNS,
]);
assert.equal(
  "citation_number" in sourceUpdate ||
    "carrier_operation" in sourceUpdate ||
    "cargo_types" in sourceUpdate,
  false,
  "source-scoped enrichment must not write existing census/evidence columns",
);
assert.throws(
  () =>
    buildCarrierProfileEnrichmentUpdate({
      source_url: "",
      source_as_of: null,
      fetched_at: now.toISOString(),
      currentness: "current",
      data: {},
      parser_version: "test-v1",
    }),
  /source_url is required/,
);

console.log(
  JSON.stringify(
    {
      cadence: {
        missing_sources_due: [...CARRIER_ENRICHMENT_SOURCES],
        six_days_23h_59m: "fresh",
        exact_seven_days: "due",
        malformed_timestamp: "failed_loudly",
      },
      inspection_level_counts: countInspectionLevels([
        { level: "3" },
        { level: "1" },
        { level: "3" },
        { level: null },
      ]),
      write_columns: CARRIER_PROFILE_ENRICHMENT_WRITE_COLUMNS,
      cross_source_overwrite_columns_present: false,
      oos_priority_rule: {
        elevated_vehicle_maintenance: elevated[0].priority,
        created_challenge_basis: false,
      },
    },
    null,
    2,
  ),
);
