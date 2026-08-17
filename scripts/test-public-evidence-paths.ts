import assert from "node:assert/strict";
import {
  isPublicEvidencePagePath,
  isPublicEvidenceUploadPath,
  isPublicRosterApiPath,
  isPublicRosterPagePath,
} from "../lib/auth/public-paths";

assert.equal(isPublicEvidencePagePath("/evidence/invite-token"), true);
assert.equal(isPublicEvidencePagePath("/evidence/invite-token/extra"), false);
assert.equal(isPublicEvidencePagePath("/evidence"), false);
assert.equal(isPublicEvidencePagePath("/portal/evidence/invite-token"), false);

assert.equal(isPublicEvidenceUploadPath("/api/evidence/invite-token/upload"), true);
assert.equal(isPublicEvidenceUploadPath("/api/evidence/invite-token"), false);
assert.equal(isPublicEvidenceUploadPath("/api/evidence/invite-token/upload/extra"), false);

assert.equal(isPublicRosterPagePath("/roster/invite-token"), true);
assert.equal(isPublicRosterPagePath("/roster/invite-token/extra"), false);
assert.equal(isPublicRosterApiPath("/api/roster/invite-token"), true);
assert.equal(isPublicRosterApiPath("/api/roster/invite-token/drivers"), true);
assert.equal(
  isPublicRosterApiPath("/api/roster/invite-token/drivers/driver-id"),
  true
);
assert.equal(
  isPublicRosterApiPath(
    "/api/roster/invite-token/drivers/driver-id/documents"
  ),
  true
);
assert.equal(isPublicRosterApiPath("/api/roster/invite-token/submit"), true);
assert.equal(isPublicRosterApiPath("/api/roster/invite-token/submit/extra"), false);
assert.equal(isPublicRosterApiPath("/api/roster/invite-token/other"), false);

console.log(
  JSON.stringify(
    {
      passed: true,
      publicEvidencePage: "/evidence/<token>",
      publicEvidenceUpload: "/api/evidence/<token>/upload",
      publicRosterPage: "/roster/<token>",
      publicRosterApi: "/api/roster/<token>/...",
      extraSegmentsRejected: true,
    },
    null,
    2
  )
);
