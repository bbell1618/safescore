import assert from "node:assert/strict";
import { defaultResponseDue, pacificDateOnly, responseClock, responseClockText } from "../lib/cases/agency-request-clock";

for (const [due, daysLeft, state] of [
  ["2026-09-27", 4, "ok"], ["2026-09-26", 3, "due_soon"],
  ["2026-09-23", 0, "due_soon"], ["2026-09-22", -1, "overdue"],
] as const) {
  assert.deepEqual(responseClock({ response_due: due }, "2026-09-23"), { daysLeft, state });
}
assert.equal(defaultResponseDue("2026-05-29"), "2026-06-08");
assert.equal(defaultResponseDue("2026-12-25"), "2027-01-04");
assert.equal(defaultResponseDue("2028-02-20"), "2028-03-01");
assert.equal(pacificDateOnly("2026-09-24T06:59:59Z"), "2026-09-23");
assert.equal(pacificDateOnly("2026-09-24T07:00:00Z"), "2026-09-24");
assert.deepEqual(responseClock({ response_due: "2026-03-09" }, "2026-03-08T08:00:00Z"), { daysLeft: 1, state: "due_soon" });
assert.deepEqual(responseClock({ response_due: "2026-11-02" }, "2026-11-01T07:00:00Z"), { daysLeft: 1, state: "due_soon" });
assert.throws(() => defaultResponseDue("2026-02-30"), /Invalid calendar date/);
assert.throws(() => responseClock({ response_due: "not-a-date" }, "2026-09-23"), /Invalid calendar date/);
assert.match(responseClockText({ response_due: "2026-09-22" }, "2026-09-23"), /Overdue by 1 days/);
console.log("Agency request clock: 14 assertions passed (boundaries, default, LA midnight, DST, leap year, invalid dates).");
