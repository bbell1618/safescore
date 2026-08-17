import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const server = read("lib/roster-collection/server.ts");
assert.match(server, /import "server-only"/);
assert.match(server, /\.eq\("upload_token", parsed\.data\)/);
assert.match(server, /row\.request_type !== "roster_collection"/);
assert.match(server, /row\.status !== "open"/);
assert.match(server, /client\.tier !== "total_safety"/);
assert.doesNotMatch(server, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
const collectionLoader = server.slice(
  server.indexOf("export async function loadRosterCollection"),
  server.indexOf("export async function loadScopedStagedDriver")
);
assert.match(collectionLoader, /approved_at/);
assert.doesNotMatch(collectionLoader, /\.is\("approved_at", null\)/);

const mutationRoutes = [
  "app/api/roster/[token]/drivers/route.ts",
  "app/api/roster/[token]/drivers/[driverId]/route.ts",
  "app/api/roster/[token]/drivers/[driverId]/documents/route.ts",
  "app/api/roster/[token]/submit/route.ts",
].map(read);
for (const route of mutationRoutes) {
  assert.match(route, /resolveOpenRosterRequest\(token\)/);
  assert.doesNotMatch(route, /client_id\s*[:=]\s*(parsed|body|form)/);
}

const driverItem = mutationRoutes[1];
assert.match(driverItem, /\.eq\("request_id", resolved\.request\.id\)/);
assert.match(driverItem, /\.eq\("source", "client_portal"\)/);
assert.match(driverItem, /\.is\("approved_at", null\)/);

const upload = mutationRoutes[2];
assert.match(upload, /form\.get\("docType"\)/);
assert.match(server, /status: "pending_review"/);
assert.match(server, /doc_type: input\.docType/);
assert.match(server, /status: "missing"/);
assert.match(server, /cleanupNewDocument/);
assert.doesNotMatch(server, /\.upsert\(/);
assert.match(server, /ROSTER_DOCUMENT_CHANGED_CONCURRENTLY/);
const publicDelete = server.slice(
  server.indexOf("export async function deleteStagedDriverWithDocuments")
);
assert.ok(
  publicDelete.indexOf(".remove(documents.map") <
    publicDelete.indexOf('.from("drivers")\n    .delete()'),
  "public rejection must keep the driver until storage cleanup succeeds"
);

const submit = mutationRoutes[3];
assert.match(submit, /submitted_at: submittedAt/);
assert.match(submit, /next_reminder_at: null/);
assert.doesNotMatch(submit, /status:\s*"fulfilled"/);
assert.doesNotMatch(submit, /\.is\("approved_at", null\)/);

const genericUpload = read(
  "app/api/portal/requests/[requestId]/upload/route.ts"
);
assert.match(
  genericUpload,
  /queueItem\.request_type === "roster_collection"/
);
assert.match(genericUpload, /ROSTER_WIZARD_REQUIRED/);

const requestRoute = read(
  "app/api/clients/[id]/driver-roster-request/route.ts"
);
assert.match(requestRoute, /`roster_collection:\$\{clientId\}`/);
assert.match(requestRoute, /upload_token: rotatedToken/);
assert.match(requestRoute, /created_at: nowIso/);
assert.match(requestRoute, /\.neq\("status", "open"\)/);
assert.match(requestRoute, /request_type: "roster_collection"/);

const closeRoute = read(
  "app/api/clients/[id]/driver-roster-request/[requestId]/close/route.ts"
);
assert.match(closeRoute, /requestRow\.submitted_at/);
assert.match(closeRoute, /ROSTER_REVIEW_PENDING/);
assert.match(closeRoute, /status: "fulfilled"/);

const email = read("lib/email/client.ts");
assert.match(email, /Driver list needed — \$\{data\.companyName\}/);
assert.match(email, /No login or password is needed/);

console.log(
  JSON.stringify(
    {
      passed: true,
      serviceRoleOnlyTokenResolver: true,
      mutationTenantScope: true,
      uploadCleanupGuard: true,
      lifecycleCloseGuard: true,
      genericUploadRejected: true,
    },
    null,
    2
  )
);
