import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const id = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
let rows = [], operations = [], authError = null;
class OnboardingRouteFailure extends Error {
  constructor(status) { super("Staff required"); this.status = status; }
}
const service = { from(table) {
  const op = { table, filters: [] }; operations.push(op);
  const query = {
    select() { return query; },
    update(value) { op.update = value; return query; },
    eq(...filter) { op.filters.push(filter); return query; },
    or(value) { op.or = value; return query; },
    order() { return query; }, limit() { return query; },
    maybeSingle: async () => { assert.ok(rows.length, "Unexpected DB operation"); return rows.shift(); },
  }; return query;
} };
function load(path) {
  const compiled = { exports: {} };
  const require = name => {
    if (name === "server-only") return {};
    if (name === "@/lib/onboarding/server") return { OnboardingRouteFailure, requireStaffOnboardingUser: async () => { if (authError) throw authError; return { service, userId }; } };
    if (name === "@/lib/supabase/server") return { createServiceClient: async () => service };
    if (name === "@/lib/tiers") return load("lib/tiers.ts");
    return nativeRequire(name);
  };
  const code = ts.transpileModule(readFileSync(path,"utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require,compiled,compiled.exports);
  return compiled.exports;
}
const patch = load("app/api/playbooks/[id]/review/route.ts").PATCH;
const request = action => new Request("http://localhost/review", { method: "PATCH", body: JSON.stringify({ action }) });
const params = { params: Promise.resolve({ id }) };
const reset = values => { rows = values; operations = []; authError = null; };
const found = status => ({ data: { id, client_id: clientId, review_status: status }, error: null });
const tier = { data: { tier: "remediate" }, error: null };
for (const status of [401,403]) {
  reset([]); authError = new OnboardingRouteFailure(status);
  assert.equal((await patch(request("review"),params)).status,status);
  assert.equal(operations.length,0);
}
reset([]); assert.equal((await patch(request("delete"),params)).status,400);
for (const state of [null,"draft","published"]) {
  reset([found(state),tier]);
  assert.equal((await patch(request("publish"),params)).status,409);
  assert.ok(operations.every(op=>!op.update));
}
for (const [action, before, after] of [["review","draft","reviewed"],["publish","reviewed","published"]]) {
  reset([found(before),tier,{data:{id,review_status:after},error:null}]);
  const response=await patch(request(action),params);
  assert.equal(response.status,200);
  assert.equal((await response.json()).review_status,after);
  const op=operations.at(-1);
  assert.deepEqual(op.filters,[["id",id],["client_id",clientId],["review_status",before]]);
  assert.equal(op.update[action === "review" ? "reviewed_by" : "published_by"],userId);
  assert.ok(!Number.isNaN(Date.parse(op.update[action === "review" ? "reviewed_at" : "published_at"])));
}
reset([found("reviewed"),tier,{data:null,error:null}]);
assert.equal((await patch(request("publish"),params)).status,409);
reset([found("draft"),{data:{tier:"monitor"},error:null}]);
assert.equal((await patch(request("review"),params)).status,403);
reset([{data:null,error:{message:"database unavailable"}}]);
assert.equal((await (await patch(request("review"),params)).json()).error,"Unable to load playbook: database unavailable");
reset([{data:null,error:null}]);
assert.equal(await load("lib/portal/playbook-server.ts").loadLatestPortalPlaybook(clientId),null);
assert.deepEqual(operations[0].filters,[["client_id",clientId]]);
assert.equal(operations[0].or,"review_status.is.null,review_status.eq.published");
assert.match(readFileSync("app/api/playbooks/generate/route.ts","utf8"),/review_status: "draft"/);
console.log("PASS: staff gate, tier gate, draft/review/publish order, immutable legacy visibility, actor/time, atomic conflict, portal exclusion and real errors");
