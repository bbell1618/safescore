import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(
    /\r\n/g,
    "\n"
  );
}

const migration = read(
  "supabase/migrations/20260817214729_client_roster_collection_flow.sql"
);
for (const required of [
  "source text",
  "approved_at timestamptz",
  "approved_by uuid",
  "request_id uuid",
  "notes text",
  "drivers_source_check",
  "drivers_request_client_fkey",
  "client_requests_request_type_check",
  "'roster_collection'",
  "idx_drivers_pending_review",
  "idx_drivers_request_client",
]) {
  assert.ok(migration.includes(required), `migration must include ${required}`);
}
assert.match(
  migration,
  /set approved_at = created_at[\s\S]*where source = 'operator'[\s\S]*approved_at is null/i
);
assert.match(
  migration,
  /foreign key \(request_id, client_id\)[\s\S]*references public\.client_requests \(id, client_id\)/i
);
assert.match(migration, /request_type is null/i);

const health = read("lib/compliance/health.ts");
assert.match(
  health,
  /driver\.status === "active" && driver\.approved_at !== null/
);
assert.match(health, /complianceDocumentExpiryStatus/);

const sweep = read("lib/compliance/expiration-sweep.ts");
assert.match(
  sweep,
  /from\("drivers"\)[\s\S]*?\.not\("approved_at", "is", null\)[\s\S]*?\.order\("id"\)/
);

for (const route of [
  "app/api/clients/[id]/drivers/[driverId]/route.ts",
  "app/api/clients/[id]/drivers/[driverId]/dqf/route.ts",
  "app/api/clients/[id]/clearinghouse-records/route.ts",
  "app/api/portal/requests/[requestId]/upload/route.ts",
]) {
  assert.match(
    read(route),
    /\.not\("approved_at", "is", null\)/,
    `${route} must reject pending drivers`
  );
}

const createDriver = read("app/api/clients/[id]/drivers/route.ts");
for (const required of [
  'source: "operator"',
  "approved_at: now",
  "approved_by: userId",
  "request_id: null",
]) {
  assert.ok(createDriver.includes(required), `staff driver insert must set ${required}`);
}

const review = read(
  "app/api/clients/[id]/drivers/[driverId]/review/route.ts"
);
assert.match(review, /action: z\.literal\("approve"\)/);
assert.match(review, /\.eq\("source", "client_portal"\)/);
assert.match(review, /\.is\("approved_at", null\)/);
assert.match(review, /\.update\(\{ status: "reviewed" \}\)/);
assert.match(review, /complianceDocumentExpiryStatus\(expiryDate, asOfDate\)/);
assert.match(review, /\.from\("documents"\)[\s\S]*?\.remove\(storagePaths\)/);
const rejectStart = review.indexOf("export async function DELETE");
const rejectFlow = review.slice(rejectStart);
assert.ok(
  rejectFlow.indexOf(".remove(storagePaths)") <
    rejectFlow.indexOf('.from("drivers")\n      .delete()'),
  "staff rejection must preserve the retry anchor until storage cleanup succeeds"
);
assert.doesNotMatch(review, /notes: nullableText/);
const childReview = review.indexOf('.update({ status: "reviewed" })');
const driverApproval = review.indexOf(
  "const { data: driver, error: updateError }"
);
assert.ok(childReview >= 0 && childReview < driverApproval);

const checklistRules = read("lib/operator/checklist-rules.ts");
assert.match(checklistRules, /request\.requestType === "evidence"/);
assert.match(checklistRules, /request\.requestType === "question"/);
assert.match(checklistRules, /ruleKey: "compliance\.roster_review"/);
assert.match(checklistRules, /kind: "request_driver_roster"/);
assert.match(checklistRules, /kind: "copy_roster_link"/);

const checklistServer = read("lib/operator/checklist-server.ts");
assert.match(
  checklistServer,
  /source, approved_at, request_id, created_at/
);
assert.match(
  checklistServer,
  /const drivers = allDrivers\.filter\(\(driver\) => driver\.approved_at !== null\)/
);
assert.match(
  checklistServer,
  /href:[\s\S]*itemValue\.href\.trim\(\) \|\|[\s\S]*\/checklist/
);

const supabaseTypes = read("lib/supabase/types.ts");
assert.match(
  supabaseTypes,
  /request_type: "evidence" \| "question" \| "roster_collection" \| null/
);
assert.match(supabaseTypes, /source: "operator" \| "client_portal"/);

const sop = read("docs/OPERATOR_SOP.md");
const billingBoundary = `### The billing boundary

- \`clients.driver_count\` is the client-attested service-plan count used for billing.
- Compliance driver rows are operational records.
- Adding, terminating, or correcting a compliance driver must never change the plan count or MRR automatically.
- If billing needs to change, use the approved subscription process separately.`;
assert.ok(sop.includes(billingBoundary), "SOP billing boundary must remain verbatim");
assert.match(sop, /### Request and review the driver list/);
assert.match(sop, /Only approved driver rows feed DQF gaps/);

console.log(
  JSON.stringify(
    {
      passed: true,
      migration: "20260817214729_client_roster_collection_flow",
      approvedOnlyConsumersChecked: 6,
      checklistRules: [
        "compliance.roster_empty",
        "compliance.roster_review",
      ],
      reviewOrdering: "credential rows and documents before approved_at",
      billingBoundaryPreserved: true,
    },
    null,
    2
  )
);
