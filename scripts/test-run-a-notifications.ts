import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const tierRoute = read("app/api/portal/onboarding-tier/route.ts");
const uploadRoute = read(
  "app/api/portal/requests/[requestId]/upload/route.ts"
);
const answerRoute = read(
  "app/api/portal/requests/[requestId]/answer/route.ts"
);
const monitoringRoute = read("app/api/cron/monitoring-refresh/route.ts");
const operations = read("lib/notifications/operations.ts");

assert.match(tierRoute, /trigger: "staff_tier_changed"/);
assert.match(tierRoute, /Assigned tier/);
assert.match(tierRoute, /Selected tier/);
assert.match(tierRoute, /selected_tier: result\.result_tier/);
assert.match(tierRoute, /console\/clients\/\$\{clientId\}\/account/);

assert.match(uploadRoute, /trigger: "staff_evidence_uploaded"/);
assert.match(uploadRoute, /uploadKind: "lane_b_evidence"/);
assert.match(uploadRoute, /uploadKind: "case_evidence"/);
assert.ok(
  (uploadRoute.match(/uploadKind: "requested_document"/g) ?? []).length >= 2,
  "both generic-document completion paths must notify operations"
);
assert.match(uploadRoute, /console\/clients\/\$\{clientId\}\/requests/);

assert.match(answerRoute, /trigger: "staff_intake_answered"/);
assert.match(answerRoute, /if \(!existingAnswer\)/);
assert.match(answerRoute, /followup_request_id/);
assert.match(answerRoute, /console\/clients\/\$\{access\.clientId\}\/requests/);

assert.match(monitoringRoute, /trigger: "staff_monitoring_alert"/);
assert.match(monitoringRoute, /emittedAlerts\.created\.length > 0/);
assert.match(monitoringRoute, /alert_types: alertTypes/);
assert.match(monitoringRoute, /alert_ids: emittedAlerts\.created\.map/);
assert.match(monitoringRoute, /operations_notifications_logged/);
assert.match(monitoringRoute, /console\/clients\/\$\{client\.id\}\/monitoring/);

assert.match(operations, /action_type: "operations_notification_email"/);
assert.match(operations, /email_delivery: deliveryMetadata/);
assert.match(operations, /if \(!delivery\.success\)/);
assert.match(operations, /status: result\.success/);
assert.match(operations, /result\.dryRun/);
assert.match(operations, /activity logging failed/);

console.log("Run A notification contract passed.");
