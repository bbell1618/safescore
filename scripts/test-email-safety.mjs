import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
class OnboardingRouteFailure extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
let staffError = null;
let environmentReads = 0;
let setting;
const code = ts.transpileModule(readFileSync("app/api/operator/email-safety/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = { exports: {} };
const require = name => name === "@/lib/onboarding/server"
  ? { OnboardingRouteFailure, requireStaffOnboardingUser: async () => { if (staffError) throw staffError; } }
  : nativeRequire(name);
const runtime = { env: { get EMAIL_DRY_RUN() { environmentReads++; return setting; } } };
vm.runInThisContext(`(function(require,module,exports,process){${code}\n})`)(require, compiled, compiled.exports, runtime);

for (const value of [undefined, "", "false", "TRUE", " true", "true ", "true"]) {
  setting = value;
  const response = await compiled.exports.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { emailDryRunExactlyTrue: value === "true" });
}
for (const status of [401, 403]) {
  staffError = new OnboardingRouteFailure("Staff access required", status, "FORBIDDEN");
  environmentReads = 0;
  const response = await compiled.exports.GET();
  assert.equal(response.status, status);
  assert.equal(environmentReads, 0);
  assert.deepEqual(await response.json(), { error: "Staff access required", code: "FORBIDDEN" });
}
staffError = new Error("Staff lookup unavailable");
const failure = await compiled.exports.GET();
assert.equal(failure.status, 500);
assert.equal((await failure.json()).error, "Staff lookup unavailable");
console.log("PASS: exact runtime equality, boolean-only response, no-store, staff gate before env read, real failures");
