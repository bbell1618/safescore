import { getRemediationNextStep } from "../lib/analysis/remediation-next-step";
import { mapReasonCode } from "../lib/analysis/reason-codes";

const states = [
  getRemediationNextStep({ safetyRecordCount: 0, actionCount: 0, openCaseCount: 0 }),
  getRemediationNextStep({ safetyRecordCount: 12, actionCount: 5, openCaseCount: 0 }),
  getRemediationNextStep({ safetyRecordCount: 12, actionCount: 5, openCaseCount: 2 }),
];

for (const state of states) {
  console.log(`${state.state}: ${state.title} | ${state.detail}`);
}

const reason = mapReasonCode({
  challengeReason: "The inspection was assigned to the wrong carrier USDOT number.",
  violationCode: "395.8A-ELD",
  basicCategory: "hos_compliance",
});
console.log(`reason-code: ${reason.code} | ${reason.label}`);

if (states.map((state) => state.state).join(",") !== "fresh,analysis_ready,cases_open") {
  throw new Error("Remediation state coverage failed");
}
if (reason.code !== "company_incorrect") throw new Error("Reason-code mapping failed");
