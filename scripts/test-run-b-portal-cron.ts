import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildComplianceHealth,
  complianceThresholdForDays,
} from "../lib/compliance/health";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

for (const [days, expected] of [
  [61, null],
  [60, "60_day"],
  [31, "60_day"],
  [30, "30_day"],
  [8, "30_day"],
  [7, "7_day"],
  [1, "7_day"],
  [0, "expired"],
  [-1, "expired"],
] as const) {
  assert.equal(
    complianceThresholdForDays(days),
    expected,
    `threshold boundary for ${days} days`
  );
}

const healthWithoutChecklistRows = buildComplianceHealth({
  asOfDate: "2026-08-04",
  drivers: [
    {
      id: "driver-1",
      full_name: "Test Driver",
      status: "active",
      cdl_expiry: "2026-09-03",
      medical_cert_expiry: "2026-08-11",
    },
  ],
  driverDocuments: [],
  vehicles: [],
  clearinghouseRecords: [],
});
assert.equal(healthWithoutChecklistRows.upcoming.length, 2);
assert.ok(
  healthWithoutChecklistRows.upcoming.every(
    (item) => item.driverDocumentId === null
  ),
  "an expiring credential remains a candidate when its DQF row is absent"
);

const sweep = read("lib/compliance/expiration-sweep.ts");
assert.match(
  sweep,
  /\.from\("driver_documents"\)[\s\S]*?\.insert\(\{[\s\S]*?status: "missing"/,
  "the renewal path establishes an absent DQF checklist row as missing"
);
assert.match(
  sweep,
  /insertChecklistError\.code !== "23505"[\s\S]*?Concurrent \$\{docType\} checklist creation/,
  "concurrent checklist creation reloads the unique driver/type row"
);
assert.match(
  sweep,
  /entity_type: "compliance_expiration_events",\s*entity_id: input\.event\.id/,
  "alerts carry their compliance-event dedupe identity"
);
assert.match(
  sweep,
  /alertError\.code !== "23505"[\s\S]*?\.eq\("entity_type", "compliance_expiration_events"\)[\s\S]*?\.eq\("entity_id", input\.event\.id\)/,
  "an alert retry reloads the event-scoped alert after a unique conflict"
);
const noEventsIndex = sweep.indexOf("if (claimedEvents.length === 0)");
const notifyIndex = sweep.indexOf("const notification = await notifyOperations");
assert.ok(noEventsIndex > 0 && notifyIndex > noEventsIndex);
assert.match(
  sweep.slice(noEventsIndex, notifyIndex),
  /operationsNotification: "not_needed"/,
  "a no-event digest returns before operations email delivery"
);
assert.doesNotMatch(
  sweep,
  /\.from\("clients"\)[\s\S]{0,200}\.update\(/,
  "the compliance sweep never writes billing/client rows"
);
const availableEventsIndex = sweep.indexOf("const eventsToClaim: ExpirationEvent[] = []");
const claimEventsIndex = sweep.indexOf("const claimedEvents: ExpirationEvent[] = []");
assert.ok(availableEventsIndex > 0 && claimEventsIndex > availableEventsIndex);
assert.match(
  sweep.slice(availableEventsIndex, claimEventsIndex),
  /currentCandidate\?\.threshold === event\.threshold[\s\S]*?superseded_by_current_compliance_state/,
  "failed or stale work for a corrected, inactive, or older-threshold record is terminalized before claim"
);
assert.match(
  sweep.slice(availableEventsIndex, claimEventsIndex),
  /event\.alert_id[\s\S]*?dismissed_at: nowIso[\s\S]*?\.eq\("client_id", input\.clientId\)/,
  "an alert already minted for superseded work is dismissed with client scope"
);

const cron = read("app/api/cron/monitoring-refresh/route.ts");
const sweepCall = cron.indexOf("await runComplianceExpirationSweep");
const refreshCall = cron.indexOf("const refresh = await runClientRefresh");
assert.ok(
  sweepCall > 0 && refreshCall > sweepCall,
  "the independent compliance sweep runs before the FMCSA refresh"
);
assert.match(
  cron.slice(sweepCall, refreshCall),
  /catch \(sweepError\)/,
  "a compliance failure is isolated so FMCSA refresh can continue"
);

const portalPage = read("app/(portal)/portal/compliance/page.tsx");
assert.ok(
  portalPage.indexOf("if (!access.allowed)") < portalPage.indexOf('.from("drivers")'),
  "the portal compliance page fails closed before querying compliance rows"
);
for (const expectedCopy of [
  "Drivers and qualification files",
  "Vehicles and annual inspections",
  "Upcoming expirations",
  "Clearinghouse registration",
  "No driver roster is on file yet",
  "No vehicle roster is on file yet",
]) {
  assert.match(portalPage, new RegExp(expectedCopy));
}

const nav = read("components/portal/nav.tsx");
assert.match(nav, /label: "Compliance"[\s\S]*?feature: "compliance_layer"[\s\S]*?entitledOnly: true/);
assert.match(nav, /visibleNavItems = navItems\.filter/);

const upload = read("app/api/portal/requests/[requestId]/upload/route.ts");
const renewalStart = upload.indexOf('queueItem.category === "compliance_renewal"');
const laneBStart = upload.indexOf("isLaneBEvidenceUpload", renewalStart);
const renewalBranch = upload.slice(renewalStart, laneBStart);
assert.match(renewalBranch, /client_request_id: requestId/);
assert.match(renewalBranch, /\.update\(\{ document_id: documentRow\.id, updated_at: now \}\)/);
assert.doesNotMatch(
  renewalBranch,
  /\.update\(\{[^}]*expiry_date/,
  "a portal upload links the DQF document but does not infer a new expiry"
);

console.log("Run B portal + cron checks passed (thresholds, gating, idempotency, upload linkage, and job ordering). ");
