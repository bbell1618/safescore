import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatMonitoringTimestamp,
  MONITORING_CRON_SCHEDULES,
  monitoringSourceLabel,
  monitoringWatchStatusText,
  mostRecentMonitoringCheck,
  nextMonitoringCheck,
  shouldRunMonitoringInvocation,
  type MonitoringCheckCandidate,
} from "../lib/monitoring/watch-status";

const run: MonitoringCheckCandidate = {
  timestamp: "2026-07-22T21:21:57.389444Z",
  source: "monitoring_cron",
  kind: "run",
};
const snapshot: MonitoringCheckCandidate = {
  timestamp: "2026-07-22T16:39:49.928Z",
  source: "scheduled_refresh",
  kind: "snapshot",
};

assert.deepEqual(mostRecentMonitoringCheck([snapshot, run]), run);
assert.deepEqual(mostRecentMonitoringCheck([snapshot, null]), snapshot);
assert.equal(mostRecentMonitoringCheck([null, undefined]), null);
assert.equal(
  monitoringSourceLabel(run),
  "scheduled monitoring run (monitoring_cron)"
);
assert.equal(
  monitoringSourceLabel(snapshot),
  "scheduled-refresh burden snapshot (scheduled_refresh)"
);

assert.equal(
  formatMonitoringTimestamp(run.timestamp),
  "Jul 22, 2026, 2:21 PM PT"
);
assert.equal(
  nextMonitoringCheck(new Date("2026-07-22T12:30:00.000Z")).toISOString(),
  "2026-07-22T13:00:00.000Z"
);
assert.equal(
  nextMonitoringCheck(new Date("2026-07-22T23:47:38.000Z")).toISOString(),
  "2026-07-23T13:00:00.000Z"
);
assert.equal(
  nextMonitoringCheck(new Date("2026-01-22T15:00:00.000Z")).toISOString(),
  "2026-01-23T14:00:00.000Z"
);
assert.equal(
  nextMonitoringCheck(new Date("2026-03-08T13:30:00.000Z")).toISOString(),
  "2026-03-09T13:00:00.000Z"
);
assert.deepEqual(MONITORING_CRON_SCHEDULES, ["0 13 * * *", "0 14 * * *"]);
const vercelConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")
) as { crons: Array<{ path: string; schedule: string }> };
assert.deepEqual(
  vercelConfig.crons
    .filter((cron) => cron.path === "/api/cron/monitoring-refresh")
    .map((cron) => cron.schedule),
  [...MONITORING_CRON_SCHEDULES]
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: "0 13 * * *",
    now: new Date("2026-07-22T13:00:00.000Z"),
  }),
  true
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: "0 14 * * *",
    now: new Date("2026-07-22T14:00:00.000Z"),
  }),
  false
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: "0 13 * * *",
    now: new Date("2026-01-22T13:00:00.000Z"),
  }),
  false
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: "0 14 * * *",
    now: new Date("2026-01-22T14:00:00.000Z"),
  }),
  true
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: null,
    userAgent: "vercel-cron/1.0",
    now: new Date("2026-07-22T14:00:00.000Z"),
  }),
  false
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: null,
    userAgent: "vercel-cron/1.0",
    now: new Date("2026-01-22T14:00:00.000Z"),
  }),
  true
);
assert.equal(
  shouldRunMonitoringInvocation({
    scheduleHeader: null,
    userAgent: "curl/8.0",
    now: new Date("2026-07-22T23:47:38.000Z"),
  }),
  true
);
assert.throws(
  () =>
    shouldRunMonitoringInvocation({
      scheduleHeader: "0 12 * * *",
      now: new Date("2026-07-22T12:00:00.000Z"),
    }),
  /Unexpected monitoring cron schedule/
);

const nationwideText = monitoringWatchStatusText({
  lastCheck: mostRecentMonitoringCheck([snapshot, run]),
  now: new Date("2026-07-22T23:47:38.000Z"),
});
assert.equal(
  nationwideText,
  "Watching daily \u00B7 last check Jul 22, 2026, 2:21 PM PT via scheduled monitoring run (monitoring_cron) \u00B7 next check Jul 23, 2026, 6:00 AM PT \u00B7 alerts fire on: new violation, new inspection, new crash, OOS change"
);
assert.equal(
  monitoringWatchStatusText({
    lastCheck: null,
    now: new Date("2026-07-22T23:47:38.000Z"),
  }),
  "Watching daily \u00B7 last check not yet recorded \u00B7 next check Jul 23, 2026, 6:00 AM PT \u00B7 alerts fire on: new violation, new inspection, new crash, OOS change"
);
assert.equal(
  monitoringWatchStatusText({
    lastCheck: run,
    lastRun: { timestamp: run.timestamp, snapshotStatus: "unchanged" },
    lastSnapshot: { timestamp: snapshot.timestamp },
    now: new Date("2026-07-22T23:47:38.000Z"),
  }),
  "Checked Jul 22, 2026, 2:21 PM PT; no change since Jul 22, 2026, 9:39 AM PT \u00B7 next check Jul 23, 2026, 6:00 AM PT \u00B7 alerts fire on: new violation, new inspection, new crash, OOS change"
);

assert.throws(
  () =>
    mostRecentMonitoringCheck([
      { timestamp: "not-a-date", source: "monitoring_cron", kind: "run" },
    ]),
  /valid timestamp/
);
assert.throws(
  () =>
    mostRecentMonitoringCheck([
      { timestamp: run.timestamp, source: " ", kind: "run" },
    ]),
  /source cannot be empty/
);

console.log(
  JSON.stringify(
    {
      passed: true,
      latestSource: run,
      rendered: nationwideText,
      summerNextCheck: "2026-07-23T13:00:00.000Z",
      winterNextCheck: "2026-01-23T14:00:00.000Z",
      cronSchedules: MONITORING_CRON_SCHEDULES,
      daylightSavingGate: "13:00Z executes; 14:00Z skips",
      standardTimeGate: "13:00Z skips; 14:00Z executes",
    },
    null,
    2
  )
);
