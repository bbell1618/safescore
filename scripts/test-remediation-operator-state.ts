import assert from "node:assert/strict";
import { summarizeCorrectionWork, type CorrectionRow } from "../lib/analysis/remediation-operator-state";

const investigation: CorrectionRow = { lane: "I", caseStatus: null, requestState: "waiting", hasPoliceReport: false };
const crash: CorrectionRow = { lane: "A", caseStatus: "draft", requestState: null, hasPoliceReport: false };
const waiting = summarizeCorrectionWork([investigation, crash, { ...crash, caseStatus: "filed" }, { ...crash, caseStatus: "closed" }], 0);
assert.equal(waiting.needsAction, 0);
assert.equal(waiting.waitingClient, 1);
assert.equal(waiting.missingPoliceReports, 1);
assert.equal(waiting.waitingAgency, 1);
assert.equal(waiting.completed, 1);
assert.match(waiting.title, /Nothing needs you in this correction queue/);
assert.match(summarizeCorrectionWork([investigation], 2).title, /2 work items need attention/);
for (const requestState of ["escalated", "needs_review"] as const) {
  assert.equal(summarizeCorrectionWork([{ ...investigation, requestState }], 0).needsAction, 1);
  assert.equal(summarizeCorrectionWork([{ ...investigation, requestState, caseStatus: "closed" }], 0).needsAction, 1);
}
assert.equal(summarizeCorrectionWork([{ ...investigation, requestState: null }], 0).needsAction, 1);
assert.equal(summarizeCorrectionWork([{ ...crash, hasPoliceReport: true }], 0).needsAction, 1);
assert.equal(summarizeCorrectionWork([{ ...crash, caseStatus: "unknown" }], 0).needsAction, 1);
assert.equal(summarizeCorrectionWork([{ ...crash, caseStatus: null }], 0).missingPoliceReports, 1);
for (const caseStatus of ["closed", "approved", "denied", "withdrawn", "determination_made"]) assert.equal(summarizeCorrectionWork([{ ...crash, caseStatus }], 0).completed, 1);
assert.equal(summarizeCorrectionWork([{ ...investigation, lane: "B", requestState: null }], 0).needsAction, 1);
assert.equal(summarizeCorrectionWork([], 0).label, "Queue clear");
assert.match(summarizeCorrectionWork([], 1).title, /1 work item needs attention/);
console.log("Correction operator state tests passed");
