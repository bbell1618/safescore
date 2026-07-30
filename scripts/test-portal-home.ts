import assert from "node:assert/strict";
import {
  buildChangeNarrative,
  buildSparklinePoints,
  inWindowViolationCount,
  preferredAuthorityStatus,
  pressureLevel,
  pressureWidth,
  snapshotDeltaLabel,
  type PortalHomeSnapshot,
} from "../lib/portal/home";

function snapshot(
  overrides: Partial<PortalHomeSnapshot> = {}
): PortalHomeSnapshot {
  return {
    id: "snapshot",
    snapshot_date: "2026-07-26",
    captured_at: "2026-07-26T13:01:36.005Z",
    source: "scheduled_refresh",
    total_points: 549,
    per_basic: [
      {
        basic_category: "vehicle_maintenance",
        violation_count: 41,
        weighted_points: 371,
      },
      {
        basic_category: "unsafe_driving",
        violation_count: 8,
        weighted_points: 103,
      },
      {
        basic_category: "hos_compliance",
        violation_count: 17,
        weighted_points: 71,
      },
      {
        basic_category: "driver_fitness",
        violation_count: 1,
        weighted_points: 4,
      },
    ],
    violation_count: 71,
    inspection_count: 76,
    crash_count: 4,
    oos_count: 9,
    ...overrides,
  };
}

const latest = snapshot();
const previous = snapshot({
  id: "previous",
  snapshot_date: "2026-07-22",
  captured_at: "2026-07-22T16:39:49.928Z",
  total_points: 550,
  per_basic: [
    {
      basic_category: "vehicle_maintenance",
      violation_count: 42,
      weighted_points: 372,
    },
    {
      basic_category: "unsafe_driving",
      violation_count: 8,
      weighted_points: 103,
    },
    {
      basic_category: "hos_compliance",
      violation_count: 17,
      weighted_points: 71,
    },
    {
      basic_category: "driver_fitness",
      violation_count: 1,
      weighted_points: 4,
    },
  ],
});

assert.equal(inWindowViolationCount(latest), 67);
assert.equal(pressureLevel(371, 549), "MAJOR");
assert.equal(pressureLevel(103, 549), "MODERATE");
assert.equal(pressureLevel(71, 549), "MINOR");
assert.equal(pressureLevel(0, 0), "MINOR");
assert.equal(pressureWidth(371, 549), 68);
assert.equal(pressureWidth(1, 549), 6);
assert.equal(pressureWidth(0, 549), 0);
assert.equal(
  preferredAuthorityStatus([
    { status: "Revoked" },
    { status: "Active" },
    { status: "Pending" },
  ]),
  "Active"
);
assert.equal(
  preferredAuthorityStatus([{ status: "Revoked" }, { status: "Pending" }]),
  "Pending"
);
assert.equal(preferredAuthorityStatus([{ status: "" }, null]), null);

assert.equal(snapshotDeltaLabel(latest, previous), "−1 since last snapshot");
assert.equal(snapshotDeltaLabel(latest, null), "First snapshot");
assert.equal(
  snapshotDeltaLabel(latest, snapshot({ total_points: 549 })),
  "No change since last snapshot"
);
assert.equal(
  snapshotDeltaLabel(snapshot({ total_points: 551 }), previous),
  "+1 since last snapshot"
);

const nationwideNarrative = buildChangeNarrative(latest, previous);
assert.deepEqual(nationwideNarrative, [
  "Your weighted burden moved 1 point lower since July 22, 2026.",
  "Vehicle Maintenance led the movement, with 1 in-window violation fewer and 1 weighted point lower.",
  "Your on-file total remains 71 violations.",
  "No inspection, crash, or out-of-service counts changed in this snapshot.",
]);
assert.ok(
  nationwideNarrative.every(
    (sentence) => !sentence.includes("->") && !sentence.includes("→")
  )
);

assert.deepEqual(buildChangeNarrative(null, null), [
  "Your first monitoring snapshot is being prepared. Once it is available, this section will explain what moved and why.",
]);
assert.deepEqual(buildChangeNarrative(latest, null), [
  "Monitoring is active as of July 26, 2026. Your next snapshot will begin the change history.",
]);

const oneViolation = snapshot({
  total_points: 0,
  per_basic: [],
  violation_count: 1,
  inspection_count: 0,
  crash_count: 0,
  oos_count: 0,
});
const unchangedOneViolation = buildChangeNarrative(
  oneViolation,
  snapshot({
    snapshot_date: "2026-07-20",
    total_points: 0,
    per_basic: [],
    violation_count: 1,
    inspection_count: 0,
    crash_count: 0,
    oos_count: 0,
  })
);
assert.ok(unchangedOneViolation.includes("Your on-file total remains 1 violation."));
assert.ok(
  unchangedOneViolation.includes(
    "No inspection, crash, or out-of-service counts changed in this snapshot."
  )
);

const points = buildSparklinePoints([582, 599, 590, 550, 549]);
assert.equal(points.split(" ").length, 5);
assert.ok(!points.includes("NaN"));
assert.equal(buildSparklinePoints([]), "");
assert.equal(buildSparklinePoints([549]), "120,36");

console.log(
  JSON.stringify(
    {
      passed: true,
      nationwide: {
        burden: latest.total_points,
        delta: latest.total_points - previous.total_points,
        inWindowViolations: inWindowViolationCount(latest),
        onFileViolations: latest.violation_count,
        narrative: nationwideNarrative,
      },
      boundaryCopy: "passed",
      sparkline: "passed",
    },
    null,
    2
  )
);
