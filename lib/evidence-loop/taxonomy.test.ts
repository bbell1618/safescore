import assert from "node:assert/strict";
import test from "node:test";
import { buildLaneBEvidenceRequestCopy, formatLaneBEvidenceViolationContext } from "./taxonomy";

const context = { violationCode: "3922SLLS4", inspectionDate: "2026-02-24" };
const format = (violationDescription: string) => formatLaneBEvidenceViolationContext({ ...context, violationDescription });

test("request context strips the first category prefix and omits the required code", () => {
  for (const prefix of ["State/Local Laws", "Brake", "License (CDL)"]) {
    assert.equal(format(`${prefix} - Short description`), "Short description, Feb 24, 2026");
  }
  assert.equal(buildLaneBEvidenceRequestCopy("citation-dismissed", 30, {
    ...context, violationDescription: "State/Local Laws - Speeding 15 or more miles per hour over the speed limit",
  }).title, "Certified court disposition — Speeding 15 or more miles per hour over the speed limit, Feb 24, 2026");
});

test("short descriptions remain unchanged", () => {
  assert.equal(format("Vacuum hose restricted"), "Vacuum hose restricted, Feb 24, 2026");
  assert.equal(format("First - Second - Actual detail"), "Second - Actual detail, Feb 24, 2026");
});

test("long descriptions stop at a full word at or before character 70", () => {
  const seventy = `${"a".repeat(60)} remaining`;
  assert.equal(seventy.length, 70);
  assert.equal(format(seventy), `${seventy}, Feb 24, 2026`);
  assert.equal(format(`${seventy} more`), `${seventy}…, Feb 24, 2026`);
  assert.equal(format(`${"a".repeat(65)} longerword`), `${"a".repeat(65)}…, Feb 24, 2026`);
  assert.equal(format(`Category - ${"a".repeat(67)} - more`), `${"a".repeat(67)}…, Feb 24, 2026`);
  assert.equal(format("x".repeat(80)), null);
});

test("incomplete context remains generic and trailing separators are removed", () => {
  assert.equal(format("Restricted hose -"), "Restricted hose, Feb 24, 2026");
  for (const missing of ["violationCode", "violationDescription", "inspectionDate"]) {
    assert.equal(formatLaneBEvidenceViolationContext({ ...context, violationDescription: "Speeding", [missing]: " " }), null);
  }
  assert.equal(formatLaneBEvidenceViolationContext({ ...context, violationDescription: "Speeding", inspectionDate: "2026-02-30" }), null);
});
