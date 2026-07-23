import assert from "node:assert/strict";
import {
  mapFmcsaBasicsPayload,
  type FMCSABasicsPayload,
} from "../lib/fmcsa/client";

function entry({
  id,
  code,
  measure,
  percentile = "Not Public",
  inspections,
  violations,
}: {
  id: number;
  code: string;
  measure: string;
  percentile?: string;
  inspections: number;
  violations: number;
}): FMCSABasicsPayload["content"][number] {
  return {
    basic: {
      basicsPercentile: percentile,
      basicsRunDate: "2017-01-27T05:00:00.000+0000",
      basicsType: { basicsCode: code, basicsId: id },
      exceededFMCSAInterventionThreshold: "-1",
      measureValue: measure,
      onRoadPerformanceThresholdViolationIndicator: "Not Public",
      totalInspectionWithViolation: inspections,
      totalViolation: violations,
    },
  };
}

const nationwidePayload: FMCSABasicsPayload = {
  content: [
    entry({ id: 11, code: "Unsafe Driving", measure: "9", inspections: 1, violations: 1 }),
    entry({ id: 12, code: "HOS Compliance", measure: "1.05", inspections: 4, violations: 4 }),
    entry({ id: 13, code: "Driver Fitness", measure: "0", inspections: 0, violations: 0 }),
    entry({ id: 14, code: "Drugs/Alcohol", measure: "0", inspections: 0, violations: 0 }),
    entry({ id: 15, code: "Vehicle Maint.", measure: "1.84", inspections: 2, violations: 6 }),
  ],
  retrievalDate: "2026-07-22T23:47:20.564+0000",
};

const mapped = mapFmcsaBasicsPayload(nationwidePayload);
assert.equal(mapped.unsafeDriving?.measureValue, 9);
assert.equal(mapped.unsafeDriving?.violationCount, 1);
assert.equal(mapped.unsafeDriving?.sourceId, 11);
assert.equal(mapped.hosCompliance?.measureValue, 1.05);
assert.equal(mapped.driverFitness?.measureValue, 0);
assert.equal(mapped.controlledSubstances?.measureValue, 0);
assert.equal(mapped.vehicleMaintenance?.measureValue, 1.84);
assert.equal(mapped.hmCompliance, null);
assert.equal(mapped.crashIndicator, null);
assert.equal(mapped.smsSnapshotDate, "2017-01-27T05:00:00.000+0000");
assert.equal(mapped.retrievedAt, "2026-07-22T23:47:20.564+0000");
assert.equal(mapped.unsafeDriving?.percentile, null);
assert.equal(mapped.unsafeDriving?.alert, false);

const missingCategoriesMapped = mapFmcsaBasicsPayload({
  content: [
    entry({ id: 16, code: "HM Compliance", measure: "2.4", inspections: 2, violations: 3 }),
    entry({ id: 17, code: "Crash Indicator", measure: "0.75", inspections: 1, violations: 1 }),
  ],
  retrievalDate: "2026-07-22T23:47:20.564+0000",
});
assert.equal(missingCategoriesMapped.hmCompliance?.measureValue, 2.4);
assert.equal(missingCategoriesMapped.crashIndicator?.measureValue, 0.75);

const mixedRunDates = structuredClone(nationwidePayload);
mixedRunDates.content[0].basic.basicsRunDate = "2017-02-01T05:00:00.000+0000";
assert.equal(mapFmcsaBasicsPayload(mixedRunDates).smsSnapshotDate, null);

console.log("FMCSA BASIC mapping tests passed (source fields, seven categories, dates, missing data)");
