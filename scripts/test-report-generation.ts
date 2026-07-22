import assert from "node:assert/strict";
import {
  FIRST_REPORTING_PERIOD_STATEMENT,
  PREPARER_BLOCK,
  buildReportGenerationData,
  buildReportPrompts,
  findReportPlaceholders,
  formatReportDate,
  generateValidatedReport,
  validateGeneratedReport,
  type ReportSnapshotRow,
} from "../lib/reports/report-generation";

async function main() {
const latest: ReportSnapshotRow = {
  id: "latest",
  snapshot_date: "2026-07-21",
  captured_at: "2026-07-21T22:58:57.243Z",
  total_points: 599,
  per_basic: [
    {
      basic_category: "unsafe_driving",
      violation_count: 9,
      weighted_points: 113,
    },
    {
      basic_category: "vehicle_maintenance",
      violation_count: 44,
      weighted_points: 402,
    },
    {
      basic_category: "driver_fitness",
      violation_count: 1,
      weighted_points: 4,
    },
    {
      basic_category: "hos_compliance",
      violation_count: 20,
      weighted_points: 80,
    },
  ],
  violation_count: 74,
  inspection_count: 76,
  crash_count: 4,
  oos_count: 10,
};

const previous: ReportSnapshotRow = {
  id: "previous",
  snapshot_date: "2026-07-10",
  captured_at: "2026-07-10T19:16:07.814Z",
  total_points: 582,
  per_basic: [
    {
      basic_category: "driver_fitness",
      violation_count: 1,
      weighted_points: 4,
    },
    {
      basic_category: "vehicle_maintenance",
      violation_count: 42,
      weighted_points: 375,
    },
    {
      basic_category: "hos_compliance",
      violation_count: 20,
      weighted_points: 80,
    },
    {
      basic_category: "unsafe_driving",
      violation_count: 9,
      weighted_points: 123,
    },
  ],
  violation_count: 72,
  inspection_count: 73,
  crash_count: 4,
  oos_count: 9,
};

const reportDate = formatReportDate(new Date("2026-07-21T12:00:00Z"));
assert.equal(reportDate, "July 21, 2026");

const data = buildReportGenerationData({
  reportType: "monthly",
  reportDate,
  carrier: {
    name: "Nationwide Carrier Inc",
    dotNumber: "2533650",
    mcNumber: "880750",
  },
  snapshots: [latest, previous],
  newViolations: [
    {
      id: "v-tire",
      violation_code: "39375A3TAOLTIS",
      violation_description: "Tire description",
      severity_weight: 8,
      oos_violation: false,
      inspection_date: "2026-06-19",
    },
    {
      id: "v-hub",
      violation_code: "3965BHWSL",
      violation_description: "Hubs - Wheel seal leaking",
      severity_weight: 2,
      oos_violation: true,
      inspection_date: "2026-06-19",
    },
  ],
  cases: [
    {
      case_type: "DataQ",
      case_number: "6103911",
      status: "filed",
      description: "Stored DataQ description",
    },
    {
      case_type: "CPDP",
      case_number: "6123719",
      status: "filed",
      description: "Stored crash preventability description",
    },
    {
      case_type: "DataQ",
      case_number: "closed-case",
      status: "closed",
      description: null,
    },
  ],
});

assert.equal(data.comparison.totalPointsDelta, 17);
assert.equal(data.comparison.violationCountDelta, 2);
assert.equal(data.comparison.inspectionCountDelta, 3);
assert.equal(data.comparison.crashCountDelta, 0);
assert.equal(data.comparison.oosCountDelta, 1);
assert.equal(data.comparison.firstReportingPeriod, false);
assert.equal(data.comparison.newViolations.length, 2);
assert.deepEqual(
  data.cases.map((item) => [
    item.case_type,
    item.case_number,
    item.status,
    item.description,
  ]),
  [
    ["DataQ", "6103911", "filed", "Stored DataQ description"],
    ["CPDP", "6123719", "filed", "Stored crash preventability description"],
    ["DataQ", "closed-case", "closed", null],
  ]
);

const vehicle = data.comparison.perBasicDeltas.find(
  (item) => item.basicCategory === "vehicle_maintenance"
);
const unsafe = data.comparison.perBasicDeltas.find(
  (item) => item.basicCategory === "unsafe_driving"
);
assert.deepEqual(
  {
    points: vehicle?.weightedPointsDelta,
    count: vehicle?.violationCountDelta,
  },
  { points: 27, count: 2 }
);
assert.deepEqual(
  {
    points: unsafe?.weightedPointsDelta,
    count: unsafe?.violationCountDelta,
  },
  { points: -10, count: 0 }
);

const firstPeriodData = buildReportGenerationData({
  reportType: "monthly",
  reportDate,
  carrier: data.carrier,
  snapshots: [latest],
  newViolations: [],
  cases: [],
});
assert.equal(firstPeriodData.comparison.firstReportingPeriod, true);
assert.equal(firstPeriodData.comparison.totalPointsDelta, null);
assert.deepEqual(firstPeriodData.comparison.perBasicDeltas, []);
assert.deepEqual(firstPeriodData.comparison.newViolations, []);
assert.equal(
  firstPeriodData.comparison.requiredFirstPeriodStatement,
  FIRST_REPORTING_PERIOD_STATEMENT
);

const prompts = buildReportPrompts(data);
assert.match(prompts.system, /Use only facts present in the structured report data/);
assert.match(prompts.system, /If a datum is absent or null, omit the sentence/);
assert.ok(prompts.system.includes(PREPARER_BLOCK));
assert.ok(prompts.user.includes('"totalPointsDelta": 17'));
assert.ok(prompts.user.includes('"caseNumber"') === false);
assert.ok(prompts.user.includes('"case_number": "6103911"'));
for (const forbidden of [
  "[Insert Date]",
  "changed by [X] points",
  "[Your Name]",
  "[briefly describe",
]) {
  assert.ok(!`${prompts.system}\n${prompts.user}`.includes(forbidden));
}

const eighty = "x".repeat(80);
const scannerInput = `[Insert Date] [X] [VERIFY: fact] [label] [${eighty}]`;
assert.deepEqual(findReportPlaceholders(scannerInput), [
  "[Insert Date]",
  "[X]",
  "[VERIFY: fact]",
  "[label]",
  `[${eighty}]`,
]);
assert.deepEqual(findReportPlaceholders(scannerInput), [
  "[Insert Date]",
  "[X]",
  "[VERIFY: fact]",
  "[label]",
  `[${eighty}]`,
]);
assert.deepEqual(findReportPlaceholders("[]"), []);
assert.deepEqual(findReportPlaceholders(`[${"x".repeat(81)}]`), []);
assert.deepEqual(findReportPlaceholders("[line\nbreak]"), []);

const validReport = `Monthly progress report\n${reportDate}\nBurden rose from 582 to 599, an increase of 17 points.\n${PREPARER_BLOCK}`;
assert.deepEqual(validateGeneratedReport(validReport, data), []);

const retrySystems: string[] = [];
const retryResponses = [
  `Report dated [Insert Date]\n${PREPARER_BLOCK}`,
  `Report changed by [X] points on ${reportDate}\n${PREPARER_BLOCK}`,
  validReport,
];
const retried = await generateValidatedReport(
  prompts,
  data,
  async ({ system, attempt }) => {
    retrySystems.push(system);
    return retryResponses[attempt - 1];
  }
);
assert.equal(retried.attempts, 3);
assert.equal(retrySystems.length, 3);
assert.ok(!retrySystems[0].includes("Corrective system note"));
assert.ok(retrySystems[1].includes("Corrective system note"));
assert.ok(retrySystems[2].includes("Corrective system note"));
assert.deepEqual(findReportPlaceholders(retrySystems[1]), []);
assert.deepEqual(findReportPlaceholders(retrySystems[2]), []);

let failedAttempts = 0;
await assert.rejects(
  generateValidatedReport(prompts, data, async () => {
    failedAttempts += 1;
    return `Report [still unresolved]\n${reportDate}\n${PREPARER_BLOCK}`;
  }),
  /failed validation after 3 attempts: forbidden bracketed token/
);
assert.equal(failedAttempts, 3);

const missingFirstPeriodStatement = `First report\n${reportDate}\n${PREPARER_BLOCK}`;
assert.ok(
  validateGeneratedReport(missingFirstPeriodStatement, firstPeriodData).includes(
    "missing the required first-reporting-period statement"
  )
);
assert.deepEqual(
  validateGeneratedReport(
    `${missingFirstPeriodStatement}\n${FIRST_REPORTING_PERIOD_STATEMENT}`,
    firstPeriodData
  ),
  []
);

console.log(
  JSON.stringify(
    {
      passed: true,
      reportDate,
      totalPoints: { previous: 582, latest: 599, delta: 17 },
      perBasic: {
        vehicleMaintenance: { pointsDelta: 27, countDelta: 2 },
        unsafeDriving: { pointsDelta: -10, countDelta: 0 },
      },
      newViolationCodes: data.comparison.newViolations.map((item) => item.code),
      casesPreserved: data.cases.length,
      firstPeriodStatement: FIRST_REPORTING_PERIOD_STATEMENT,
      placeholderRetryAttempts: retried.attempts,
      terminalFailureAttempts: failedAttempts,
    },
    null,
    2
  )
);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
