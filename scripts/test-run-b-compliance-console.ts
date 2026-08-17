import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildComplianceHealth } from "../lib/compliance/health";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const routeFiles = [
  "app/api/clients/[id]/drivers/route.ts",
  "app/api/clients/[id]/drivers/[driverId]/route.ts",
  "app/api/clients/[id]/drivers/[driverId]/dqf/route.ts",
  "app/api/clients/[id]/drivers/[driverId]/review/route.ts",
  "app/api/clients/[id]/vehicles/route.ts",
  "app/api/clients/[id]/vehicles/[vehicleId]/route.ts",
  "app/api/clients/[id]/vehicles/[vehicleId]/maintenance/route.ts",
  "app/api/clients/[id]/clearinghouse-records/route.ts",
  "app/api/clients/[id]/compliance-profile/route.ts",
];

for (const path of routeFiles) {
  const source = read(path);
  assert.match(source, /requireStaffOnboardingUser\(\)/, `${path} must authenticate staff`);
  assert.match(source, /\.strict\(\)/, `${path} must reject unknown payload fields`);
  assert.match(source, /\.uuid\(\)/, `${path} must validate UUIDs`);
  assert.match(source, /activity_log/, `${path} must write an activity log`);
  assert.doesNotMatch(source, /driver_count|subscription|monthly_rate/, `${path} must not touch billing`);
}

for (const path of [
  "app/api/clients/[id]/drivers/[driverId]/route.ts",
  "app/api/clients/[id]/drivers/[driverId]/dqf/route.ts",
  "app/api/clients/[id]/drivers/[driverId]/review/route.ts",
  "app/api/clients/[id]/vehicles/[vehicleId]/route.ts",
  "app/api/clients/[id]/vehicles/[vehicleId]/maintenance/route.ts",
  "app/api/clients/[id]/clearinghouse-records/route.ts",
]) {
  assert.match(
    read(path),
    /\.eq\("client_id",/,
    `${path} must scope child records to the route client`
  );
}

for (const path of [
  "app/api/clients/[id]/drivers/[driverId]/dqf/route.ts",
  "app/api/clients/[id]/vehicles/[vehicleId]/maintenance/route.ts",
  "app/api/clients/[id]/clearinghouse-records/route.ts",
]) {
  const source = read(path);
  assert.match(source, /\.from\("documents"\)/, `${path} must verify linked documents`);
  assert.match(source, /DOCUMENT_NOT_FOUND/, `${path} must reject cross-client or absent documents`);
}

const dqfRoute = read("app/api/clients/[id]/drivers/[driverId]/dqf/route.ts");
assert.match(dqfRoute, /driver_id: ids\.data\.driverId/);
assert.match(dqfRoute, /driver_id,doc_type/);
assert.match(dqfRoute, /medical_cert_expiry/);
assert.match(dqfRoute, /cdl_expiry/);
assert.match(dqfRoute, /\.superRefine\(/, "DQF route must enforce conditional date requirements");
assert.match(dqfRoute, /value\.doc_type === "annual_mvr_review"/);
assert.match(dqfRoute, /value\.doc_type === "medical_cert" \|\| value\.doc_type === "cdl"/);
assert.match(dqfRoute, /item\.status !== "missing"/, "missing DQF records must not clear canonical driver expiries");

const maintenanceRoute = read(
  "app/api/clients/[id]/vehicles/[vehicleId]/maintenance/route.ts"
);
assert.match(maintenanceRoute, /annual_inspection/);
assert.match(maintenanceRoute, /annual_inspection_date/);

const page = read("app/(console)/console/clients/[id]/compliance/page.tsx");
for (const required of [
  "ServiceTierChip",
  "buildComplianceHealth",
  "DriverRosterSection",
  "VehicleRosterSection",
  "ClearinghouseSection",
  "Mcs150TruthUpSection",
  "portal and automated compliance sweep remain locked",
]) {
  assert.ok(page.includes(required), `console page is missing ${required}`);
}
assert.doesNotMatch(page, /\.eq\("status", "active"\)/, "console roster must retain inactive records");
assert.doesNotMatch(
  page,
  /\.select\(\s*"[^"]*(driver_count|monthly_rate|subscription)/,
  "console health must not query billing counts"
);

const components = [
  "components/console/compliance/driver-roster-section.tsx",
  "components/console/compliance/vehicle-roster-section.tsx",
  "components/console/compliance/clearinghouse-section.tsx",
].map(read).join("\n");
for (const copy of [
  "No compliance drivers recorded",
  "No compliance vehicles recorded",
  "Add the active driver roster first",
  "Record a query",
  "Log maintenance",
]) {
  assert.ok(components.includes(copy), `managed console copy is missing: ${copy}`);
}
assert.doesNotMatch(components, /method:\s*["']DELETE["']/, "console must not expose delete mutations");
assert.match(components, /never change the service-plan driver count used for billing/);
assert.match(components, /Commercial driver&apos;s license|Commercial driver's license/);
assert.match(components, /Add the credential expiration date before marking it on file/);

const sampleHealth = buildComplianceHealth({
  asOfDate: "2026-08-04",
  drivers: [
    {
      id: "driver-1",
      full_name: "Test Driver",
      status: "active",
      cdl_expiry: "2026-08-11",
      medical_cert_expiry: "2026-09-03",
      approved_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "driver-2",
      full_name: "Former Driver",
      status: "terminated",
      cdl_expiry: null,
      medical_cert_expiry: null,
      approved_at: "2026-01-01T00:00:00.000Z",
    },
  ],
  driverDocuments: [],
  vehicles: [
    {
      id: "vehicle-1",
      unit_number: "ZZ-01",
      status: "active",
      annual_inspection_date: "2025-08-05",
    },
  ],
  clearinghouseRecords: [],
});
assert.equal(sampleHealth.drivers.total, 1, "only active drivers belong in health counts");
assert.equal(sampleHealth.vehicles.expiring, 1, "annual inspection should derive as expiring");
assert.ok(
  sampleHealth.upcoming.some((item) => item.itemType === "cdl" && item.threshold === "7_day"),
  "CDL 7-day threshold should be represented"
);

console.log("Run B compliance console/API contract: PASS");
console.log(`Secured mutation routes checked: ${routeFiles.length}`);
console.log("Managed surfaces checked: drivers/DQF, vehicles/maintenance, Clearinghouse");
