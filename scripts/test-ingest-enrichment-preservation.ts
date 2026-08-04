import assert from "node:assert/strict";
import {
  CRASH_ENRICHMENT_COLUMNS,
  INSPECTION_ENRICHMENT_COLUMNS,
  VIOLATION_ENRICHMENT_COLUMNS,
  buildPublicScoreSnapshotUpdate,
  buildPublicViolationUpdate,
  compactSourceFields,
  planDetailViolationWrites,
  type DetailViolationCandidate,
  type PublicViolationSource,
} from "../lib/fmcsa/ingest-write-policy";

const publicViolation: PublicViolationSource = {
  violation_description: "Public-source description",
  basic_category: "vehicle_maintenance",
  severity_weight: 8,
  time_weight: 3,
  oos_violation: false,
};

assert.deepEqual(VIOLATION_ENRICHMENT_COLUMNS, [
  "convicted",
  "citation_number",
  "citation_result",
  "challengeable",
  "challenge_tier",
  "challenge_reason",
  "challenge_priority",
  "ai_assessed_at",
]);
assert.deepEqual(INSPECTION_ENRICHMENT_COLUMNS, [
  "mcmis_inspection_id",
  "start_time",
  "end_time",
  "location_text",
  "facility_name",
  "post_accident_indicator",
  "raw_data",
]);
assert.deepEqual(CRASH_ENRICHMENT_COLUMNS, [
  "preventable",
  "cpdp_eligible",
  "cpdp_eligible_types",
  "ai_assessed_at",
]);

const publicPatch = buildPublicViolationUpdate({
  ...publicViolation,
  convicted: true,
  citation_number: null,
  citation_result: null,
  challengeable: null,
  challenge_tier: null,
  challenge_reason: null,
  challenge_priority: null,
  ai_assessed_at: null,
} as PublicViolationSource);

assert.deepEqual(publicPatch, publicViolation);
for (const column of VIOLATION_ENRICHMENT_COLUMNS) {
  assert.equal(column in publicPatch, false, `Public update included ${column}`);
}

const existingEnrichment = {
  id: "violation-live-id",
  convicted: null,
  citation_number: "DA251770",
  citation_result: "Dismissed",
  challengeable: true,
  challenge_tier: "strong",
  challenge_reason: "Court disposition supports review.",
  challenge_priority: "high",
  ai_assessed_at: "2026-06-16T12:00:00.000Z",
};
const afterPublicRefresh = { ...existingEnrichment, ...publicPatch };
for (const column of VIOLATION_ENRICHMENT_COLUMNS) {
  assert.deepEqual(afterPublicRefresh[column], existingEnrichment[column]);
}

const detailCandidate: DetailViolationCandidate = {
  inspection_id: "inspection-1",
  client_id: "client-1",
  violation_code: "39345B2BVAC",
  violation_description: "Brake tubing and hose adequacy",
  basic_category: "vehicle_maintenance",
  severity_weight: 4,
  time_weight: 3,
  oos_violation: false,
  citation_number: null,
  citation_result: null,
};

const nullCitationPlan = planDetailViolationWrites(
  [
    {
      id: existingEnrichment.id,
      inspection_id: detailCandidate.inspection_id,
      violation_code: detailCandidate.violation_code,
    },
  ],
  [detailCandidate]
);
assert.deepEqual(Object.keys(nullCitationPlan).sort(), ["inserts", "updates"]);
assert.equal(nullCitationPlan.updates.length, 1);
assert.equal(nullCitationPlan.inserts.length, 0);
assert.equal(nullCitationPlan.updates[0].id, existingEnrichment.id);
assert.equal("citation_number" in nullCitationPlan.updates[0].payload, false);
assert.equal("citation_result" in nullCitationPlan.updates[0].payload, false);
assert.equal(
  { ...existingEnrichment, ...nullCitationPlan.updates[0].payload }.citation_number,
  "DA251770"
);

const resultUpdatePlan = planDetailViolationWrites(
  [
    {
      id: existingEnrichment.id,
      inspection_id: detailCandidate.inspection_id,
      violation_code: detailCandidate.violation_code,
    },
  ],
  [{ ...detailCandidate, citation_result: "Dismissed" }]
);
assert.equal(resultUpdatePlan.updates[0].id, existingEnrichment.id);
assert.equal(resultUpdatePlan.updates[0].payload.citation_result, "Dismissed");

assert.throws(
  () =>
    planDetailViolationWrites(
      [
        {
          id: "first-id",
          inspection_id: detailCandidate.inspection_id,
          violation_code: detailCandidate.violation_code,
        },
        {
          id: "duplicate-id",
          inspection_id: detailCandidate.inspection_id,
          violation_code: detailCandidate.violation_code,
        },
      ],
      [detailCandidate]
    ),
  /Ambiguous existing violation key/
);
assert.throws(
  () =>
    planDetailViolationWrites([], [
      detailCandidate,
      { ...detailCandidate, violation_code: "393.45B2B-VAC" },
    ]),
  /Ambiguous incoming violation key/
);

assert.deepEqual(
  compactSourceFields({
    nullValue: null,
    missingValue: undefined,
    empty: "",
    blank: "   ",
    falseValue: false,
    zeroValue: 0,
    text: "present",
  }),
  {
    falseValue: false,
    zeroValue: 0,
    text: "present",
  }
);

const authenticatedScorePatch = buildPublicScoreSnapshotUpdate(
  {
    client_id: "client-1",
    snapshot_date: "2026-07-22",
    source: "api",
    unsafe_driving_measure: 5.25,
    unsafe_driving_pct: 78,
    unsafe_driving_alert: true,
    official_basics: { unsafe_driving: { percentile: 78 } },
    source_file_hash: "public-must-not-replace-authenticated",
    oos_vehicle_rate: 10.5,
    oos_driver_rate: 0,
    oos_hazmat_rate: 2.5,
  },
  "authenticated"
);
assert.deepEqual(authenticatedScorePatch, {
  oos_vehicle_rate: 10.5,
  oos_driver_rate: 0,
  oos_hazmat_rate: 2.5,
});

console.log(
  JSON.stringify(
    {
      passed: true,
      publicViolationColumns: Object.keys(publicPatch),
      preservedViolationEnrichment: [...VIOLATION_ENRICHMENT_COLUMNS],
      detailMerge: {
        retainedId: nullCitationPlan.updates[0].id,
        inserts: nullCitationPlan.inserts.length,
        nullCitationOmitted: true,
        nonNullCitationResultApplied: resultUpdatePlan.updates[0].payload.citation_result,
        duplicateKeysRejected: true,
      },
      authenticatedScoreColumnsUpdated: Object.keys(authenticatedScorePatch),
    },
    null,
    2
  )
);
