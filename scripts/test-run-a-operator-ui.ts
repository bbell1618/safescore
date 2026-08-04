import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const account = read("app/(console)/console/clients/[id]/account/page.tsx");
assert.match(account, />FMCSA data access</);
assert.match(account, />\s*FMCSA Portal PIN\s*</);
assert.match(account, /boolVariant\(hasFmcsaPortalPin\)/);
assert.match(account, /boolLabel\(hasFmcsaPortalPin\)/);
assert.match(
  account,
  /\.select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.not\("fmcsa_pin_encrypted", "is", null\)/
);
assert.doesNotMatch(
  account,
  /\.select\([^)]*fmcsa_pin_encrypted/,
  "The console may test PIN presence but must never select the PIN value"
);
assert.match(account, /FmcsaPinRequestControl/);

const pinControl = read(
  "components/console/fmcsa-pin-request-control.tsx"
);
assert.match(pinControl, /"Request from client"/);
assert.match(pinControl, /fmcsa-pin-request/);
assert.match(pinControl, /role="alert"/);

const pinRoute = read(
  "app/api/clients/[id]/fmcsa-pin-request/route.ts"
);
assert.match(pinRoute, /requireStaffOnboardingUser/);
assert.match(pinRoute, /sendFmcsaPinRequestEmail/);
assert.match(pinRoute, /category: REQUEST_CATEGORY/);
assert.match(pinRoute, /action_type: "fmcsa_pin_requested"/);
assert.match(pinRoute, /email_delivery: emailDelivery/);
assert.match(pinRoute, /PIN_REQUEST_EMAIL_FAILED/);
assert.match(pinRoute, /Do not send the PIN through ordinary email/);

const portalDocuments = read("app/(portal)/portal/documents/page.tsx");
assert.match(portalDocuments, /request\.category === "fmcsa_portal_pin"/);
assert.match(portalDocuments, /!isFmcsaPinRequest &&/);
assert.match(
  portalDocuments,
  /if \(!includeEvidenceRequests\)[\s\S]*?query = query\.eq\("category", "fmcsa_portal_pin"\)/
);
assert.match(portalDocuments, /requestFeatureLocked=\{!canSeeRequests\}/);
assert.match(portalDocuments, /Where to find your PIN/);
assert.match(portalDocuments, /Secure\s+online PIN handoff is not available yet/);

const activation = read(
  "components/console/client-activation-control.tsx"
);
const clientLayout = read("app/(console)/console/clients/[id]/layout.tsx");
assert.match(activation, /Confirm payment & activate/);
assert.doesNotMatch(activation, /Confirm payment and activate/);
assert.match(clientLayout, /<ClientActivationControl/);
assert.match(clientLayout, /status=\{client\.status\}/);
assert.doesNotMatch(account, /<ClientActivationControl/);

console.log("Run A operator UI contract passed.");
