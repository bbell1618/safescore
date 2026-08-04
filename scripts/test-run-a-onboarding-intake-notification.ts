import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { didCitationDismissedAnswerChange } from "../lib/onboarding/validation";

assert.equal(didCitationDismissedAnswerChange(null, true), true);
assert.equal(didCitationDismissedAnswerChange(null, false), true);
assert.equal(didCitationDismissedAnswerChange(true, false), true);
assert.equal(didCitationDismissedAnswerChange(false, true), true);
assert.equal(didCitationDismissedAnswerChange(true, true), false);
assert.equal(didCitationDismissedAnswerChange(false, false), false);
assert.equal(didCitationDismissedAnswerChange(null, undefined), false);

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("app/api/portal/onboarding-profile/route.ts");
const operations = read("lib/notifications/operations.ts");

assert.match(
  route,
  /citation_dismissed_last_24_months[\s\S]*?didCitationDismissedAnswerChange/
);
assert.match(
  route,
  /previousCitationAnswer === null[\s\S]*?\.is\("citation_dismissed_last_24_months", null\)[\s\S]*?\.eq\([\s\S]*?"citation_dismissed_last_24_months"/
);
assert.match(
  route,
  /Another identical request won the guarded update[\s\S]*?citationAnswerChanged = false/
);
assert.match(
  route,
  /if \(citationAnswerChanged\)[\s\S]*?await notifyOperations\(admin, \{/
);
assert.match(route, /event: "intake_question_answered"/);
assert.match(route, /trigger: "staff_intake_answered"/);
assert.match(route, /console\/clients\/\$\{clientId\}\/requests/);
assert.match(route, /previous_answer: previousCitationAnswer/);
assert.match(route, /answer: body\.citationDismissedLast24Months/);
assert.match(route, /followup_request_id: followupRequestId/);
assert.match(route, /operations notification failed/);
assert.match(operations, /\| "intake_question_answered"/);
assert.match(operations, /email_delivery: deliveryMetadata/);

console.log(
  "Run A onboarding intake notification checks passed (yes/no change, same-answer idempotency, guarded concurrency, dry-run delivery metadata, and failure surfacing)."
);
