import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePortalFeatureGate } from "../lib/portal/feature-gate";
import {
  CLIENT_TIERS,
  isSubscriptionTier,
  SUBSCRIPTION_TIERS,
  TIER_FEATURES,
  tierHasFeature,
  type TierFeature,
} from "../lib/tiers";
import {
  buildReportSectionPlan,
  REPORT_SECTION_HEADINGS,
} from "../lib/reports/report-generation";

const expectedFeatureMinimums = {
  monitoring_alerts: "monitor",
  monthly_reports: "monitor",
  trend_history: "monitor",
  case_visibility: "remediate",
  evidence_requests: "remediate",
  playbook_coach: "remediate",
  compliance_layer: "total_safety",
  truth_up_service: "monitor",
} as const;

assert.deepEqual(TIER_FEATURES, expectedFeatureMinimums);
assert.deepEqual(CLIENT_TIERS, [
  "assessment",
  "monitor",
  "remediate",
  "total_safety",
]);
assert.deepEqual(SUBSCRIPTION_TIERS, ["monitor", "remediate", "total_safety"]);
assert.equal(isSubscriptionTier("assessment"), false);
assert.equal(isSubscriptionTier("monitor"), true);

const expectedAllowedFeatures: Record<
  (typeof CLIENT_TIERS)[number],
  TierFeature[]
> = {
  assessment: [],
  monitor: [
    "monitoring_alerts",
    "monthly_reports",
    "trend_history",
    "truth_up_service",
  ],
  remediate: [
    "monitoring_alerts",
    "monthly_reports",
    "trend_history",
    "case_visibility",
    "evidence_requests",
    "playbook_coach",
    "truth_up_service",
  ],
  total_safety: Object.keys(expectedFeatureMinimums) as TierFeature[],
};

const portalMatrix: Record<string, Record<string, boolean>> = {};
for (const tier of CLIENT_TIERS) {
  portalMatrix[tier] = {};
  for (const feature of Object.keys(TIER_FEATURES) as TierFeature[]) {
    const expected = expectedAllowedFeatures[tier].includes(feature);
    assert.equal(tierHasFeature(tier, feature), expected);
    const gate = evaluatePortalFeatureGate(tier, feature);
    assert.deepEqual(gate, { tier, feature, allowed: expected });
    portalMatrix[tier][feature] = gate.allowed;
  }
}

const pageGuards = {
  "app/(portal)/portal/monitoring/page.tsx": "trend_history",
  "app/(portal)/portal/reports/page.tsx": "monthly_reports",
  "app/(portal)/portal/cases/page.tsx": "case_visibility",
  "app/(portal)/portal/requests/page.tsx": "evidence_requests",
  "app/(portal)/portal/plan/page.tsx": "playbook_coach",
  "app/(portal)/portal/documents/page.tsx": "compliance_layer",
  "app/(portal)/portal/compliance/page.tsx": "compliance_layer",
} as const;

for (const [file, feature] of Object.entries(pageGuards)) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const guardCall = `getPortalPageAccess("${feature}")`;
  const guardIndex = source.indexOf(guardCall);
  assert.ok(guardIndex >= 0, `${file} must invoke ${guardCall}`);
  const queryIndex = source.indexOf(".from(");
  if (queryIndex >= 0) {
    assert.ok(guardIndex < queryIndex, `${file} must gate before its first query`);
  }
  assert.ok(source.includes("TierUpgradeNote"), `${file} must render an upgrade note`);
}

const apiGuards = {
  "app/api/portal/requests/route.ts": "evidence_requests",
  "app/api/portal/requests/[requestId]/upload/route.ts": "evidence_requests",
  "app/api/portal/documents/route.ts": "compliance_layer",
} as const;

for (const [file, feature] of Object.entries(apiGuards)) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const guardCall = `getPortalApiAccess("${feature}")`;
  const guardIndex = source.indexOf(guardCall);
  assert.ok(guardIndex >= 0, `${file} must invoke ${guardCall}`);
  const queryIndex = source.indexOf(".from(");
  assert.ok(guardIndex < queryIndex, `${file} must gate before its first query`);
  assert.match(source, /status:\s*403/);
}

const richSectionPlan = Object.fromEntries(
  CLIENT_TIERS.map((serviceTier) => [
    serviceTier,
    buildReportSectionPlan({
      serviceTier,
      newViolationCount: 2,
      openChallengeCount: 2,
      coachingItemCount: 1,
      hasComplianceData: true,
    }).map((section) => section.heading),
  ])
);

assert.deepEqual(richSectionPlan.assessment, [
  REPORT_SECTION_HEADINGS.diagnosticSnapshot,
  REPORT_SECTION_HEADINGS.priorityFindings,
]);
assert.deepEqual(richSectionPlan.monitor, [
  REPORT_SECTION_HEADINGS.burdenTrend,
  REPORT_SECTION_HEADINGS.diagnosticSnapshot,
  REPORT_SECTION_HEADINGS.priorityFindings,
  REPORT_SECTION_HEADINGS.newViolations,
]);
assert.deepEqual(richSectionPlan.remediate, [
  ...richSectionPlan.monitor,
  REPORT_SECTION_HEADINGS.openChallenges,
  REPORT_SECTION_HEADINGS.coachingProgram,
]);
assert.deepEqual(richSectionPlan.total_safety, [
  ...richSectionPlan.remediate,
  REPORT_SECTION_HEADINGS.complianceSweep,
]);

const optionalSectionsOmitted = buildReportSectionPlan({
  serviceTier: "total_safety",
  newViolationCount: 0,
  openChallengeCount: 0,
  coachingItemCount: 0,
  hasComplianceData: false,
}).map((section) => section.heading);
assert.ok(!optionalSectionsOmitted.includes(REPORT_SECTION_HEADINGS.newViolations));
assert.ok(!optionalSectionsOmitted.includes(REPORT_SECTION_HEADINGS.openChallenges));
assert.ok(!optionalSectionsOmitted.includes(REPORT_SECTION_HEADINGS.coachingProgram));
assert.ok(!optionalSectionsOmitted.includes(REPORT_SECTION_HEADINGS.complianceSweep));

const cronSource = readFileSync(
  resolve(process.cwd(), "app/api/cron/monitoring-refresh/route.ts"),
  "utf8"
);
assert.match(cronSource, /\.eq\("status",\s*"active"\)/);
assert.match(cronSource, /\.in\("tier",\s*\[\.\.\.SUBSCRIPTION_TIERS\]\)/);
assert.ok(cronSource.includes('tierHasFeature(\n        client.tier,\n        "case_visibility"'));

console.log(
  JSON.stringify(
    {
      passed: true,
      featureMinimums: TIER_FEATURES,
      portalMatrix,
      pageGuards,
      apiGuards,
      reportSections: richSectionPlan,
      optionalSectionsOmitted,
      cronTiers: SUBSCRIPTION_TIERS,
    },
    null,
    2
  )
);
