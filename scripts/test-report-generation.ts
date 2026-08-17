import assert from "node:assert/strict";
import {
  ASSESSMENT_NEXT_STEPS_COPY,
  FIRST_REPORTING_PERIOD_STATEMENT,
  PREPARER_BLOCK,
  QUARTERLY_FIRST_REPORTING_PERIOD_STATEMENT,
  REPORT_SECTION_HEADINGS,
  REPORT_TYPE_CONFIGS,
  UNDERWRITER_TOTAL_SAFETY_COPY,
  assembleGeneratedReport,
  buildReportGenerationData,
  buildReportPrompts,
  findReportPlaceholders,
  generateValidatedReport,
  selectComparisonSnapshot,
  selectReportSnapshots,
  summarizeOpenReportRequests,
  validateGeneratedReport,
  type ReportCaseRow,
  type ReportGenerationData,
  type ReportOpenRequestRow,
  type ReportPriorityViolationRow,
  type ReportSnapshotRow,
  type ReportType,
} from "../lib/reports/report-generation";

function snapshot(
  id: string,
  capturedAt: string,
  totalPoints: number,
  basics: ReportSnapshotRow["per_basic"] = [
    {
      basic_category: "vehicle_maintenance",
      violation_count: 4,
      weighted_points: totalPoints - 20,
    },
    {
      basic_category: "unsafe_driving",
      violation_count: 2,
      weighted_points: 20,
    },
  ]
): ReportSnapshotRow {
  return {
    id,
    snapshot_date: capturedAt.slice(0, 10),
    captured_at: capturedAt,
    source: "scheduled_refresh",
    total_points: totalPoints,
    per_basic: basics,
    violation_count: 8,
    inspection_count: 6,
    crash_count: 2,
    oos_count: 1,
  };
}

const latest = snapshot("latest", "2026-08-13T13:00:00.000Z", 120);
const monthlyAnchor = snapshot("monthly-anchor", "2026-07-14T13:00:00.000Z", 150);
const quarterlyAnchor = snapshot("quarterly-anchor", "2026-05-15T13:00:00.000Z", 190);
const earliest = snapshot("earliest", "2026-04-01T13:00:00.000Z", 210);

const priorityViolations: ReportPriorityViolationRow[] = [
  {
    id: "strong",
    violation_code: "3922SLLS4",
    violation_description: "Speeding",
    basic_category: "unsafe_driving",
    severity_weight: 10,
    oos_violation: false,
    convicted: false,
    citation_number: "CITE-1",
    citation_result: "dismissed",
    challenge_reason: null,
    challenge_tier: "strong",
    inspection_date: "2026-07-13",
  },
  {
    id: "investigate",
    violation_code: "39530B1",
    violation_description: "ELD certification",
    basic_category: "hos_compliance",
    severity_weight: 4,
    oos_violation: false,
    convicted: null,
    citation_number: null,
    citation_result: null,
    challenge_reason: null,
    challenge_tier: "investigate",
    inspection_date: "2026-06-01",
  },
  {
    id: "operational",
    violation_code: "39375A3",
    violation_description: "Tire tread depth",
    basic_category: "vehicle_maintenance",
    severity_weight: 8,
    oos_violation: true,
    convicted: null,
    citation_number: null,
    citation_result: null,
    challenge_reason: null,
    challenge_tier: "operational",
    inspection_date: "2026-07-01",
  },
];

const cases: ReportCaseRow[] = [
  {
    case_type: "DataQ",
    case_number: null,
    status: "draft",
    description: "DRAFT MUST NEVER APPEAR",
  },
  {
    case_type: "DataQ",
    case_number: null,
    status: "investigating",
    description: "Pre-filing investigation",
  },
  {
    case_type: "DataQ",
    case_number: "6103911",
    status: "filed",
    description: "ELD record review",
    filed_date: "2026-05-29",
  },
  {
    case_type: "CPDP",
    case_number: "6123719",
    status: "filed",
    description: `Lane-change crash request involving a preventability review. ${"The stored factual record documents the crash circumstances without adding an outcome prediction. ".repeat(8)}`,
    filed_date: "2026-06-09",
  },
  {
    case_type: "DataQ",
    case_number: "RESOLVED-1",
    status: "approved",
    description: "Resolved work",
    filed_date: "2026-03-01",
    outcome: "approved",
    outcome_date: "2026-05-01",
  },
];

const openRequests: ReportOpenRequestRow[] = [
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `request-${index}`,
    title: `Certified court disposition — CODE${index}`,
    status: "open",
    request_type: "evidence",
    evidence_class: "citation-dismissed",
    evidence_status: "open",
    violation_code: `CODE${index}`,
    requested_items: [{ label: "Certified court disposition" }],
  })),
  {
    id: "question",
    title: "Has a roadside ticket been dismissed?",
    status: "open",
    request_type: "question",
    evidence_class: "citation-dismissed",
    evidence_status: "open",
    violation_code: null,
    requested_items: [],
  },
  {
    id: "closed",
    title: "Closed request",
    status: "fulfilled",
    request_type: "evidence",
    evidence_class: "duplicate",
    evidence_status: "applied",
    violation_code: "CLOSED",
    requested_items: [{ label: "Inspection record" }],
  },
];

function dataFor(
  reportType: ReportType,
  selectedSnapshots?: ReportSnapshotRow[],
  serviceTier: "assessment" | "monitor" | "remediate" | "total_safety" =
    "total_safety"
): ReportGenerationData {
  const selection =
    selectedSnapshots ??
    selectReportSnapshots(
      [quarterlyAnchor, latest, earliest, monthlyAnchor],
      reportType
    ).snapshots;
  return buildReportGenerationData({
    reportType,
    reportDate: "August 17, 2026",
    serviceTier,
    carrier: {
      name: "Test Carrier",
      dotNumber: "1234567",
      mcNumber: "765432",
      fleet: {
        clientStatedDriverCount: 5,
        fmcsaPowerUnits: 40,
        fmcsaDrivers: 45,
        annualMileage: 1_417_456,
        annualMileageYear: 2025,
        source: "FMCSA SAFER",
        sourceAsOf: "2026-08-16",
      },
    },
    snapshots: selection,
    newViolations: [
      {
        id: "new-1",
        violation_code: "39375A3",
        violation_description: "Tire tread depth",
        severity_weight: 8,
        oos_violation: true,
        inspection_date: "2026-07-20",
      },
    ],
    agedOutViolationCount: 2,
    onFileViolationCount: 9,
    priorityViolations,
    priorityAsOf: new Date("2026-08-13T13:00:00Z"),
    cases,
    crashes: [
      {
        crash_date: "2026-01-01",
        state: "CA",
        report_number: "CA-1",
        tow_away: true,
      },
      {
        crash_date: "2026-02-01",
        state: "NV",
        report_number: "NV-2",
        tow_away: false,
      },
    ],
    openRequests,
    clientEvidenceItemsCollected: 3,
  });
}

function caseSentence(reportCase: ReportCaseRow): string {
  const reference = reportCase.case_number
    ? `${reportCase.case_type} case ${reportCase.case_number}`
    : `${reportCase.case_type} case with no stored case number`;
  return `${reference} is ${reportCase.status}.${reportCase.outcome ? ` Its stored outcome is ${reportCase.outcome}.` : ""}`;
}

function caseDescriptionSentence(reportCase: ReportCaseRow): string[] {
  const description = reportCase.description?.trim();
  if (!description) return [];
  const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? description;
  return [`Case summary from stored facts: ${firstSentence}`];
}

function validModelBody(data: ReportGenerationData): string {
  const lines: string[] = [];
  const fixedKeys = new Set(Object.keys(data.fixedSections));
  for (const section of data.sections) {
    if (fixedKeys.has(section.key)) continue;
    lines.push(section.heading);
    switch (section.key) {
      case "safetyProfileOverview":
        lines.push(
          `${data.carrier.name}, USDOT ${data.carrier.dotNumber}. ${data.diagnosticSnapshot.requiredViolationScopeSentence}`,
          `${data.latestSnapshot.inspectionCount} inspections, ${data.latestSnapshot.crashCount} crashes, and ${data.latestSnapshot.oosCount} out-of-service violations are on the latest snapshot. The current weighted violation burden is ${data.latestSnapshot.totalPoints}.`
        );
        break;
      case "whereBurdenSits":
        lines.push(
          ...data.latestSnapshot.perBasic.map(
            (basic) =>
              `${basic.label}: ${basic.violationCount} ${basic.violationCount === 1 ? "violation" : "violations"} and ${basic.weightedPoints} weighted points.`
          )
        );
        break;
      case "crashRecord":
        lines.push(
          ...data.crashes.map(
            (crash) =>
              `${crash.crashDate}, ${crash.state ?? "state not recorded"}, report ${crash.reportNumber}, tow-away ${crash.towAway ? "yes" : "no"}.`
          )
        );
        break;
      case "whatWeRecommend":
        lines.push(
          ...(data.priorityFindings?.challengeableViolations.map(
            (violation) =>
              `DataQ recommendation: ${violation.violationCode} — ${violation.violationDescription}; ${violation.challengeLane}; ${violation.weightedPoints} weighted ${violation.weightedPoints === 1 ? "point" : "points"}${violation.inspectionDate ? `; inspection date ${violation.inspectionDate}` : ""}.`
          ) ?? []),
          ...(data.priorityFindings?.topOperationalFamilies.map(
            (family) =>
              `Coaching priority: ${family.familyName} — ${family.violationCount} ${family.violationCount === 1 ? "violation" : "violations"}, ${family.weightedPoints} weighted points, ${family.inflowRatePerMonth} violations per month over the trailing window.`
          ) ?? [])
        );
        break;
      case "burdenTrend":
        lines.push(
          `Weighted violation burden moved from ${data.comparisonSnapshot?.totalPoints} to ${data.latestSnapshot.totalPoints}, a change of ${data.comparison!.totalPointsDelta! > 0 ? "+" : ""}${data.comparison!.totalPointsDelta} points.`,
          ...(data.reportType === "quarterly"
            ? data.comparison!.perBasicDeltas.map(
                (basic) =>
                  `${basic.label}: ${basic.previousWeightedPoints} weighted points before and ${basic.latestWeightedPoints} now.`
              )
            : data.comparison!.perBasicDeltas
                .filter((basic) => basic.weightedPointsDelta !== 0)
                .map(
                  (basic) =>
                    `${basic.label} moved from ${basic.previousWeightedPoints} to ${basic.latestWeightedPoints} weighted points, a change of ${basic.weightedPointsDelta > 0 ? "+" : ""}${basic.weightedPointsDelta}.`
                ))
        );
        break;
      case "diagnosticSnapshot":
        lines.push(
          `${data.diagnosticSnapshot.requiredViolationScopeSentence} The current weighted violation burden is ${data.latestSnapshot.totalPoints}.`
        );
        break;
      case "newViolations":
        if (data.comparison?.newViolations.length) {
          lines.push(
            ...data.comparison.newViolations.map(
              (violation) =>
                `${violation.code}: ${violation.description}; severity weight ${violation.severityWeight}; OOS ${violation.oos ? "yes" : "no"}; inspection date ${violation.inspectionDate}.`
            )
          );
        } else {
          lines.push(
            data.comparison?.firstReportingPeriod
              ? "This is the first reporting period; new-violation comparison begins next report."
              : "No new violations were added during this reporting period."
          );
        }
        break;
      case "changesThisQuarter":
        lines.push(data.comparison!.requiredChangeStatement!);
        break;
      case "priorityFindings":
        lines.push(
          ...(data.openRequests?.requiredSummarySentences ?? []),
          ...(data.comparison?.newViolations.length === 0
            ? [
                data.priorityFindings?.requiredFallbackFacts
                  ?.investigateSentence ?? null,
                ...(data.priorityFindings?.requiredFallbackFacts
                  ?.operationalFamilySentences ?? []),
              ].filter((sentence): sentence is string => Boolean(sentence))
            : []),
          "Current priorities are grounded in the supplied weighted violation burden."
        );
        break;
      case "openChallenges":
        lines.push(
          ...data.cases.flatMap((item) => [
            item.case_type === "CPDP"
              ? `${caseSentence(item)} This is a crash preventability case.`
              : caseSentence(item),
            ...caseDescriptionSentence(item),
          ])
        );
        break;
      case "engagementSummary":
        lines.push(
          `SafeScore measurement baseline: ${data.serviceBaselineDate}; starting weighted violation burden ${data.comparisonSnapshot?.totalPoints}; starting in-window violation count ${data.comparisonSnapshot?.violationCountInScoringWindow}.`
        );
        break;
      case "measuredImprovement":
        {
          const violationReduction = data.comparison!.violationCountReduction ?? 0;
          const violationChange =
            violationReduction > 0
              ? `a reduction of ${violationReduction}`
              : violationReduction < 0
                ? `a worsening of ${Math.abs(violationReduction)}`
                : "no change";
        lines.push(
          `Measured weighted violation burden change: ${data.comparisonSnapshot?.totalPoints} to ${data.latestSnapshot.totalPoints}, ${data.comparison!.totalPointsReduction! >= 0 ? `a reduction of ${data.comparison!.totalPointsReduction}` : `a worsening of ${Math.abs(data.comparison!.totalPointsReduction!)}`} points.`,
          ...data.comparison!.perBasicDeltas.map((basic) =>
            basic.weightedPointsReduction >= 0
              ? `${basic.label}: ${basic.previousWeightedPoints} to ${basic.latestWeightedPoints} weighted points, a reduction of ${basic.weightedPointsReduction}.`
              : `${basic.label}: ${basic.previousWeightedPoints} to ${basic.latestWeightedPoints} weighted points, a worsening of ${Math.abs(basic.weightedPointsReduction)}.`
          ),
          `Measured in-window violation count change: ${data.comparisonSnapshot?.violationCountInScoringWindow} to ${data.latestSnapshot.violationCountInScoringWindow}, ${violationChange}.`
        );
        }
        break;
      case "workPerformed":
      case "remediationWorkCompleted":
        lines.push(
          ...data.cases.map((item) =>
            item.case_type === "CPDP"
              ? `${caseSentence(item)} This is crash preventability work.`
              : caseSentence(item)
          ),
          ...(data.reportType === "improvement" &&
          data.clientEvidenceItemsCollected > 0
            ? [
                `Client evidence items collected for filed-or-beyond cases: ${data.clientEvidenceItemsCollected}.`,
              ]
            : [])
        );
        break;
      case "currentStanding":
        lines.push(
          `Current standing: ${data.latestSnapshot.totalPoints} weighted violation burden and ${data.latestSnapshot.violationCountInScoringWindow} in-window violations.`
        );
        break;
      case "currentSafetyStanding":
        lines.push(
          `Current safety standing: weighted violation burden ${data.latestSnapshot.totalPoints}, compared with ${data.comparisonSnapshot?.totalPoints} at the SafeScore measurement baseline; ${data.latestSnapshot.violationCountInScoringWindow} violations are in the scoring window.`
        );
        break;
      case "carrierOverview":
        lines.push(
          `Carrier: ${data.carrier.name}; USDOT ${data.carrier.dotNumber}; MC ${data.carrier.mcNumber}.`,
          `FMCSA fleet facts: ${data.carrier.fleet.fmcsaPowerUnits} power units and ${data.carrier.fleet.fmcsaDrivers} drivers as of ${data.carrier.fleet.sourceAsOf}.`
        );
        break;
      default:
        throw new Error(`Unhandled model section ${section.key}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

const expectedConfigs = {
  assessment: ["client onboarding", "none", 700, false, true],
  monthly: ["client", "anchor", 500, true, true],
  quarterly: ["client", "anchor", 700, true, true],
  improvement: ["external insurance re-marketing", "baseline", 400, false, false],
  underwriter: ["insurance carrier underwriting", "baseline", 400, false, false],
} as const;
const expectedSections: Record<ReportType, string[]> = {
  assessment: [
    "safetyProfileOverview",
    "whereBurdenSits",
    "crashRecord",
    "whatWeRecommend",
    "whatHappensNext",
  ],
  monthly: [
    "burdenTrend",
    "diagnosticSnapshot",
    "newViolations",
    "priorityFindings",
    "openChallenges",
  ],
  quarterly: [
    "burdenTrend",
    "diagnosticSnapshot",
    "changesThisQuarter",
    "priorityFindings",
    "openChallenges",
  ],
  improvement: [
    "engagementSummary",
    "measuredImprovement",
    "workPerformed",
    "currentStanding",
  ],
  underwriter: [
    "carrierOverview",
    "remediationWorkCompleted",
    "currentSafetyStanding",
    "ongoingSafetyManagement",
  ],
};
assert.deepEqual(Object.keys(REPORT_TYPE_CONFIGS), Object.keys(expectedConfigs));
for (const type of Object.keys(expectedConfigs) as ReportType[]) {
  const config = REPORT_TYPE_CONFIGS[type];
  const expected = expectedConfigs[type];
  assert.deepEqual(
    [
      config.audience,
      config.comparison.mode,
      config.wordBudget,
      config.includeOpenRequests,
      config.includeOperationalPriorities,
    ],
    expected
  );
  assert.deepEqual(config.sections, expectedSections[type]);
}
assert.deepEqual(REPORT_TYPE_CONFIGS.monthly.comparison, {
  mode: "anchor",
  targetDaysBack: 30,
  minDaysBack: 14,
});
assert.deepEqual(REPORT_TYPE_CONFIGS.quarterly.comparison, {
  mode: "anchor",
  targetDaysBack: 90,
  minDaysBack: 45,
});

const closest = selectComparisonSnapshot(
  [
    latest,
    snapshot("too-young", "2026-08-01T13:00:00.000Z", 130),
    snapshot("near-target", "2026-07-15T13:00:00.000Z", 140),
    snapshot("farther", "2026-07-01T13:00:00.000Z", 160),
  ],
  { targetDaysBack: 30, minDaysBack: 14 }
);
assert.equal(closest?.id, "near-target");
assert.equal(
  selectComparisonSnapshot(
    [latest, snapshot("boundary", "2026-07-30T13:00:00.000Z", 130)],
    { targetDaysBack: 30, minDaysBack: 14 }
  )?.id,
  "boundary"
);
assert.equal(
  selectComparisonSnapshot(
    [latest, snapshot("one-ms-young", "2026-07-30T13:00:00.001Z", 130)],
    { targetDaysBack: 30, minDaysBack: 14 }
  ),
  null
);
assert.equal(
  selectReportSnapshots([latest, earliest, monthlyAnchor], "improvement")
    .comparisonSnapshotId,
  earliest.id
);
assert.equal(
  selectReportSnapshots([latest], "improvement").comparisonSnapshotId,
  latest.id
);
assert.equal(
  selectReportSnapshots([latest, monthlyAnchor], "quarterly").strategy,
  "anchor_first_reporting_period"
);
assert.throws(
  () =>
    selectComparisonSnapshot(
      [snapshot("bad", "not-a-date", 1)],
      { targetDaysBack: 30, minDaysBack: 14 }
    ),
  /invalid captured_at/
);

const requestSummary = summarizeOpenReportRequests(openRequests);
assert.equal(requestSummary.rowCount, 9);
assert.equal(requestSummary.evidenceRequestCount, 8);
assert.equal(requestSummary.questionCount, 1);
for (let index = 0; index < 8; index += 1) {
  assert.ok(requestSummary.requiredSummarySentences[0]?.includes(`CODE${index}`));
}
assert.match(requestSummary.requiredSummarySentences[0]!, /visible in your portal/i);
assert.ok(!requestSummary.requiredSummarySentences[0]!.includes("CLOSED"));
assert.ok(requestSummary.requiredSummarySentences[0]!.endsWith("dismissed?"));
assert.ok(!requestSummary.requiredSummarySentences[0]!.endsWith("?."));

for (const type of Object.keys(REPORT_TYPE_CONFIGS) as ReportType[]) {
  const data = dataFor(type);
  const config = REPORT_TYPE_CONFIGS[type];
  assert.deepEqual(
    data.sections.map((section) => section.key),
    config.sections
  );
  assert.ok(data.cases.every((item) => item.status !== "draft"));
  const prompts = buildReportPrompts(data);
  assert.ok(prompts.system.includes(config.audience));
  assert.ok(prompts.user.includes(`approximately ${config.wordBudget} words`));
  assert.ok(
    prompts.system.includes(
      "Every factual claim must come from the structured data. Never state that something does not exist, is not active, or has no records unless the structured data explicitly contains that section with zero rows. Never mention internal statuses, drafts, or systems not present in the structured data."
    )
  );
  const report = assembleGeneratedReport(validModelBody(data), data);
  assert.deepEqual(findReportPlaceholders(report), []);
  assert.deepEqual(validateGeneratedReport(report, data), []);
  assert.equal(report.split(PREPARER_BLOCK).length - 1, 1);
}

const assessment = dataFor("assessment");
const assessmentPrompts = buildReportPrompts(assessment);
assert.equal(assessment.comparison, undefined);
assert.equal(assessment.comparisonSnapshot, null);
assert.deepEqual(Object.keys(assessment.fixedSections), [
  "whatHappensNext",
  "whereBurdenSits",
  "crashRecord",
  "whatWeRecommend",
]);
assert.match(
  assessmentPrompts.user,
  /Required model-written section headings:\nSafety Profile Overview\n/
);
assert.match(assessmentPrompts.user, /under 120 words/);
assert.ok(!assessmentPrompts.user.includes("previousSnapshot"));
assert.ok(!assessmentPrompts.user.includes(REPORT_SECTION_HEADINGS.burdenTrend));
assert.ok(!assessmentPrompts.user.includes('"comparisonSnapshot"'));
assert.ok(!assessmentPrompts.user.includes('"clientEvidenceItemsCollected"'));
const assessmentReport = assembleGeneratedReport(
  validModelBody(assessment),
  assessment
);
assert.ok(assessmentReport.endsWith(PREPARER_BLOCK));
assert.equal(assessmentReport.split(ASSESSMENT_NEXT_STEPS_COPY).length - 1, 1);
for (const heading of [
  REPORT_SECTION_HEADINGS.whereBurdenSits,
  REPORT_SECTION_HEADINGS.crashRecord,
  REPORT_SECTION_HEADINGS.whatWeRecommend,
]) {
  assert.equal(assessmentReport.split(heading).length - 1, 1);
}
assert.ok(!assessmentReport.includes(FIRST_REPORTING_PERIOD_STATEMENT));
assert.equal(assessment.latestSnapshot.perBasic.length, 7);
assert.deepEqual(
  assessment.latestSnapshot.perBasic.map((basic) => basic.label),
  [
    "Vehicle Maintenance",
    "Unsafe Driving",
    "Controlled Substances/Alcohol",
    "Crash Indicator",
    "Driver Fitness",
    "Hazardous Materials Compliance",
    "Hours-of-Service Compliance",
  ]
);
assert.deepEqual(
  assessment.latestSnapshot.perBasic.slice(2).map((basic) => [
    basic.violationCount,
    basic.weightedPoints,
  ]),
  Array.from({ length: 5 }, () => [0, 0])
);
const assessmentWithoutRecommendations = assessmentReport.replace(
  /DataQ recommendation:[^\n]+\n?|Coaching priority:[^\n]+\n?/g,
  ""
);
assert.ok(
  validateGeneratedReport(assessmentWithoutRecommendations, assessment).some(
    (issue) => issue.includes("assessment recommendation")
  )
);
assert.ok(
  validateGeneratedReport(
    assessmentReport.replace(
      REPORT_SECTION_HEADINGS.crashRecord,
      `${REPORT_SECTION_HEADINGS.crashRecord}\nCompared with the previous period, the record improved.`
    ),
    assessment
  ).some((issue) => issue.includes("forbidden comparison-period language"))
);

const quarterlyFirst = dataFor("quarterly", [latest]);
assert.equal(quarterlyFirst.comparison?.firstReportingPeriod, true);
const quarterlyFirstReport = assembleGeneratedReport(
  validModelBody(quarterlyFirst),
  quarterlyFirst
);
assert.ok(quarterlyFirstReport.includes(QUARTERLY_FIRST_REPORTING_PERIOD_STATEMENT));
assert.deepEqual(validateGeneratedReport(quarterlyFirstReport, quarterlyFirst), []);

const improvement = dataFor("improvement");
const improvementPrompt = buildReportPrompts(improvement).user;
assert.equal(improvement.priorityFindings, undefined);
assert.equal(improvement.openRequests, undefined);
assert.ok(!improvementPrompt.includes("CODE0"));
assert.ok(!improvementPrompt.includes("Pre-filing investigation"));
assert.ok(!improvementPrompt.includes("DRAFT MUST NEVER APPEAR"));
assert.ok(!improvementPrompt.includes('"crashes"'));
assert.ok(!improvementPrompt.includes('"openRequests"'));
assert.ok(!improvementPrompt.includes('"priorityFindings"'));
assert.deepEqual(
  improvement.cases.map((item) => item.case_number),
  ["6103911", "6123719", "RESOLVED-1"]
);
assert.ok(improvement.cases.every((item) => item.outcome == null));
const improvementReport = assembleGeneratedReport(
  validModelBody(improvement),
  improvement
);
assert.ok(
  validateGeneratedReport(
    improvementReport.replace(
      /Measured in-window violation count change:[^\n]+\n?/,
      ""
    ),
    improvement
  ).some((issue) => issue.includes("Measured in-window violation count change"))
);

const underwriter = dataFor("underwriter");
const underwriterPrompt = buildReportPrompts(underwriter).user;
assert.ok(!underwriterPrompt.includes('"openRequests"'));
assert.ok(!underwriterPrompt.includes('"priorityFindings"'));
assert.ok(!underwriterPrompt.includes('"clientEvidenceItemsCollected"'));
assert.equal(
  underwriter.cases.find((item) => item.case_number === "RESOLVED-1")?.outcome,
  "approved"
);
assert.equal(
  underwriter.fixedSections.ongoingSafetyManagement,
  UNDERWRITER_TOTAL_SAFETY_COPY
);
const lowerTierUnderwriter = dataFor(
  "underwriter",
  undefined,
  "remediate"
);
assert.ok(
  !lowerTierUnderwriter.sections.some(
    (section) => section.key === "ongoingSafetyManagement"
  )
);

const validMonthly = dataFor("monthly");
const validMonthlyReport = assembleGeneratedReport(
  validModelBody(validMonthly),
  validMonthly
);
const longStoredDescription = validMonthly.cases.find(
  (item) => item.case_type === "CPDP"
)?.description;
assert.ok(longStoredDescription && longStoredDescription.length >= 500);
assert.ok(buildReportPrompts(validMonthly).user.includes(longStoredDescription));
assert.ok(!validMonthlyReport.includes(longStoredDescription));
assert.deepEqual(validateGeneratedReport(validMonthlyReport, validMonthly), []);
const bulletCaseReport = validMonthlyReport.replace(
  "DataQ case 6103911 is filed.",
  "- **DataQ case 6103911** (filed): concise summary from the stored facts."
);
assert.deepEqual(validateGeneratedReport(bulletCaseReport, validMonthly), []);
assert.ok(
  validateGeneratedReport(
    bulletCaseReport.replace("(filed): concise", "(submitted): concise"),
    validMonthly
  ).some((issue) => issue.includes("case type, number, or status is missing"))
);
assert.ok(
  validateGeneratedReport(
    validMonthlyReport.replace(
      "This is a crash preventability case.",
      `This is a crash preventability case. ${longStoredDescription}`
    ),
    validMonthly
  ).some((issue) => issue.includes("copied verbatim instead of summarized"))
);
assert.ok(
  validateGeneratedReport(
    validMonthlyReport.replace(
      `${REPORT_SECTION_HEADINGS.openChallenges}\n`,
      `${REPORT_SECTION_HEADINGS.openChallenges}\nDRAFT internal work.\n`
    ),
    validMonthly
  ).some((issue) => issue.includes("forbidden draft language"))
);
assert.ok(
  validateGeneratedReport(
    validMonthlyReport.replace(
      REPORT_SECTION_HEADINGS.priorityFindings,
      `## Additional Notes\nSomething.\n\n${REPORT_SECTION_HEADINGS.priorityFindings}`
    ),
    validMonthly
  ).some((issue) => issue.includes("extra section heading Additional Notes"))
);
for (const extraHeading of ["Additional Notes:", "**Additional Notes**"]) {
  assert.ok(
    validateGeneratedReport(
      validMonthlyReport.replace(
        REPORT_SECTION_HEADINGS.priorityFindings,
        `${extraHeading}\nSomething.\n\n${REPORT_SECTION_HEADINGS.priorityFindings}`
      ),
      validMonthly
    ).some((issue) => issue.includes("extra section heading Additional Notes"))
  );
}
assert.ok(
  validateGeneratedReport(
    validMonthlyReport.replace(
      `${REPORT_SECTION_HEADINGS.newViolations}\n`,
      ""
    ),
    validMonthly
  ).some((issue) => issue.includes("missing required section heading"))
);
for (const phrase of [
  "evidence pending",
  "under investigation",
  "Operational priority",
]) {
  const invalid = assembleGeneratedReport(
    `${validModelBody(improvement)}\n${phrase}.`,
    improvement
  );
  assert.ok(
    validateGeneratedReport(invalid, improvement).some((issue) =>
      issue.toLowerCase().includes("forbidden external-report phrase")
    )
  );
}
for (const phrase of [
  "evidence requests",
  "client weakness rankings",
  "operations queue",
]) {
  const invalid = assembleGeneratedReport(
    `${validModelBody(improvement)}\n${phrase}.`,
    improvement
  );
  assert.ok(
    validateGeneratedReport(invalid, improvement).some((issue) =>
      issue.toLowerCase().includes("forbidden")
    )
  );
}
const pendingImprovement = assembleGeneratedReport(
  `${validModelBody(improvement)}\nBoth cases remain pending resolution.`,
  improvement
);
assert.ok(
  validateGeneratedReport(pendingImprovement, improvement).some((issue) =>
    issue.toLowerCase().includes("forbidden pending")
  )
);
const misstatedCaseTiming = assembleGeneratedReport(
  validModelBody(improvement).replace(
    `${REPORT_SECTION_HEADINGS.workPerformed}\n`,
    `${REPORT_SECTION_HEADINGS.workPerformed}\nThese cases were filed during the engagement.\n`
  ),
  improvement
);
assert.ok(
  validateGeneratedReport(misstatedCaseTiming, improvement).some((issue) =>
    issue.toLowerCase().includes("misstates pre-baseline")
  )
);
assert.ok(
  validateGeneratedReport(
    assembleGeneratedReport(
      validModelBody(improvement).replace(
        "Current standing:",
        "Open cases remain. Current standing:"
      ),
      improvement
    ),
    improvement
  ).some((issue) => issue.includes("Current Standing"))
);

async function testRetryAndPrint() {
  const events: string[] = [];
  const generated = await generateValidatedReport(
    buildReportPrompts(validMonthly),
    validMonthly,
    async ({ attempt }) =>
      attempt === 1
        ? `${validModelBody(validMonthly)}\n\n[placeholder]`
        : validModelBody(validMonthly),
    {
      onAttempt(event) {
        events.push(`${event.attempt}:${event.status}`);
      },
    }
  );
  assert.equal(generated.attempts, 2);
  assert.deepEqual(events, [
    "1:started",
    "1:failed",
    "2:started",
    "2:succeeded",
  ]);
  const providerEvents: string[] = [];
  const recoveredProviderFailure = await generateValidatedReport(
    buildReportPrompts(validMonthly),
    validMonthly,
    async ({ attempt }) => {
      if (attempt === 1) throw new Error("Transient provider truncation.");
      return validModelBody(validMonthly);
    },
    {
      onAttempt(event) {
        providerEvents.push(`${event.attempt}:${event.status}`);
      },
    }
  );
  assert.equal(recoveredProviderFailure.attempts, 2);
  assert.deepEqual(providerEvents, [
    "1:started",
    "1:failed",
    "2:started",
    "2:succeeded",
  ]);
  await assert.rejects(
    generateValidatedReport(
      buildReportPrompts(validMonthly),
      validMonthly,
      async () => {
        throw new Error("Provider remains unavailable.");
      }
    ),
    /failed after 3 attempts: Provider remains unavailable/
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        reportTypes: Object.keys(REPORT_TYPE_CONFIGS),
        monthlyAnchorId: selectReportSnapshots(
          [quarterlyAnchor, latest, earliest, monthlyAnchor],
          "monthly"
        ).comparisonSnapshotId,
        quarterlyFirstPeriod: selectReportSnapshots(
          [latest, monthlyAnchor],
          "quarterly"
        ).strategy,
        baselineId: selectReportSnapshots(
          [latest, earliest, monthlyAnchor],
          "improvement"
        ).comparisonSnapshotId,
        openRequestRowsProven: requestSummary.rowCount,
        allTypesValidated: true,
        retryAttemptsProven: generated.attempts,
        providerRetryAttemptsProven: recoveredProviderFailure.attempts,
      },
      null,
      2
    )
  );
}

testRetryAndPrint().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
