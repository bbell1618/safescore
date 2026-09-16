import assert from "node:assert/strict";
import { classifyBasicsCurrentness } from "../lib/fmcsa/basics-currentness";

const now = new Date("2026-09-16T12:00:00Z");
const classify = (value: string | null) => classifyBasicsCurrentness(value, now);

assert.equal(classify("2017-01-27T05:00:00.000+0000").currentness, "stale");
assert.equal(classify("2017-01-27T05:00:00.000+0000").runDate, "2017-01-27");
assert.deepEqual(classify("2026-08-28T04:00:00.000+0000"), {
  currentness: "current",
  runDate: "2026-08-28",
  ageDays: 19,
});
assert.equal(classify("2026-08-02").currentness, "current");
assert.equal(classify("2026-08-02").ageDays, 45);
assert.equal(classify("2026-08-01").currentness, "stale");
assert.equal(classify("2026-08-01").ageDays, 46);
assert.deepEqual(classify(null), { currentness: "unknown", runDate: null, ageDays: null });
assert.equal(classify("Not Public").currentness, "unknown");

console.log("BASIC currentness tests passed (stale source, current source, inclusive 45-day boundary, unknown dates)");
