import assert from "node:assert/strict";
import { collectEmailPreviews } from "./email-preview-harness.mjs";

const previews = await collectEmailPreviews();
assert.equal(previews.length, 13);
for (const preview of previews) {
  const visible = preview.htmlBody.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ");
  assert.doesNotMatch(visible + preview.subject, /\b(?:BASIC|CPDP|DataQ|RDR|CDL|intake|pending_state|pending_fmcsa)\b/);
  assert.doesNotMatch(visible, /396\.3\(a\)\(1\)|undefined|\[object Object\]/);
  if (preview.function !== "sendPasswordRecoveryEmail") assert.match(preview.htmlBody, /Nationwide Carrier Inc/);
  assert.match(preview.htmlBody, /https:\/\/safescore\.vercel\.app\//);
}
const cases = previews.filter(row => row.function === "sendCaseStatusChange");
assert.equal(cases.length, 2);
assert.match(cases[0].htmlBody, /Agency decision received/);
assert.match(cases[1].htmlBody, /state agency/);
console.log("PASS: all 12 application templates, both case types, plain copy, no transport or secrets");
