import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BurdenHistoryChart } from "../components/portal/burden-history-chart";
import { BurdenSparkline } from "../components/portal/burden-sparkline";
import {
  signedSnapshotDelta,
  snapshotCaptureLabel,
  snapshotSourceLabel,
} from "../components/portal/snapshot-interaction";
import type { PortalActivitySnapshot } from "../lib/portal/activity-server";

const snapshots: PortalActivitySnapshot[] = [
  {
    id: "rerun-582",
    snapshotDate: "2026-07-20",
    capturedAt: "2026-07-20T13:00:00.000Z",
    source: "rerun",
    totalPoints: 582,
  },
  {
    id: "rerun-599",
    snapshotDate: "2026-07-21",
    capturedAt: "2026-07-21T13:00:00.000Z",
    source: "rerun",
    totalPoints: 599,
  },
  {
    id: "scheduled-590",
    snapshotDate: "2026-07-22",
    capturedAt: "2026-07-22T13:00:00.000Z",
    source: "scheduled_refresh",
    totalPoints: 590,
  },
  {
    id: "scheduled-550",
    snapshotDate: "2026-07-22",
    capturedAt: "2026-07-22T16:39:49.928Z",
    source: "scheduled_refresh",
    totalPoints: 550,
  },
  {
    id: "scheduled-549",
    snapshotDate: "2026-07-26",
    capturedAt: "2026-07-26T13:01:36.005Z",
    source: "scheduled_refresh",
    totalPoints: 549,
  },
];

const activityHtml = renderToStaticMarkup(
  createElement(BurdenHistoryChart, { snapshots })
);
for (const delta of ["+17", "−9", "−40", "−1"]) {
  assert.ok(activityHtml.includes(`data-delta-badge="${delta}"`));
}
assert.equal((activityHtml.match(/tabindex="0"/g) ?? []).length, 5);
assert.equal((activityHtml.match(/r="20"/g) ?? []).length, 5);
assert.match(activityHtml, /Re-analysis/);
assert.match(activityHtml, /Scheduled check/);
assert.match(activityHtml, /Interactive weighted burden chart/);

const sparklineHtml = renderToStaticMarkup(
  createElement(BurdenSparkline, {
    label: "Weighted burden across five snapshots",
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      snapshotDate: snapshot.snapshotDate,
      capturedAt: snapshot.capturedAt,
      source: snapshot.source,
      totalPoints: snapshot.totalPoints,
    })),
  })
);
assert.equal((sparklineHtml.match(/tabindex="0"/g) ?? []).length, 5);
assert.equal((sparklineHtml.match(/r="20"/g) ?? []).length, 5);
assert.equal(
  (sparklineHtml.match(/data-sparkline-marker="endpoint"/g) ?? []).length,
  1
);
assert.doesNotMatch(sparklineHtml, /data-sparkline-marker="active"/);
assert.doesNotMatch(sparklineHtml, /stroke-dasharray/);
assert.match(
  sparklineHtml,
  /<polyline[^>]*stroke="var\(--color-amber-light\)"[^>]*stroke-width="2"/
);
assert.match(
  sparklineHtml,
  /<stop offset="0%" stop-color="var\(--color-amber-light\)" stop-opacity="0\.18"/
);
assert.match(sparklineHtml, /Re-analysis/);
assert.match(sparklineHtml, /Scheduled check/);
assert.match(sparklineHtml, /Weighted burden across five snapshots/);

const eightPointSparkline = renderToStaticMarkup(
  createElement(BurdenSparkline, {
    label: "Eight stored snapshots",
    snapshots: Array.from({ length: 8 }, (_, index) => ({
      id: `snapshot-${index}`,
      snapshotDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      capturedAt: `2026-07-${String(index + 1).padStart(2, "0")}T13:00:00.000Z`,
      source: "scheduled_refresh",
      totalPoints: 560 - index,
    })),
  })
);
assert.match(eightPointSparkline, /width:320px;min-width:100%/);

assert.equal(snapshotSourceLabel("rerun"), "Re-analysis");
assert.equal(snapshotSourceLabel("scheduled_refresh"), "Scheduled check");
assert.equal(
  snapshotSourceLabel("manual_review"),
  "Manual Review"
);
assert.equal(snapshotSourceLabel(""), null);
assert.equal(signedSnapshotDelta(17), "+17");
assert.equal(signedSnapshotDelta(-40), "−40");
assert.equal(signedSnapshotDelta(0), "0");
assert.equal(
  snapshotCaptureLabel(
    "2026-07-22T16:39:49.928Z",
    "2026-07-22"
  ),
  "Jul 22, 2026 · 9:39 AM PDT"
);

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const activitySource = source(
  "components/portal/interactive-burden-history-chart.tsx"
);
const sparklineSource = source("components/portal/burden-sparkline.tsx");
for (const component of [activitySource, sparklineSource]) {
  assert.match(component, /document\.addEventListener\("pointerdown", dismiss\)/);
  assert.match(component, /event\.key === "Enter"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /POINT_TARGET_RADIUS = 20/);
  assert.match(component, /focus-visible:/);
  assert.match(component, /\.closest\("\[data-/);
  assert.match(component, /setFocusedIndex\(null\)/);
}
assert.match(activitySource, /PortalAnimatedActivitySeries/);
assert.match(
  sparklineSource,
  /MINIMUM_POINT_SPACING = POINT_TARGET_RADIUS \* 2/
);
assert.match(sparklineSource, /preserveAspectRatio="none"/);
assert.doesNotMatch(sparklineSource, /\{\[16, 40, 64\]\.map/);

console.log(
  JSON.stringify(
    {
      passed: true,
      activity: {
        points: snapshots.length,
        values: snapshots.map((snapshot) => snapshot.totalPoints),
        deltas: [17, -9, -40, -1].map(signedSnapshotDelta),
        keyboardFocus: true,
        touchDismiss: true,
      },
      home: {
        points: snapshots.length,
        metadata: ["capture time", "burden", "delta", "source"],
        keyboardFocus: true,
        touchDismiss: true,
      },
      sourceLabels: {
        rerun: snapshotSourceLabel("rerun"),
        scheduled_refresh: snapshotSourceLabel("scheduled_refresh"),
      },
    },
    null,
    2
  )
);
