import assert from "node:assert/strict";
import {
  BURDEN_SNAPSHOT_MAX_AGE_MS,
  decideBurdenSnapshot,
  type BurdenSnapshotMetrics,
  type LatestBurdenSnapshot,
} from "../lib/monitoring/snapshot";
import { planRefreshAlerts } from "../lib/monitoring/alert-planner";
import { SUBSCRIPTION_TIERS, tierHasFeature } from "../lib/tiers";

const now = new Date("2026-07-21T13:00:00.000Z");
const current: BurdenSnapshotMetrics = {
  totalPoints: 599,
  violationCount: 74,
  inspectionCount: 75,
  crashCount: 4,
};

function latestAt(ageMs: number): LatestBurdenSnapshot {
  return {
    ...current,
    capturedAt: new Date(now.getTime() - ageMs).toISOString(),
  };
}

const proofs: Record<string, unknown> = {};

assert.deepEqual(SUBSCRIPTION_TIERS, ["monitor", "remediate", "total_safety"]);
assert.equal(
  (SUBSCRIPTION_TIERS as readonly string[]).includes("assessment"),
  false
);
assert.equal(tierHasFeature("assessment", "monitoring_alerts"), false);
assert.equal(tierHasFeature("monitor", "monitoring_alerts"), true);
assert.equal(tierHasFeature("monitor", "case_visibility"), false);
assert.equal(tierHasFeature("remediate", "case_visibility"), true);
assert.equal(tierHasFeature("total_safety", "case_visibility"), true);
proofs.cronTierPolicy = {
  processedTiers: SUBSCRIPTION_TIERS,
  assessmentProcessed: false,
  monitorReceivesMonitoring: true,
  monitorReceivesChallengeabilityAssessment: false,
  remediateReceivesChallengeabilityAssessment: true,
  totalSafetyReceivesChallengeabilityAssessment: true,
};

const initial = decideBurdenSnapshot({ current, latest: null, now });
assert.equal(initial.shouldInsert, true);
assert.equal(initial.reason, "initial");
proofs.initial = initial;

const justUnder28Days = decideBurdenSnapshot({
  current,
  latest: latestAt(BURDEN_SNAPSHOT_MAX_AGE_MS - 1),
  now,
});
assert.equal(justUnder28Days.shouldInsert, false);
assert.equal(justUnder28Days.reason, "unchanged");
proofs.justUnder28Days = justUnder28Days;

const exactly28Days = decideBurdenSnapshot({
  current,
  latest: latestAt(BURDEN_SNAPSHOT_MAX_AGE_MS),
  now,
});
assert.equal(exactly28Days.shouldInsert, true);
assert.equal(exactly28Days.reason, "max_age");
proofs.exactly28Days = exactly28Days;

for (const field of [
  "totalPoints",
  "violationCount",
  "inspectionCount",
  "crashCount",
] as const) {
  const changed = decideBurdenSnapshot({
    current: { ...current, [field]: current[field] + 1 },
    latest: latestAt(1),
    now,
  });
  assert.equal(changed.shouldInsert, true);
  assert.equal(changed.reason, "metrics_changed");
  assert.deepEqual(changed.changedFields, [field]);
  proofs[`${field}Changed`] = changed;
}

const currentWithDifferentOos = { ...current, oosCount: 9 };
const latestWithDifferentOos = { ...latestAt(1), oosCount: 8 };
const oosOnlyChange = decideBurdenSnapshot({
  current: currentWithDifferentOos,
  latest: latestWithDifferentOos,
  now,
});
assert.equal(oosOnlyChange.shouldInsert, false);
assert.equal(oosOnlyChange.reason, "unchanged");
proofs.oosOnlyChange = oosOnlyChange;

assert.throws(
  () =>
    decideBurdenSnapshot({
      current,
      latest: { ...current, capturedAt: "not-a-date" },
      now,
    }),
  /valid current and captured-at timestamps/
);
proofs.invalidTimestamp = "rejected";

const alertCandidates = planRefreshAlerts({
  clientId: "client-1",
  newViolationIds: ["v-oos", "v-weight", "v-normal"],
  newCrashIds: ["crash-new"],
  violations: [
    {
      id: "v-oos",
      violation_code: "395.8",
      violation_description: "False record of duty status",
      basic_category: "hos_compliance",
      severity_weight: 7,
      oos_violation: true,
      inspections: { inspection_date: "2026-07-20" },
    },
    {
      id: "v-weight",
      violation_code: "393.75",
      violation_description: "Flat tire",
      basic_category: "vehicle_maintenance",
      severity_weight: 8,
      oos_violation: false,
      inspections: [{ inspection_date: "2026-07-19" }],
    },
    {
      id: "v-normal",
      violation_code: "392.2",
      violation_description: "Local law",
      basic_category: "unsafe_driving",
      severity_weight: 3,
      oos_violation: false,
      inspections: { inspection_date: "2026-07-18" },
    },
    {
      id: "v-preexisting",
      violation_code: "396.3",
      violation_description: "Pre-existing row must not emit",
      basic_category: "vehicle_maintenance",
      severity_weight: 10,
      oos_violation: true,
      inspections: { inspection_date: "2026-07-17" },
    },
  ],
  crashes: [
    {
      id: "crash-new",
      report_number: "CA-1",
      crash_date: "2026-07-16",
      city: "Fremont",
      state: "CA",
      fatalities: 0,
      injuries: 1,
      tow_away: true,
    },
    {
      id: "crash-preexisting",
      report_number: "CA-OLD",
      crash_date: "2026-06-01",
      city: "Oakland",
      state: "CA",
      fatalities: 1,
      injuries: 0,
      tow_away: true,
    },
  ],
});
assert.deepEqual(
  alertCandidates.map((candidate) => candidate.entityId),
  ["v-oos", "v-weight", "v-normal", "crash-new"]
);
assert.deepEqual(
  alertCandidates.map((candidate) => candidate.severity),
  ["critical", "critical", "info", "critical"]
);
assert.equal(alertCandidates.some((candidate) => candidate.entityId === "v-preexisting"), false);
assert.equal(alertCandidates.some((candidate) => candidate.entityId === "crash-preexisting"), false);
proofs.alertEmission = {
  mockedInsertedViolationIds: ["v-oos", "v-weight", "v-normal"],
  mockedInsertedCrashIds: ["crash-new"],
  emittedEntityIds: alertCandidates.map((candidate) => candidate.entityId),
  severities: alertCandidates.map((candidate) => candidate.severity),
  preexistingRowsEmitted: false,
};

console.log(
  JSON.stringify(
    {
      passed: true,
      cases: proofs,
    },
    null,
    2
  )
);
