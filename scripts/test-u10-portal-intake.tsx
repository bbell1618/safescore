import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const onboarding = read("app/onboarding/page.tsx");
const onboardingRoute = read("app/api/portal/onboarding-profile/route.ts");
const evidenceServer = read("lib/evidence-loop/server.ts");
const onboardingValidation = read("lib/onboarding/validation.ts");
const taxonomy = read("lib/evidence-loop/taxonomy.ts");
const requestAnswer = read("components/portal/request-answer.tsx");
const requestUpload = read("components/portal/request-upload.tsx");
const documentsPage = read("app/(portal)/portal/documents/page.tsx");
const requestsApi = read("app/api/portal/requests/route.ts");

assert.match(
  taxonomy,
  /Has any driver fought and beaten a roadside ticket in the last 24 months\?/
);
assert.match(onboarding, /CITATION_DISMISSED_INTAKE_QUESTION/);
assert.match(
  onboarding,
  /useState<boolean\s*\|\s*null>\(null\)/
);
assert.match(onboarding, /citationDismissedLast24Months,/);
assert.match(
  onboarding,
  /tierHasFeature\(\s*assignedTier,\s*"evidence_requests"\s*\)/
);
assert.match(
  onboarding,
  /citationDismissedLast24Months,/
);
assert.match(
  onboardingValidation,
  /input\.citationDismissedLast24Months !== null/
);
assert.doesNotMatch(
  onboarding,
  /hasEvidenceRequests\s*&&[\s\S]{0,180}CITATION_DISMISSED_INTAKE_QUESTION/
);

assert.match(onboardingRoute, /isClientOnboardingLocked\(clientRecord\)/);
assert.match(onboardingRoute, /ONBOARDING_LOCKED/);
assert.match(onboardingRoute, /service_agreement_accepted, tier/);
assert.doesNotMatch(onboardingRoute, /FEATURE_NOT_IN_TIER/);
assert.match(onboardingRoute, /ensureCitationDispositionFollowup/);
assert.match(
  evidenceServer,
  /tierHasFeature\(client\.tier, "evidence_requests"\)/
);
assert.ok(
  onboardingRoute.indexOf("citation_dismissed_last_24_months:") <
    onboardingRoute.indexOf("ensureCitationDispositionFollowup(admin"),
  "the authoritative intake answer must be persisted before its follow-up request",
);
assert.ok(
  onboardingRoute.indexOf("ensureCitationDispositionFollowup(admin") <
    onboardingRoute.indexOf(".update(profileUpdate)"),
  "the follow-up request must exist before remaining onboarding fields can lock the route",
);

assert.match(
  requestAnswer,
  /`\/api\/portal\/requests\/\$\{requestId\}\/answer`/
);
assert.match(requestAnswer, /JSON\.stringify\(\{ answer: value \}\)/);
assert.match(requestAnswer, /type IntakeAnswer = "yes" \| "no"/);
assert.match(requestAnswer, /router\.refresh\(\)/);
assert.match(requestAnswer, /certified court disposition/);
assert.match(requestAnswer, /<fieldset/);
assert.match(requestAnswer, /min-h-10/);
assert.match(requestUpload, /statusCopy/);
assert.match(requestUpload, /evidenceStatus/);

assert.match(documentsPage, /<RequestAnswer/);
assert.match(documentsPage, /evidence_class/);
assert.match(documentsPage, /request_type/);
assert.match(documentsPage, /evidence_status/);
assert.match(
  documentsPage,
  /status\.eq\.open,evidence_status\.in\.\(submitted,applied,insufficient\)/
);
assert.match(documentsPage, /\.neq\("status", "cancelled"\)/);
assert.match(documentsPage, /submitted/);
assert.match(documentsPage, /applied/);
assert.match(documentsPage, /insufficient/);
assert.match(documentsPage, /strengthened your challenge/);
assert.match(
  documentsPage,
  /if \(request\.request_type === "question"\) \{\s*return \{\s*label: "Answered",\s*copy: request\.status_copy/
);
assert.match(documentsPage, /lifecycleStatus === "submitted"/);
assert.match(documentsPage, /lifecycleStatus === "insufficient"/);
assert.match(documentsPage, /"citation-dismissed": "Citation disposition"/);
assert.doesNotMatch(documentsPage, /"citation-dismissed": "Citation dismissed"/);
for (const field of [
  "request_type",
  "evidence_class",
  "why_copy",
  "potential_points",
  "evidence_status",
  "status_copy",
]) {
  assert.match(requestsApi, new RegExp(field));
}
assert.match(requestsApi, /\.neq\("status", "cancelled"\)/);

console.log(
  JSON.stringify(
    {
      passed: true,
      onboardingQuestion: "citation-dismissed",
      answerValues: ["yes", "no"],
      answerRoute: "/api/portal/requests/:requestId/answer",
      preservedOnboardingGuard: true,
      requestStatuses: ["open", "submitted", "applied", "insufficient"],
    },
    null,
    2
  )
);
