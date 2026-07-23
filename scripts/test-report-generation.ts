import assert from "node:assert/strict";
import type { ClientTier } from "../lib/supabase/types";
import {
  FIRST_REPORTING_PERIOD_STATEMENT,
  PREPARER_BLOCK,
  REPORT_SECTION_HEADINGS,
  assembleGeneratedReport,
  buildReportGenerationData,
  buildReportPrompts,
  findReportPlaceholders,
  formatReportDate,
  generateValidatedReport,
  normalizeModelSectionHeadings,
  selectReportSnapshotPair,
  validateGeneratedReport,
  type ReportCaseRow,
  type ReportCoachingItemRow,
  type ReportComplianceInput,
  type ReportGenerationData,
  type ReportSnapshotRow,
  type ReportViolationRow,
} from "../lib/reports/report-generation";

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

const newViolations: ReportViolationRow[] = [
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
];

const cases: ReportCaseRow[] = [
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
    description: "Closed case must not appear as an open challenge",
  },
];

const coachingItems: ReportCoachingItemRow[] = [
  {
    type: "compliance",
    title: "Coach tire inspections",
    description: "Review tire condition during each pre-trip inspection.",
    priority: "high",
    projected_impact_score: 42,
    status: "in_progress",
    due_date: "2026-08-01",
  },
];

const compliance: ReportComplianceInput = {
  drivers: [
    {
      cdl_number: "TEST-CDL",
      cdl_expiry: "2027-06-01",
      medical_cert_expiry: null,
    },
  ],
  driverDocuments: [
    { doc_type: "medical_certificate", expiry_date: "2026-09-01", status: "expiring" },
  ],
  vehicles: [{ id: "vehicle-1" }],
  maintenanceRecords: [
    {
      maintenance_type: "preventive maintenance",
      scheduled_date: "2026-07-30",
      completed_date: null,
      notes: "Tire and lamp review",
    },
  ],
  clearinghouseRecords: [{ query_date: "2026-07-01", result_type: "negative" }],
};

const reportDate = formatReportDate(new Date("2026-07-21T12:00:00Z"));

function buildTierData(
  serviceTier: ClientTier,
  overrides: Partial<{
    snapshots: ReportSnapshotRow[];
    newViolations: ReportViolationRow[];
    cases: ReportCaseRow[];
    coachingItems: ReportCoachingItemRow[];
    compliance: ReportComplianceInput;
  }> = {}
): ReportGenerationData {
  return buildReportGenerationData({
    reportType: serviceTier === "assessment" ? "assessment" : "monthly",
    reportDate,
    serviceTier,
    carrier: {
      name: "Nationwide Carrier Inc",
      dotNumber: "2533650",
      mcNumber: "880750",
    },
    snapshots: overrides.snapshots ?? [latest, previous],
    newViolations: overrides.newViolations ?? newViolations,
    cases: overrides.cases ?? cases,
    coachingItems: overrides.coachingItems ?? coachingItems,
    compliance: overrides.compliance ?? compliance,
  });
}

function headings(data: ReportGenerationData): string[] {
  return data.sections.map((section) => section.heading);
}

function validModelBody(data: ReportGenerationData): string {
  const modelSections = data.sections.filter(
    (section) =>
      !(data.comparison?.firstReportingPeriod && section.key === "burdenTrend")
  );
  const grounding = data.cases.some((reportCase) => reportCase.case_type === "CPDP")
    ? "Weighted violation burden is documented. CPDP crash preventability work is documented."
    : "Weighted violation burden is documented.";
  return modelSections
    .map((section, index) => `${section.heading}\n${index === 0 ? grounding : "Documented data only."}`)
    .join("\n\n");
}

async function main() {
  assert.equal(reportDate, "July 21, 2026");

  const sameDayEarlier: ReportSnapshotRow = {
    ...latest,
    id: "same-day-earlier",
    snapshot_date: "2026-07-22",
    captured_at: "2026-07-22T13:00:29.131Z",
    total_points: 590,
  };
  const sameDayLatest: ReportSnapshotRow = {
    ...latest,
    id: "same-day-latest",
    snapshot_date: "2026-07-22",
    captured_at: "2026-07-22T16:39:49.928Z",
    total_points: 550,
  };
  const distinctDateSelection = selectReportSnapshotPair(
    [sameDayEarlier, previous, sameDayLatest, latest],
    true
  );
  assert.equal(distinctDateSelection.strategy, "prior_distinct_date");
  assert.deepEqual(distinctDateSelection.immediatePairIds, [
    "same-day-latest",
    "same-day-earlier",
  ]);
  assert.deepEqual(
    distinctDateSelection.snapshots.map((snapshot) => snapshot.id),
    ["same-day-latest", "latest"]
  );
  const sameDayFallback = selectReportSnapshotPair(
    [sameDayEarlier, sameDayLatest],
    true
  );
  assert.equal(sameDayFallback.strategy, "same_day_fallback");
  assert.deepEqual(
    sameDayFallback.snapshots.map((snapshot) => snapshot.id),
    ["same-day-latest", "same-day-earlier"]
  );
  assert.equal(
    selectReportSnapshotPair([sameDayEarlier, sameDayLatest], false).strategy,
    "latest_only"
  );
  assert.throws(
    () =>
      selectReportSnapshotPair(
        [{ ...sameDayLatest, id: "invalid-date", captured_at: "not-a-date" }],
        true
      ),
    /invalid captured_at timestamp/
  );

  const assessment = buildTierData("assessment");
  const monitor = buildTierData("monitor");
  const remediate = buildTierData("remediate");
  const totalSafety = buildTierData("total_safety");

  assert.deepEqual(headings(assessment), [
    REPORT_SECTION_HEADINGS.diagnosticSnapshot,
    REPORT_SECTION_HEADINGS.priorityFindings,
  ]);
  assert.equal(assessment.previousSnapshot, null);
  assert.equal(assessment.comparison, null);
  assert.deepEqual(assessment.cases, []);
  assert.deepEqual(assessment.coachingProgram, []);
  assert.equal(assessment.complianceSweep, null);

  assert.deepEqual(headings(monitor), [
    REPORT_SECTION_HEADINGS.burdenTrend,
    REPORT_SECTION_HEADINGS.diagnosticSnapshot,
    REPORT_SECTION_HEADINGS.priorityFindings,
    REPORT_SECTION_HEADINGS.newViolations,
  ]);
  assert.equal(monitor.comparison?.totalPointsDelta, 17);
  assert.equal(monitor.comparison?.violationCountDelta, 2);
  assert.equal(monitor.comparison?.inspectionCountDelta, 3);
  assert.equal(monitor.comparison?.crashCountDelta, 0);
  assert.equal(monitor.comparison?.oosCountDelta, 1);
  assert.equal(monitor.comparison?.newViolations.length, 2);
  assert.deepEqual(monitor.cases, []);
  assert.deepEqual(monitor.coachingProgram, []);
  assert.equal(monitor.complianceSweep, null);

  assert.deepEqual(headings(remediate), [
    REPORT_SECTION_HEADINGS.burdenTrend,
    REPORT_SECTION_HEADINGS.diagnosticSnapshot,
    REPORT_SECTION_HEADINGS.priorityFindings,
    REPORT_SECTION_HEADINGS.newViolations,
    REPORT_SECTION_HEADINGS.openChallenges,
    REPORT_SECTION_HEADINGS.coachingProgram,
  ]);
  assert.deepEqual(
    remediate.cases.map((reportCase) => reportCase.case_number),
    ["6103911", "6123719"]
  );
  assert.equal(remediate.coachingProgram[0]?.title, "Coach tire inspections");
  assert.equal(remediate.complianceSweep, null);

  assert.deepEqual(headings(totalSafety), [
    REPORT_SECTION_HEADINGS.burdenTrend,
    REPORT_SECTION_HEADINGS.diagnosticSnapshot,
    REPORT_SECTION_HEADINGS.priorityFindings,
    REPORT_SECTION_HEADINGS.newViolations,
    REPORT_SECTION_HEADINGS.openChallenges,
    REPORT_SECTION_HEADINGS.coachingProgram,
    REPORT_SECTION_HEADINGS.complianceSweep,
  ]);
  assert.equal(totalSafety.complianceSweep?.activeDriverCount, 1);
  assert.equal(totalSafety.complianceSweep?.driversMissingQualificationData, 1);
  assert.equal(totalSafety.complianceSweep?.activeVehicleCount, 1);

  const noOptionalRemediation = buildTierData("remediate", {
    cases: [],
    coachingItems: [],
  });
  assert.ok(!headings(noOptionalRemediation).includes(REPORT_SECTION_HEADINGS.openChallenges));
  assert.ok(!headings(noOptionalRemediation).includes(REPORT_SECTION_HEADINGS.coachingProgram));
  const noCompliance = buildTierData("total_safety", {
    compliance: {
      drivers: [],
      driverDocuments: [],
      vehicles: [],
      maintenanceRecords: [],
      clearinghouseRecords: [],
    },
  });
  assert.ok(!headings(noCompliance).includes(REPORT_SECTION_HEADINGS.complianceSweep));

  const vehicle = monitor.comparison?.perBasicDeltas.find(
    (item) => item.basicCategory === "vehicle_maintenance"
  );
  const unsafe = monitor.comparison?.perBasicDeltas.find(
    (item) => item.basicCategory === "unsafe_driving"
  );
  assert.deepEqual(
    { points: vehicle?.weightedPointsDelta, count: vehicle?.violationCountDelta },
    { points: 27, count: 2 }
  );
  assert.deepEqual(
    { points: unsafe?.weightedPointsDelta, count: unsafe?.violationCountDelta },
    { points: -10, count: 0 }
  );

  const assessmentPrompts = buildReportPrompts(assessment);
  const monitorPrompts = buildReportPrompts(monitor);
  const totalSafetyPrompts = buildReportPrompts(totalSafety);
  assert.match(totalSafetyPrompts.system, /Use only facts present in the structured report data/);
  assert.match(totalSafetyPrompts.system, /If a datum is absent or null, omit the sentence/);
  assert.match(totalSafetyPrompts.system, /server adds those fixed fields exactly/);
  assert.ok(!totalSafetyPrompts.system.includes(PREPARER_BLOCK));
  assert.ok(totalSafetyPrompts.user.includes(JSON.stringify(PREPARER_BLOCK)));
  assert.ok(totalSafetyPrompts.user.includes('"totalPointsDelta": 17'));
  assert.ok(totalSafetyPrompts.user.includes('"case_number": "6103911"'));
  assert.ok(!assessmentPrompts.user.includes("6103911"));
  assert.ok(!assessmentPrompts.user.includes("Coach tire inspections"));
  assert.ok(!monitorPrompts.user.includes("6103911"));
  assert.ok(!monitorPrompts.user.includes("Coach tire inspections"));
  for (const forbidden of [
    "[Insert Date]",
    "changed by [X] points",
    "[Your Name]",
    "[briefly describe",
  ]) {
    assert.ok(!`${totalSafetyPrompts.system}\n${totalSafetyPrompts.user}`.includes(forbidden));
  }

  const assessmentReport = assembleGeneratedReport(validModelBody(assessment), assessment);
  assert.deepEqual(validateGeneratedReport(assessmentReport, assessment), []);
  assert.ok(!assessmentReport.includes(FIRST_REPORTING_PERIOD_STATEMENT));
  assert.ok(!assessmentReport.includes(REPORT_SECTION_HEADINGS.burdenTrend));

  const validBody = validModelBody(totalSafety);
  const markdownDecoratedBody = totalSafety.sections.reduce(
    (body, section) =>
      body.replace(
        `${section.heading}\n`,
        `## **${section.heading}**  \n`
      ),
    validBody
  );
  const normalizedMarkdownBody = normalizeModelSectionHeadings(
    markdownDecoratedBody,
    totalSafety.sections
  );
  for (const section of totalSafety.sections) {
    assert.ok(normalizedMarkdownBody.includes(`${section.heading}\n`));
    assert.ok(!normalizedMarkdownBody.includes(`**${section.heading}**`));
  }
  const markdownDecoratedReport = await generateValidatedReport(
    buildReportPrompts(totalSafety),
    totalSafety,
    async () => markdownDecoratedBody
  );
  assert.equal(markdownDecoratedReport.attempts, 1);
  assert.deepEqual(
    validateGeneratedReport(markdownDecoratedReport.content, totalSafety),
    []
  );
  const validReport = assembleGeneratedReport(validBody, totalSafety);
  assert.deepEqual(validateGeneratedReport(validReport, totalSafety), []);
  assert.ok(validReport.startsWith(`Monthly progress report\nReport date: ${reportDate}`));
  assert.ok(validReport.endsWith(PREPARER_BLOCK));
  assert.ok(
    validateGeneratedReport(
      assembleGeneratedReport(
        validBody.replace("CPDP crash preventability", "CPDP"),
        totalSafety
      ),
      totalSafety
    ).includes("missing the required crash preventability description for CPDP")
  );
  assert.ok(
    validateGeneratedReport(
      assembleGeneratedReport(validBody.replace("Weighted violation burden", "SMS points"), totalSafety),
      totalSafety
    ).includes("mislabels weighted violation burden as SMS points")
  );

  const forbiddenHeadingReport = assembleGeneratedReport(
    `${validModelBody(assessment)}\n\n${REPORT_SECTION_HEADINGS.openChallenges}\nNot allowed.`,
    assessment
  );
  assert.ok(
    validateGeneratedReport(forbiddenHeadingReport, assessment).includes(
      `forbidden section heading ${REPORT_SECTION_HEADINGS.openChallenges}`
    )
  );
  const missingHeadingReport = assembleGeneratedReport(
    validBody.replace(`${REPORT_SECTION_HEADINGS.complianceSweep}\nDocumented data only.`, ""),
    totalSafety
  );
  assert.ok(
    validateGeneratedReport(missingHeadingReport, totalSafety).includes(
      `missing required section heading ${REPORT_SECTION_HEADINGS.complianceSweep}`
    )
  );

  const firstPeriodMonitor = buildTierData("monitor", {
    snapshots: [latest],
    newViolations: [],
  });
  assert.equal(firstPeriodMonitor.comparison?.firstReportingPeriod, true);
  assert.equal(firstPeriodMonitor.comparison?.totalPointsDelta, null);
  assert.deepEqual(firstPeriodMonitor.comparison?.perBasicDeltas, []);
  assert.deepEqual(firstPeriodMonitor.comparison?.newViolations, []);
  assert.equal(
    firstPeriodMonitor.comparison?.requiredFirstPeriodStatement,
    FIRST_REPORTING_PERIOD_STATEMENT
  );
  const firstPeriodGenerated = await generateValidatedReport(
    buildReportPrompts(firstPeriodMonitor),
    firstPeriodMonitor,
    async () => validModelBody(firstPeriodMonitor)
  );
  assert.equal(
    firstPeriodGenerated.content.split(FIRST_REPORTING_PERIOD_STATEMENT).length - 1,
    1
  );
  assert.equal(
    firstPeriodGenerated.content.split(REPORT_SECTION_HEADINGS.burdenTrend).length - 1,
    1
  );
  const missingFirstPeriodStatement = `Monthly progress report\nReport date: ${reportDate}\n\n${validModelBody(
    firstPeriodMonitor
  )}\n\n${PREPARER_BLOCK}`;
  assert.ok(
    validateGeneratedReport(missingFirstPeriodStatement, firstPeriodMonitor).includes(
      "missing the required first-reporting-period statement"
    )
  );

  const eighty = "x".repeat(80);
  const scannerInput = `[Insert Date] [X] [VERIFY: fact] [label] [${eighty}]`;
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

  const assembledOnFirstAttempt = await generateValidatedReport(
    totalSafetyPrompts,
    totalSafety,
    async () => validBody
  );
  assert.equal(assembledOnFirstAttempt.attempts, 1);
  assert.equal(assembledOnFirstAttempt.content.split(PREPARER_BLOCK).length - 1, 1);

  const retrySystems: string[] = [];
  const attemptEvents: Array<{
    attempt: number;
    status: string;
    reason: string;
    rawOutput?: string;
  }> = [];
  const retryResponses = [
    "Report dated [Insert Date]",
    "Report changed by [X] points",
    validBody,
  ];
  const retried = await generateValidatedReport(
    totalSafetyPrompts,
    totalSafety,
    async ({ system, attempt }) => {
      retrySystems.push(system);
      return retryResponses[attempt - 1]!;
    },
    {
      onAttempt: async (event) => {
        attemptEvents.push(event);
      },
    }
  );
  assert.equal(retried.attempts, 3);
  assert.equal(retrySystems.length, 3);
  assert.ok(!retrySystems[0]?.includes("Corrective system note"));
  assert.ok(retrySystems[1]?.includes("Corrective system note"));
  assert.ok(retrySystems[2]?.includes("Corrective system note"));
  assert.deepEqual(findReportPlaceholders(retrySystems[1] ?? ""), []);
  assert.deepEqual(findReportPlaceholders(retrySystems[2] ?? ""), []);
  assert.deepEqual(
    attemptEvents.map((event) => `${event.attempt}:${event.status}`),
    [
      "1:started",
      "1:failed",
      "2:started",
      "2:failed",
      "3:started",
      "3:succeeded",
    ]
  );
  assert.equal(attemptEvents[1]?.rawOutput, retryResponses[0]);
  assert.match(attemptEvents[1]?.reason ?? "", /Validation failed/);

  let failedAttempts = 0;
  await assert.rejects(
    generateValidatedReport(totalSafetyPrompts, totalSafety, async () => {
      failedAttempts += 1;
      return "Report [still unresolved]";
    }),
    /failed validation after 3 attempts: forbidden bracketed token/
  );
  assert.equal(failedAttempts, 3);

  let reservedBlockAttempts = 0;
  const reservedBlockRecovery = await generateValidatedReport(
    totalSafetyPrompts,
    totalSafety,
    async () => {
      reservedBlockAttempts += 1;
      return reservedBlockAttempts === 1 ? `Body\n\n${PREPARER_BLOCK}` : validBody;
    }
  );
  assert.equal(reservedBlockRecovery.attempts, 2);
  assert.equal(reservedBlockRecovery.content.split(PREPARER_BLOCK).length - 1, 1);

  console.log(
    JSON.stringify(
      {
        passed: true,
        tiers: {
          assessment: headings(assessment),
          monitor: headings(monitor),
          remediate: headings(remediate),
          totalSafety: headings(totalSafety),
        },
        totalPoints: { previous: 582, latest: 599, delta: 17 },
        openChallenges: remediate.cases.length,
        coachingItems: remediate.coachingProgram.length,
        complianceSourceRows: totalSafety.complianceSweep?.sourceRowCounts,
        assessmentHasFirstPeriodBoilerplate: assessmentReport.includes(
          FIRST_REPORTING_PERIOD_STATEMENT
        ),
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
