import assert from "node:assert/strict";
import test from "node:test";
import { buildLaneBEvidenceRequestCopy, formatLaneBEvidenceViolationContext, LANE_B_EVIDENCE_TAXONOMY } from "./taxonomy";

const context = { violationCode: "3922SLLS4", inspectionDate: "2026-02-24" };
const format = (violationDescription: string) => formatLaneBEvidenceViolationContext({ ...context, violationDescription });

for (const [evidenceClass, phrase] of [
  ["citation-dismissed", "If the court dismissed or reduced the ticket"],
  ["wrong-attribution", "If the records show it was a different company, driver, or truck"],
  ["duplicate", "If the records show the same event was listed twice"],
  ["report-factual-error", "If the records show the report is wrong"],
] as const) {
  test(`${evidenceClass} uses its outcome condition with singular and plural points`, () => {
    for (const points of [1, 18]) {
      const copy = buildLaneBEvidenceRequestCopy(evidenceClass, points);
      const pointLabel = `${points} ${points === 1 ? "point" : "points"}`;
      assert.equal(copy.whyCopy, `This could remove ${pointLabel} ${phrase.toLowerCase()}.`);
      for (const item of copy.requestedItems) {
        assert.equal(item.contextNote, `${copy.statusCopy} ${phrase}, this could remove ${pointLabel}.`);
        assert.doesNotMatch(item.contextNote, /the error/i);
      }
    }
  });
}

test("request context strips the first category prefix and omits the required code", () => {
  for (const prefix of ["State/Local Laws", "Brake", "License (CDL)"]) {
    assert.equal(format(`${prefix} - Short description`), "Short description, Feb 24, 2026");
  }
  assert.equal(buildLaneBEvidenceRequestCopy("citation-dismissed", 30, {
    ...context, violationDescription: "State/Local Laws - Speeding 15 or more miles per hour over the speed limit",
  }).title, "Court paperwork showing how the ticket ended — Speeding 15 or more miles per hour over the speed limit, Feb 24, 2026");
});

test("short descriptions remain unchanged", () => {
  assert.equal(format("Vacuum hose restricted"), "Vacuum hose restricted, Feb 24, 2026");
  assert.equal(format("First - Second - Actual detail"), "Second - Actual detail, Feb 24, 2026");
});

test("long descriptions stop at a full word at or before character 90", () => {
  const ninety = `${"a".repeat(80)} remaining`;
  assert.equal(ninety.length, 90);
  assert.equal(format(ninety), `${ninety}, Feb 24, 2026`);
  assert.equal(format(`${ninety} more`), `${ninety}…, Feb 24, 2026`);
  assert.equal(format(`${"a".repeat(85)} longerword`), `${"a".repeat(85)}…, Feb 24, 2026`);
  assert.equal(format(`Category - ${"a".repeat(87)} - more`), `${"a".repeat(87)}…, Feb 24, 2026`);
  assert.equal(format("x".repeat(100)), null);
});

test("description acronyms expand as whole words before the length limit", () => {
  assert.equal(format("License (CDL) - CMV without CDL; OOS"), "truck without commercial driver's license; out of service, Feb 24, 2026");
  assert.equal(format("cmv cdl oos"), "truck commercial driver's license out of service, Feb 24, 2026");
  assert.equal(format("CMVX XCDL OOST CDL123"), "CMVX XCDL OOST CDL123, Feb 24, 2026");
  assert.equal(format(`${"a".repeat(80)} CDL`), `${"a".repeat(80)}…, Feb 24, 2026`);
});

test("court copy uses everyday wording while preserving the evidence key", () => {
  const copy = buildLaneBEvidenceRequestCopy("citation-dismissed", 18);
  assert.equal(copy.title, "Court paperwork showing how the ticket ended");
  assert.equal(copy.requestedItems[0].label, copy.title);
  assert.equal(copy.requestedItems[0].itemKey, "certified-court-disposition");
  assert.match(copy.statusCopy, /court's final decision/);
  assert.match(copy.statusCopy, /stamped or signed/);
  for (const definition of Object.values(LANE_B_EVIDENCE_TAXONOMY)) {
    assert.doesNotMatch([definition.title, definition.ask, ...definition.items.map((item) => item.label)].join(" "), /\b(?:CMV|CDL|OOS|ELD|GPS|VIN)\b|certified court disposition/i);
  }
});

test("incomplete context remains generic and trailing separators are removed", () => {
  assert.equal(format("Restricted hose -"), "Restricted hose, Feb 24, 2026");
  for (const missing of ["violationCode", "violationDescription", "inspectionDate"]) {
    assert.equal(formatLaneBEvidenceViolationContext({ ...context, violationDescription: "Speeding", [missing]: " " }), null);
  }
  assert.equal(formatLaneBEvidenceViolationContext({ ...context, violationDescription: "Speeding", inspectionDate: "2026-02-30" }), null);
});
