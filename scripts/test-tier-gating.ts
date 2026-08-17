import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePortalFeatureGate } from "../lib/portal/feature-gate";
import {
  CLIENT_TIERS,
  isSubscriptionTier,
  SUBSCRIPTION_TIERS,
  TIER_FEATURES,
  TIER_LABELS,
  tierDisplayLabel,
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

const expectedTierLabels = {
  assessment: "Assessment",
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
} as const;

assert.deepEqual(TIER_LABELS, expectedTierLabels);
for (const tier of CLIENT_TIERS) {
  assert.equal(tierDisplayLabel(tier), expectedTierLabels[tier]);
}
assert.equal(tierDisplayLabel(null), "Not assigned");
assert.equal(tierDisplayLabel("unknown_tier"), "Not assigned");
assert.equal(tierDisplayLabel("unknown_tier", "Unknown tier"), "Unknown tier");

const accountSource = readFileSync(
  resolve(process.cwd(), "app/(console)/console/clients/[id]/account/page.tsx"),
  "utf8"
);
assert.ok(accountSource.includes("tierDisplayLabel(account.tier)"));
assert.ok(accountSource.includes("tierDisplayLabel(subscription.tier)"));
assert.ok(!accountSource.includes('value={account.tier ?? "Not assigned"}'));
assert.ok(!accountSource.includes("value={subscription.tier}"));

const sharedTierLabelRenderers = {
  "app/page.tsx": "TIER_LABELS[tier.value]",
  "app/onboarding/page.tsx": "TIER_LABELS[assignedTierData.value]",
  "app/(console)/console/page.tsx": "tierDisplayLabel(client.tier)",
  "app/(console)/console/clients/[id]/layout.tsx": "tierDisplayLabel(client.tier)",
  "app/(portal)/portal/account/page.tsx": "tierDisplayLabel(context.tier)",
  "components/console/client-intake-fields.tsx": "TIER_LABELS[tier]",
  "components/console/service-tier-chip.tsx": "TIER_LABELS[minimumTier]",
  "components/portal/tier-upgrade-note.tsx": "TIER_LABELS[currentTier]",
} as const;

for (const [file, labelExpression] of Object.entries(sharedTierLabelRenderers)) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  assert.ok(
    source.includes(labelExpression),
    `${file} must render service tiers from the shared tier labels`
  );
}

for (const file of ["app/page.tsx", "app/onboarding/page.tsx"]) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  assert.ok(!source.includes('name: "Monitor"'), `${file} must not duplicate Monitor`);
  assert.ok(!source.includes('name: "Remediate"'), `${file} must not duplicate Remediate`);
  assert.ok(!source.includes('name: "Total Safety"'), `${file} must not duplicate Total Safety`);
}

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
  "app/(portal)/portal/activity/page.tsx": "trend_history",
  "app/(portal)/portal/playbook/page.tsx": "playbook_coach",
  "app/(portal)/portal/compliance/page.tsx": "compliance_layer",
} as const;

for (const [file, feature] of Object.entries(pageGuards)) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const guardCall = `getPortalPageAccess("${feature}")`;
  const guardIndex = source.indexOf(guardCall);
  assert.ok(guardIndex >= 0, `${file} must invoke ${guardCall}`);
  const queryIndex = source.indexOf('.from("');
  if (queryIndex >= 0) {
    assert.ok(guardIndex < queryIndex, `${file} must gate before its first query`);
  }
  assert.ok(source.includes("TierUpgradeNote"), `${file} must render an upgrade note`);
}

const activitySource = readFileSync(
  resolve(process.cwd(), "app/(portal)/portal/activity/page.tsx"),
  "utf8"
);
assert.ok(
  activitySource.includes(
    'tierHasFeature(access.tier, "case_visibility")'
  )
);
assert.ok(
  /const casesPromise = canSeeCases\s*\?\s*loadPortalActivityCases\(access\.clientId\)/.test(
    activitySource
  )
);

const documentsSource = readFileSync(
  resolve(process.cwd(), "app/(portal)/portal/documents/page.tsx"),
  "utf8"
);
for (const feature of [
  "evidence_requests",
  "compliance_layer",
  "monthly_reports",
] as const) {
  assert.ok(
    documentsSource.includes(`tierHasFeature(context.tier, "${feature}")`),
    `Documents must enforce ${feature} before loading that zone`
  );
}
assert.match(
  documentsSource,
  /const requestPromise = loadOpenRequests\([\s\S]*?canSeeRequests\s*\);/
);
assert.ok(documentsSource.includes("requestFeatureLocked={!canSeeRequests}"));
assert.match(documentsSource, /canSeeVault\s*\?\s*loadDocuments/);
assert.match(documentsSource, /canSeeReports\s*\?\s*loadSentReports/);

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

const totalSafetyUnderwriter = buildReportSectionPlan({
  reportType: "underwriter",
  serviceTier: "total_safety",
}).map((section) => section.heading);
const remediateUnderwriter = buildReportSectionPlan({
  reportType: "underwriter",
  serviceTier: "remediate",
}).map((section) => section.heading);
assert.ok(
  totalSafetyUnderwriter.includes(
    REPORT_SECTION_HEADINGS.ongoingSafetyManagement
  )
);
assert.ok(
  !remediateUnderwriter.includes(
    REPORT_SECTION_HEADINGS.ongoingSafetyManagement
  )
);

const cronSource = readFileSync(
  resolve(process.cwd(), "app/api/cron/monitoring-refresh/route.ts"),
  "utf8"
);
assert.match(cronSource, /\.eq\("status",\s*"active"\)/);
assert.match(cronSource, /\.in\("tier",\s*\[\.\.\.SUBSCRIPTION_TIERS\]\)/);
assert.match(
  cronSource,
  /tierHasFeature\(\s*client\.tier,\s*"case_visibility"\s*\)/
);

const proxySource = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");
assert.ok(proxySource.includes("activeAssignedClient"));
assert.ok(proxySource.includes("!subscription || subscription.status === \"active\""));
assert.ok(proxySource.includes("isSubscriptionTier(client.tier)"));

const portalHomeSource = readFileSync(
  resolve(process.cwd(), "app/(portal)/portal/page.tsx"),
  "utf8"
);
const portalHomeServerSource = readFileSync(
  resolve(process.cwd(), "lib/portal/home-server.ts"),
  "utf8"
);
assert.ok(
  portalHomeSource.includes(
    'const canSeeTrend = tierHasFeature(context.tier, "trend_history")'
  )
);
assert.ok(portalHomeSource.includes("includeHistory: canSeeTrend"));
assert.ok(
  portalHomeSource.includes(
    'const canSeeServiceActivity = tierHasFeature('
  ) && portalHomeSource.includes('"monitoring_alerts"')
);
assert.ok(
  portalHomeSource.includes(
    "{canSeeServiceActivity && handlingPromise ? ("
  )
);
assert.ok(
  portalHomeServerSource.includes(".limit(input.includeHistory ? 8 : 1)")
);
assert.ok(
  portalHomeServerSource.includes(
    "const activityPromise = canSeeServiceActivity"
  )
);

console.log(
  JSON.stringify(
    {
      passed: true,
      featureMinimums: TIER_FEATURES,
      tierLabels: TIER_LABELS,
      sharedTierLabelRenderers,
      portalMatrix,
      pageGuards,
      apiGuards,
      portalHomeGuards: {
        assessmentHistoryLimit: 1,
        subscriptionHistoryLimit: 8,
        serviceActivityMinimum: "monitor",
      },
      reportSections: {
        totalSafetyUnderwriter,
        remediateUnderwriter,
      },
      cronTiers: SUBSCRIPTION_TIERS,
    },
    null,
    2
  )
);
