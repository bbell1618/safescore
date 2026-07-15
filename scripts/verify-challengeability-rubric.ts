import assert from "node:assert/strict";
// Node's type-strip runner requires the extension; the application compiler does not emit this script.
// @ts-expect-error allow the executable TypeScript extension for this verification script
import { buildChallengeabilitySystemPrompt, validateChallengeabilityAssessment, type ChallengeabilityAssessment, type ChallengeabilityRecord } from "../lib/analysis/challengeability-rubric.ts";

const today = "2026-07-15";

const baseAssessment: ChallengeabilityAssessment = {
  tier: "operational",
  reason: "No record-specific defect is present in the supplied fields; treat the recorded condition as legitimate and correct it operationally.",
  specificDefect: null,
  evidence: null,
  evidenceSource: null,
  priority: "medium",
  confidence: 95,
  suggestedApproach: null,
};

const laneRecord: ChallengeabilityRecord = {
  violationCode: "3922SLLML",
  description: "State/Local Laws - Failure to maintain lane",
  basicCategory: "unsafe_driving",
  severityWeight: 5,
  oosViolation: false,
  convicted: true,
  citationNumber: null,
  citationResult: null,
  inspectionDate: "2026-03-20",
  state: "UT",
  inspectionLevel: "1",
};

assert.throws(() => validateChallengeabilityAssessment(baseAssessment, laneRecord, today), /must be investigate/);
validateChallengeabilityAssessment({
  ...baseAssessment,
  tier: "investigate",
  reason: "The state/local-law record is marked convicted but has no citation disposition.",
  specificDefect: "The court disposition is unknown.",
  evidence: "Obtain the final court disposition for this state/local-law matter.",
  evidenceSource: "The issuing court or jurisdiction.",
  suggestedApproach: "Collect the final court disposition before deciding whether a DataQ ground exists.",
}, laneRecord, today);
assert.match(buildChallengeabilitySystemPrompt(today), /TODAY IS 2026-07-15/);

assert.throws(() => validateChallengeabilityAssessment(
  {
    ...baseAssessment,
    tier: "investigate",
    reason: "The inspection date of 2026-03-20 is a future date.",
    specificDefect: "The date appears impossible.",
    evidence: "Confirm the inspection date.",
    evidenceSource: "The inspection report.",
  },
  laneRecord,
  today
), /cannot be described as a future date/);

assert.throws(() => validateChallengeabilityAssessment(
  { ...baseAssessment, reason: "Level 3 inspections occur without the driver present." },
  {
    ...laneRecord,
    violationCode: "39216AD",
    description: "Driver - Failed to use seat belt while operating a CMV.",
    inspectionDate: "2026-01-06",
    inspectionLevel: "3",
  },
  today
), /invented that the driver was not present/);

assert.throws(() => validateChallengeabilityAssessment(
  { ...baseAssessment, tier: "moderate" },
  laneRecord,
  today
), /requires a specific defect/);

assert.throws(() => validateChallengeabilityAssessment(
  { ...baseAssessment, tier: "not_challengeable" },
  { ...laneRecord, violationCode: "39375A3TAOL", description: "Equipment condition" },
  today
), /requires an adverse citation disposition/);

console.log("challengeability rubric regression checks passed");
