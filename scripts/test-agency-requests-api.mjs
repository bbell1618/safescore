import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const caseId = "147054ba-7ec6-44e5-aa4c-6788c099fbc3";
const reqId = "870ea15c-fcc2-4211-8329-536ba294eaa3";
const userId = "11111111-1111-4111-8111-111111111111";
let results = [], operations = [], staffError = null;
class OnboardingRouteFailure extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const service = { from(table) {
  const op = { table, filters: [] }; operations.push(op);
  const finish = () => {
    assert.ok(results.length, "Unexpected database call");
    return Promise.resolve(results.shift());
  };
  const query = {
    select() { return query; }, eq(...filter) { op.filters.push(filter); return query; },
    insert(value) { op.insert = value; return query; },
    update(value) { op.update = value; return query; },
    maybeSingle: finish, single: finish,
  };
  return query;
} };
const cache = new Map();
function load(file) {
  const absolute = resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(absolute, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = name => {
    if (name === "server-only") return {};
    if (name === "@/lib/supabase/server") return { createServiceClient: async () => service };
    if (name === "@/lib/onboarding/server") return { OnboardingRouteFailure, requireStaffOnboardingUser: async () => { if (staffError) throw staffError; return { userId, service }; } };
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
    if (name.startsWith(".")) return load(resolve(dirname(absolute), name + ".ts"));
    return nativeRequire(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: absolute })(require, compiledModule, compiledModule.exports);
  cache.set(absolute, compiledModule.exports);
  return compiledModule.exports;
}
const server = load("lib/cases/agency-requests.ts");
const post = load("app/api/cases/[kind]/[id]/agency-requests/route.ts").POST;
const patch = load("app/api/cases/[kind]/[id]/agency-requests/[reqId]/route.ts").PATCH;
const params = { params: Promise.resolve({ kind: "dataq", id: caseId, reqId }) };
const request = body => new Request("http://localhost/api/cases/dataq/case/agency-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const foundCase = { data: { id: caseId, client_id: clientId }, error: null };
const input = { requested_on: "2026-05-29", requesting_agency: "CHP", request_text: "  Verbatim\nagency ask  " };
const reset = rows => { results = rows; operations = []; staffError = null; };

for (const status of [401, 403]) {
  reset([]); staffError = new OnboardingRouteFailure("Forbidden test", status);
  assert.equal((await post(request(input), params)).status, 403);
  assert.equal((await patch(request({ action: "lapsed" }), params)).status, 403);
  assert.equal(operations.length, 0);
}
reset([]);
assert.equal((await post(request(input), { params: Promise.resolve({ kind: "unknown", id: caseId }) })).status, 400);
assert.equal(operations.length, 0);
reset([foundCase, foundCase, { data: { id: reqId }, error: null }]);
assert.equal((await post(request({ ...input, client_id: userId, case_kind: "cpdp", case_id: userId, created_by: clientId, status: "responded" }), params)).status, 201);
assert.deepEqual(operations[2].insert, { ...input, client_id: clientId, case_kind: "dataq", case_id: caseId, created_by: userId, status: "open", response_due: "2026-06-08", contact_name: null, contact_phone: null, contact_email: null });
reset([foundCase]);
await assert.rejects(server.createAgencyRequest({ ...input, client_id: userId, case_kind: "dataq", case_id: caseId, created_by: userId }), /Case not found for this client/);
assert.equal(operations.length, 1);
reset([]);
await assert.rejects(server.createAgencyRequest({ ...input, response_due: "2026-05-28", client_id: clientId, case_kind: "dataq", case_id: caseId, created_by: userId }), /Respond by cannot be before/);
assert.equal(operations.length, 0);
reset([foundCase, { data: null, error: null }]);
assert.equal((await patch(request({ action: "responded", date: "2026-06-01", notes: "Documents provided" }), params)).status, 404);
assert.deepEqual(operations[1].filters, [["id", reqId], ["case_kind", "dataq"], ["case_id", caseId], ["client_id", clientId]]);
reset([foundCase, { data: { id: reqId }, error: null }, { data: { id: reqId, status: "responded" }, error: null }]);
assert.equal((await patch(request({ action: "responded", date: "2026-06-01", notes: "Documents provided" }), params)).status, 200);
assert.deepEqual(operations[2].update, { status: "responded", response_notes: "Documents provided", responded_on: "2026-06-01" });
assert.deepEqual(operations[2].filters, [["id", reqId], ["status", "open"]]);
reset([]);
await assert.rejects(server.markResponded(reqId, "2026-06-01", "short"), /at least 10 characters/);
await assert.rejects(server.markResponded(reqId, "2026-02-30", "Documents provided"), /valid YYYY-MM-DD/);
assert.equal(operations.length, 0);
reset([{ data: null, error: null }]);
await assert.rejects(server.markLapsed(reqId, "No response sent"), /no longer open/);
reset([foundCase, foundCase, { data: null, error: { message: "database unavailable" } }]);
const failed = await post(request(input), params);
assert.equal(failed.status, 500);
assert.match((await failed.json()).error, /database unavailable/);
assert.ok(operations.every(op => ["dataq_cases", "case_agency_requests"].includes(op.table)));
console.log("Agency request API/module: staff denial, unknown kind, authoritative ownership, defaults, scope isolation, open-only transitions, validation, real failures passed.");
