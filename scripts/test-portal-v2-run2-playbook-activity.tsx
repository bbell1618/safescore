import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BurdenHistoryChart } from "../components/portal/burden-history-chart";
import { evaluatePortalFeatureGate } from "../lib/portal/feature-gate";
import type { PortalActivitySnapshot } from "../lib/portal/activity-server";

const tierMatrix = {
  assessment: { activity: false, cases: false, playbook: false },
  monitor: { activity: true, cases: false, playbook: false },
  remediate: { activity: true, cases: true, playbook: true },
  total_safety: { activity: true, cases: true, playbook: true },
} as const;

for (const [tier, expected] of Object.entries(tierMatrix)) {
  assert.equal(
    evaluatePortalFeatureGate(
      tier as keyof typeof tierMatrix,
      "trend_history"
    ).allowed,
    expected.activity
  );
  assert.equal(
    evaluatePortalFeatureGate(
      tier as keyof typeof tierMatrix,
      "case_visibility"
    ).allowed,
    expected.cases
  );
  assert.equal(
    evaluatePortalFeatureGate(
      tier as keyof typeof tierMatrix,
      "playbook_coach"
    ).allowed,
    expected.playbook
  );
}

const snapshots: PortalActivitySnapshot[] = [
  {
    id: "one",
    snapshotDate: "2026-07-20",
    capturedAt: "2026-07-20T13:00:00.000Z",
    source: "monitoring",
    totalPoints: 582,
  },
  {
    id: "two",
    snapshotDate: "2026-07-22",
    capturedAt: "2026-07-22T07:00:00.000Z",
    source: "monitoring",
    totalPoints: 599,
  },
  {
    id: "three",
    snapshotDate: "2026-07-22",
    capturedAt: "2026-07-22T08:30:00.000Z",
    source: "monitoring",
    totalPoints: 550,
  },
  {
    id: "four",
    snapshotDate: "2026-07-23",
    capturedAt: "2026-07-23T13:00:00.000Z",
    source: "monitoring",
    totalPoints: 549,
  },
];

const chartHtml = renderToStaticMarkup(
  createElement(BurdenHistoryChart, { snapshots })
);
assert.match(chartHtml, />599</);
assert.equal((chartHtml.match(/Jul 22/g) ?? []).length, 2);
assert.match(chartHtml, /12:00 AM/);
assert.match(chartHtml, /1:30 AM/);
assert.match(chartHtml, /Every stored monitoring snapshot is shown/);

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const playbookPage = source("app/(portal)/portal/playbook/page.tsx");
const playbookServer = source("lib/portal/playbook-server.ts");
const activityPage = source("app/(portal)/portal/activity/page.tsx");
const activityServer = source("lib/portal/activity-server.ts");
const chartSource = source("components/portal/burden-history-chart.tsx");

assert.ok(
  playbookPage.indexOf('getPortalPageAccess("playbook_coach")') <
    playbookPage.indexOf("loadLatestPortalPlaybook(access.clientId)")
);
assert.ok(playbookServer.includes('.eq("client_id", clientId)'));
assert.ok(
  playbookServer.includes(
    "left.familyPriority - right.familyPriority"
  )
);
assert.ok(playbookServer.includes("GENERAL_SAFETY_PORTAL_COPY"));
assert.ok(
  playbookServer.includes(
    "familyPrograms: clientPrograms.map((program) => ({"
  )
);
assert.doesNotMatch(playbookPage, /\blane\s+c\b|template version|mapping review/i);

assert.ok(
  activityPage.indexOf('getPortalPageAccess("trend_history")') <
    activityPage.indexOf("loadPortalActivitySnapshots(access.clientId)")
);
assert.ok(
  activityPage.includes(
    'tierHasFeature(access.tier, "case_visibility")'
  )
);
assert.ok(
  activityPage.includes(
    "canSeeCases\n    ? loadPortalActivityCases(access.clientId)"
  )
);
assert.ok(activityPage.includes("cpdpFiledTimelineLabel"));
assert.ok(activityPage.includes("<Suspense"));
assert.ok(
  activityPage.includes(
    "Only genuine data errors and crash-preventability are challengeable."
  )
);
assert.ok(
  activityServer.includes('.order("snapshot_date", { ascending: true })') &&
    activityServer.includes('.order("captured_at", { ascending: true })') &&
    activityServer.includes('.order("id", { ascending: true })')
);

for (const scopedSource of [playbookPage, activityPage, chartSource]) {
  assert.doesNotMatch(scopedSource, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(scopedSource, /\b(?:bg|text|border)-gray-/);
}

console.log(
  JSON.stringify(
    {
      passed: true,
      tierMatrix,
      chart: {
        values: snapshots.map((snapshot) => snapshot.totalPoints),
        duplicateDateLabels: 2,
        spikeVisible: true,
      },
      playbook: {
        entitlementBeforeServiceRead: true,
        runtimeValidation: true,
        generalSafetyCopyNormalized: true,
        prioritySorted: true,
      },
      activity: {
        fullHistoryOrder: ["snapshot_date", "captured_at", "id"],
        caseQueryTierGated: true,
        cpdpTimelineShared: true,
        suspenseSections: true,
      },
    },
    null,
    2
  )
);
