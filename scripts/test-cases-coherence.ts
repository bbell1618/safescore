import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FiledAuthorizationStatus } from "../components/console/filed-authorization-status";
import {
  cpdpFiledTimelineLabel,
  filedAuthorizationPresentation,
} from "../lib/cases/presentation";
import { caseStatusLabel } from "../lib/utils";

assert.equal(caseStatusLabel("filed"), "Filed / Pending FMCSA");
assert.equal(
  cpdpFiledTimelineLabel("2026-06-09"),
  "Filed Jun 9 \u00B7 determination expected ~Aug 10"
);
assert.equal(cpdpFiledTimelineLabel(null), null);
assert.equal(cpdpFiledTimelineLabel("not-a-date"), null);
assert.deepEqual(filedAuthorizationPresentation(true), {
  state: "recorded",
  message: "Signed filing authorization on file for this filing.",
});
assert.deepEqual(filedAuthorizationPresentation(false), {
  state: "missing",
  message:
    "No signed filing authorization on file for this filing \u2014 upload in onboarding Step 3.",
});

const missingAuthorizationHtml = renderToStaticMarkup(
  createElement(FiledAuthorizationStatus, {
    clientId: "synthetic-client",
    filingAuthorized: false,
    filingAuthorizedBy: null,
    filingAuthorizationScope: null,
  })
);
assert.match(
  missingAuthorizationHtml,
  /No signed filing authorization on file for this filing — upload in onboarding Step 3\./
);
assert.doesNotMatch(missingAuthorizationHtml, /obtain the client/i);

const recordedAuthorizationHtml = renderToStaticMarkup(
  createElement(FiledAuthorizationStatus, {
    clientId: "synthetic-client",
    filingAuthorized: true,
    filingAuthorizedBy: "Synthetic Safety Officer",
    filingAuthorizationScope: "DataQ and CPDP filings",
  })
);
assert.match(recordedAuthorizationHtml, /Signed filing authorization on file for this filing\./);
assert.match(
  recordedAuthorizationHtml,
  /href="\/console\/clients\/synthetic-client\/account"/
);

console.log("cases coherence presentation tests passed");
