import assert from "node:assert/strict";
import {
  isPublicEvidencePagePath,
  isPublicEvidenceUploadPath,
} from "../lib/auth/public-paths";

assert.equal(isPublicEvidencePagePath("/evidence/invite-token"), true);
assert.equal(isPublicEvidencePagePath("/evidence/invite-token/extra"), false);
assert.equal(isPublicEvidencePagePath("/evidence"), false);
assert.equal(isPublicEvidencePagePath("/portal/evidence/invite-token"), false);

assert.equal(isPublicEvidenceUploadPath("/api/evidence/invite-token/upload"), true);
assert.equal(isPublicEvidenceUploadPath("/api/evidence/invite-token"), false);
assert.equal(isPublicEvidenceUploadPath("/api/evidence/invite-token/upload/extra"), false);

console.log(
  JSON.stringify(
    {
      passed: true,
      publicEvidencePage: "/evidence/<token>",
      publicEvidenceUpload: "/api/evidence/<token>/upload",
      extraSegmentsRejected: true,
    },
    null,
    2
  )
);
