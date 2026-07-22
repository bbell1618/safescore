import assert from "node:assert/strict";
import { summarizeInvestigationBurden } from "../lib/analysis/remediation-presentation";

const nationwide = summarizeInvestigationBurden(
  [14, 14, 14, 14, 12, 12, 12, 10].map((points) => ({ points })),
  550
);

assert.deepEqual(nationwide, {
  points: 102,
  percent: 19,
  violationCount: 8,
});

assert.deepEqual(
  summarizeInvestigationBurden([{ points: 8 }, { points: 0 }, { points: -1 }], 20),
  {
    points: 8,
    percent: 40,
    violationCount: 1,
  }
);

assert.deepEqual(summarizeInvestigationBurden([], 0), {
  points: 0,
  percent: 0,
  violationCount: 0,
});

console.log("Remediation presentation tests passed.");
