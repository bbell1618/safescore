import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isValidInviteEmail,
  normalizeInviteEmail,
  resolveInviteEmailStatus,
} from "../lib/portal/invites";

assert.equal(
  normalizeInviteEmail("  Portal.User+Test@Example.COM  "),
  "portal.user+test@example.com"
);
assert.equal(normalizeInviteEmail(undefined), "");
assert.equal(normalizeInviteEmail(123), "");
assert.equal(isValidInviteEmail("portal.user+test@example.com"), true);
assert.equal(isValidInviteEmail("missing-at.example.com"), false);
assert.equal(isValidInviteEmail("two@@example.com"), false);
assert.equal(isValidInviteEmail("space in@example.com"), false);
assert.equal(isValidInviteEmail("missing-tld@example"), false);
assert.equal(isValidInviteEmail(`a@${"b".repeat(316)}.com`), false);

assert.equal(
  resolveInviteEmailStatus({ dryRun: true, deliverySucceeded: true }),
  "dry_run"
);
assert.equal(
  resolveInviteEmailStatus({ dryRun: false, deliverySucceeded: true }),
  "sent"
);
assert.equal(
  resolveInviteEmailStatus({ dryRun: false, deliverySucceeded: false }),
  "failed"
);

const inviteRoute = readFileSync(
  "app/api/clients/[id]/invite/route.ts",
  "utf8"
);
assert.match(inviteRoute, /code: "EMAIL_ALREADY_LINKED"/);
assert.ok(
  inviteRoute.indexOf('.insert({') <
    inviteRoute.indexOf('.neq("id", invite.id)'),
  "A replacement invite must be inserted before older invites are expired"
);

console.log(
  "portal access invite checks passed: normalization + syntax validation + sent/dry-run/failed classification"
);
