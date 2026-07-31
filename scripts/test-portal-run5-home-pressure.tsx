import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BasicPressureList } from "../components/portal/basic-pressure-list";
import type { ViolationRow } from "../lib/analysis/basic-measure";
import { buildPortalHomePressureDetails } from "../lib/portal/home-pressure";

const asOf = new Date("2026-07-26T13:01:36.005Z");
const rows: ViolationRow[] = [
  {
    id: "vm-30",
    violationCode: "39375A3",
    violationDescription: "Tire tread depth below the required minimum",
    basicCategory: "vehicle_maintenance",
    severityWeight: 8,
    oosViolation: true,
    inspectionDate: "2026-06-19",
  },
  {
    id: "vm-18",
    violationCode: "39375B",
    violationDescription: "Tire inflation issue",
    basicCategory: "vehicle_maintenance",
    severityWeight: 6,
    oosViolation: false,
    inspectionDate: "2026-06-19",
  },
  {
    id: "vm-27",
    violationCode: "3965B",
    violationDescription: "Wheel seal condition",
    basicCategory: "vehicle_maintenance",
    severityWeight: 9,
    oosViolation: false,
    inspectionDate: "2026-05-01",
  },
  {
    id: "vm-3",
    violationCode: "3939",
    violationDescription: null,
    basicCategory: "vehicle_maintenance",
    severityWeight: 1,
    oosViolation: false,
    inspectionDate: "2026-04-01",
  },
  {
    id: "aged-out",
    violationCode: "39375",
    violationDescription: "Aged out",
    basicCategory: "vehicle_maintenance",
    severityWeight: 10,
    oosViolation: true,
    inspectionDate: "2024-07-25",
  },
  {
    id: "ud-12",
    violationCode: "3922C",
    violationDescription: "Traffic-control violation",
    basicCategory: "unsafe_driving",
    severityWeight: 4,
    oosViolation: false,
    inspectionDate: "2026-07-01",
  },
  {
    id: "hos-9",
    violationCode: "3953A3",
    violationDescription: "Driving-hours limit exceeded",
    basicCategory: "hos_compliance",
    severityWeight: 3,
    oosViolation: false,
    inspectionDate: "2026-07-01",
  },
];

const details = buildPortalHomePressureDetails(rows, {
  asOf,
  presentPlaybookFamilies: new Set(["tires_wheels", "driver_behavior"]),
});
const byBasic = new Map(details.map((detail) => [detail.basicCategory, detail]));

assert.deepEqual(
  byBasic
    .get("vehicle_maintenance")!
    .topViolations.map((violation) => [
      violation.id,
      violation.weightedPoints,
    ]),
  [
    ["vm-30", 30],
    ["vm-27", 27],
    ["vm-18", 18],
  ]
);
assert.equal(byBasic.get("vehicle_maintenance")!.hasCoachingPlan, true);
assert.equal(byBasic.get("unsafe_driving")!.hasCoachingPlan, true);
assert.equal(byBasic.get("hos_compliance")!.hasCoachingPlan, false);
assert.equal(
  byBasic
    .get("vehicle_maintenance")!
    .topViolations.some((violation) => violation.id === "aged-out"),
  false
);

const markup = renderToStaticMarkup(
  createElement(BasicPressureList, {
    basics: [
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
    ],
    details,
    totalPoints: 549,
  })
);
assert.equal((markup.match(/<button/g) ?? []).length, 2);
assert.match(markup, /aria-expanded="false"/);
assert.match(markup, /371 weighted points/);
assert.match(markup, /67\.6% of total burden/);

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const componentSource = source("components/portal/basic-pressure-list.tsx");
const serverSource = source("lib/portal/home-server.ts");
const pageSource = source("app/(portal)/portal/page.tsx");

assert.equal(
  (
    serverSource.match(
      /id, violation_code, violation_description, basic_category, severity_weight, oos_violation, inspections!inner\(inspection_date, mcmis_inspection_id\)/g
    ) ?? []
  ).length,
  1,
  "All BASIC details must come from one violations+inspections query shape"
);
assert.doesNotMatch(serverSource, /\.eq\("basic_category"/);
assert.match(serverSource, /getCanonicalInspectionScope/);
assert.match(serverSource, /snapshotCapturedAt/);
assert.match(componentSource, /role="tooltip"/);
assert.match(componentSource, /aria-expanded=\{expanded\}/);
assert.match(componentSource, /focus-visible:ring-2/);
assert.match(componentSource, /min-h-10/);
assert.match(componentSource, /document\.addEventListener\("pointerdown"/);
assert.match(componentSource, /event\.key === "Escape"/);
assert.match(componentSource, /role="region"/);
assert.match(componentSource, /useReducedMotion/);
assert.match(componentSource, /href="\/portal\/playbook"/);
assert.match(pageSource, /loadPortalHomePressureDetails/);
assert.match(pageSource, /snapshotCapturedAt: latest\.captured_at/);

console.log(
  JSON.stringify(
    {
      passed: true,
      asOf: asOf.toISOString(),
      topVehicleMaintenance: byBasic
        .get("vehicle_maintenance")!
        .topViolations.map((violation) => ({
          code: violation.code,
          points: violation.weightedPoints,
        })),
      queryShape: "one canonical violations+inspections read for every BASIC",
      interactions: [
        "hover/focus/tap tooltip",
        "accordion expansion",
        "tap-away tooltip dismissal",
        "conditional coaching link",
      ],
    },
    null,
    2
  )
);
