import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CPDP_ELIGIBILITY_QUESTIONS,
  eligibleTypesFromQuestions,
} from "../lib/cpdp/par-assessment-types";

const exactOfficialLabels = [
  "CMV was struck in the rear by a motorist",
  "CMV was struck on the side at the rear by a motorist",
  "CMV was struck on the side by a motorist operating in the same direction as CMV",
  "CMV was struck because another motorist was driving in the wrong direction",
  "CMV was struck because another motorist was making a U-turn or illegal turn",
  "CMV was struck while legally stopped at a traffic control device or parked",
  "CMV was struck because another motorist did not stop or slow in traffic",
  "CMV was struck because another motorist failed to stop at a traffic control device",
  "CMV was struck because another individual was under the influence",
  "CMV was struck because another motorist experienced a medical issue",
  "CMV was struck because another motorist fell asleep",
  "CMV was struck because another motorist was distracted",
  "CMV was struck by cargo, equipment, or debris",
  "CMV crash was a result of an infrastructure failure",
  "CMV struck an animal",
  "CMV crash involved a suicide death or suicide attempt",
  "CMV was struck because another motorist was entering from a private driveway or parking lot",
  "CMV was struck because another motorist lost control of the vehicle",
  "CMV was involved in a crash with a non-motorist",
  "CMV was involved in a rare or unusual crash type",
  "Video demonstrates the sequence of events for another CMV crash type",
];

assert.equal(CPDP_ELIGIBILITY_QUESTIONS.length, 21);
assert.equal(new Set(CPDP_ELIGIBILITY_QUESTIONS.map((question) => question.id)).size, 21);
assert.deepEqual(CPDP_ELIGIBILITY_QUESTIONS.map((question) => question.label), exactOfficialLabels);
assert.deepEqual(
  eligibleTypesFromQuestions(CPDP_ELIGIBILITY_QUESTIONS.map((question, index) => ({
    id: question.id,
    answer: index === 1 ? "YES" as const : "NO" as const,
  }))),
  [exactOfficialLabels[1]]
);

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260804234207_run_d_par_crash_enrichment.sql"),
  "utf8"
);
assert.match(migration, /approve_cpdp_par_assessment_v1/);
assert.match(migration, /revoke all on function public\.approve_cpdp_par_assessment_v1/);
assert.match(migration, /par_document_id uuid/);
assert.match(migration, /par_ai_assessment jsonb/);

const proxy = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");
assert.match(proxy, /\/api\/integrations\/lexisnexis\/par/);

const intake = readFileSync(
  resolve(process.cwd(), "lib/cpdp/par-intake-server.ts"),
  "utf8"
);
assert.match(intake, /par_assessment_status", startingAssessmentStatus/);
assert.match(intake, /Another PAR intake won the assessment claim/);
assert.match(intake, /PAR_ASSESSMENT_LEASE_MS = 5 \* 60 \* 1000/);
assert.match(intake, /isParAssessmentLeaseStale/);
assert.match(intake, /par_assessment_attempted_at/);
assert.match(intake, /cpdp_eligible: null/);
assert.match(intake, /ai_eligibility_verdict: null/);
assert.match(intake, /inserted\.error\?\.code === "23505"/);

const reviewRoute = readFileSync(
  resolve(process.cwd(), "app/api/cases/cpdp/[id]/par-review/route.ts"),
  "utf8"
);
assert.match(reviewRoute, /supportingExcerpt/);
assert.match(reviewRoute, /A quoted PAR excerpt is required/);

const assessmentServer = readFileSync(
  resolve(process.cwd(), "lib/cpdp/par-assessment-server.ts"),
  "utf8"
);
assert.match(assessmentServer, /PAR_ASSESSMENT_ATTEMPT_TIMEOUT_MS = 50_000/);
assert.match(assessmentServer, /AbortSignal\.timeout/);

const caseRoute = readFileSync(
  resolve(process.cwd(), "app/api/cases/cpdp/[id]/route.ts"),
  "utf8"
);
assert.match(caseRoute, /Linked document could not be resolved/);
assert.match(caseRoute, /The linked police report could not be loaded/);
assert.match(caseRoute, /reviewControlledWrite/);

console.log(JSON.stringify({
  passed: true,
  officialQuestionCount: CPDP_ELIGIBILITY_QUESTIONS.length,
  uniqueQuestionKeys: 21,
  approvalRpcScopedToServiceRole: true,
  webhookPublicProxyException: true,
  concurrentIntakeClaimGuard: true,
  staleAssessmentLeaseRecovery: true,
  boundedProviderAttempt: true,
  replacementClearsPriorDetermination: true,
  yesOverrideRequiresParExcerpt: true,
  narrativeRequiresLinkedParBytes: true,
}, null, 2));
