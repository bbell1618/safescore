// Read-only production verification. No Stripe calls, auth mutations, or DB writes.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadResolver() {
  const compiledModule = { exports: {} };
  const source = fs.readFileSync(path.join(root, "lib/billing/billable-drivers.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    module: compiledModule, exports: compiledModule.exports,
    require: (name) => {
      if (name === "server-only") return {};
      throw new Error(`Unexpected runtime import: ${name}`);
    },
  });
  return compiledModule.exports.getBillableDriverCount;
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    process.loadEnvFile(path.join(root, ".env.local"));
    const clean = (value) => value?.trim().replace(/(?:\\n)+$/, "").trim();
    const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!url || !key) throw new Error("Required read credentials are unavailable");
    if (new URL(url).hostname !== "kzndtvkblfbrsnrnjodf.supabase.co") throw new Error("Unexpected Supabase project");
    const readOnlyFetch = (url, init = {}) => {
      if (!["GET", "HEAD"].includes(init.method ?? "GET")) throw new Error("Verification only permits GET/HEAD");
      return fetch(url, init);
    };
    const service = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: readOnlyFetch },
    });
    const result = await loadResolver()(service, "879b62c2-f8ea-430d-b8d3-9264150d84bf");
    assert.equal(result.billable, 45);
    assert.equal(result.winningSource, "fmcsa_mcs150");
    assert.equal(result.sources.find((row) => row.source === "client_stated").value, 5);
    console.log(JSON.stringify(result, null, 2));
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
