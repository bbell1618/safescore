// One-time Nationwide v2 regeneration using the existing generator functions.
// The HTTP route also writes activity_log; this caller omits that optional callback.
// Only one POST to client_playbooks is allowed. No notification code is imported.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { loadTs, root } from "./score-copy-runtime.mjs";

const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const hash = (row) => createHash("sha256").update(JSON.stringify(row)).digest("hex");

async function main() {
  const [mode, receiptPath] = process.argv.slice(2);
  if (!["--inspect", "--apply"].includes(mode) || !receiptPath) throw new Error("Usage: node scripts/regenerate-nationwide-score-copy.mjs --inspect|--apply <receipt.json>");
  process.loadEnvFile(path.join(root, ".env.local"));
  const clean = (value) => value?.trim().replace(/(?:\\n)+$/, "").trim();
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  process.env.OPENROUTER_API_KEY = clean(process.env.OPENROUTER_API_KEY) ?? "";
  if (!url || !key || new URL(url).hostname !== "kzndtvkblfbrsnrnjodf.supabase.co") throw new Error("Missing credentials or unexpected Supabase project");
  let writes = 0;
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init = {}) => {
      if (!["GET", "HEAD"].includes(init.method ?? "GET")) {
        if (mode !== "--apply" || init.method !== "POST" || new URL(input).pathname !== "/rest/v1/client_playbooks" || writes !== 0) throw new Error("Blocked write outside one Nationwide playbook insert");
        const payload = JSON.parse(init.body);
        assert.equal(payload.client_id, clientId);
        assert.equal(payload.version, 2);
        writes++;
      }
      return fetch(input, init);
    } },
  });
  const read = async (query) => { const result = await query; if (result.error) throw new Error(result.error.message); return result.data; };
  const before = await read(service.from("client_playbooks").select("*").eq("client_id", clientId).order("version"));
  assert.deepEqual(before.map((row) => row.version), [1], "Expected only v1; do not repeat a completed regeneration");
  const beforeHash = hash(before[0]);
  const client = await read(service.from("clients").select("id,name,dot_number,tier").eq("id", clientId).single());
  const actor = await read(service.from("users").select("id,role").eq("id", before[0].generated_by).single());
  assert.ok(["geia_admin", "geia_staff"].includes(actor.role), "Original generator is no longer a staff user");
  const { normalizeClientTier, tierHasFeature } = loadTs("lib/tiers.ts");
  assert.ok(tierHasFeature(normalizeClientTier(client.tier), "playbook_coach"));
  const { getCanonicalInspectionScope } = loadTs("lib/fmcsa/canonical-inspection-scope.ts");
  const scope = await getCanonicalInspectionScope(clientId, service);
  const count = await service.from("violations").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (count.error) throw new Error(count.error.message);
  const stored = [];
  while (stored.length < count.count) {
    const page = await read(service.from("violations").select("id,inspection_id,violation_code,violation_description,basic_category,severity_weight,oos_violation,citation_number,citation_result,convicted,challenge_reason,challenge_tier,inspections(inspection_date)").eq("client_id", clientId).order("id").range(stored.length, stored.length + 999));
    if (!page.length) throw new Error("Violation pagination ended before expected count");
    stored.push(...page);
  }
  // Extract these unchanged functions from the existing route instead of duplicating
  // its provider/model, response handling, date conversion, or inspection mapping.
  const routePath = path.join(root, "app/api/playbooks/generate/route.ts");
  const source = fs.readFileSync(routePath, "utf8");
  const ast = ts.createSourceFile(routePath, source, ts.ScriptTarget.Latest, true);
  const names = ["inspectionDate", "pacificDateString", "openRouterError", "requestPlaybookNarrative"];
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  const extracted = declarations.map((node) => node.getText(ast)).join("\n");
  const compiled = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const routeFunctions = vm.runInThisContext(`(function(){${compiled}\nreturn {inspectionDate,pacificDateString,requestPlaybookNarrative};})()`, { filename: routePath });
  const canonicalIds = new Set(scope.inspectionIds);
  const sourceViolations = stored.filter((row) => canonicalIds.has(row.inspection_id)).map((row) => {
    const fact = { ...row, inspection_date: routeFunctions.inspectionDate(row) };
    delete fact.inspections;
    delete fact.inspection_id;
    return fact;
  });
  const generatedAt = new Date();
  const sourceAsOf = routeFunctions.pacificDateString(generatedAt);
  const { buildLaneCFamilyGroups } = loadTs("lib/playbooks/families.ts");
  const groups = buildLaneCFamilyGroups(sourceViolations, { asOf: new Date(`${sourceAsOf}T00:00:00Z`), trailingWindowDays: 90 });
  const generator = loadTs("lib/playbooks/playbook-generation.ts");
  const data = generator.buildPlaybookGenerationData({
    carrier: { id: client.id, name: client.name, dotNumber: client.dot_number },
    familyGroups: groups,
    sourceSnapshot: {
      generatedAt: generatedAt.toISOString(), asOfDate: sourceAsOf,
      canonicalInspectionSource: scope.source, canonicalInspectionCount: scope.inspectionIds.length,
      sourceViolationCount: sourceViolations.length, laneCViolationCount: groups.reduce((sum, group) => sum + group.count, 0),
      laneCWeightedPoints: groups.reduce((sum, group) => sum + group.points, 0), trailingWindowDays: 90,
      unmappedCodes: [...new Set(groups.filter((group) => group.familyKey === "general_safety").flatMap((group) => group.violations.map((violation) => violation.code)))].sort(),
    },
  });
  const receipt = { clientId, previousVersion: 1, previousRowId: before[0].id, previousHash: beforeHash, sourceSnapshot: data.sourceSnapshot, familyCount: groups.length, providerKeyPresent: Boolean(process.env.OPENROUTER_API_KEY), ownerA1: data.ownerCurriculum.find((row) => row.key === "A1").content, status: "inspected" };
  console.log(JSON.stringify(receipt, null, 2));
  if (mode === "--inspect") return;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx" });
  const narrative = await generator.generateValidatedPlaybookNarrative(generator.buildPlaybookPrompts(data), data, ({ system, user }) => routeFunctions.requestPlaybookNarrative({ system, user }));
  const beforeInsert = await read(service.from("client_playbooks").select("*").eq("client_id", clientId).order("version"));
  assert.deepEqual(beforeInsert.map((row) => row.version), [1]);
  assert.equal(hash(beforeInsert[0]), beforeHash, "Version 1 changed during generation");
  const inserted = await read(service.from("client_playbooks").insert({
    client_id: clientId, version: 2, template_version: data.templateVersion, trailing_window_days: 90,
    source_as_of: sourceAsOf, owner_curriculum: data.ownerCurriculum,
    family_programs: generator.mergeFamilyPrograms(data, narrative.narrative),
    installment_calendar: generator.cloneInstallmentCalendar(data.installmentCalendar),
    ai_content: narrative.narrative, source_snapshot: data.sourceSnapshot,
    generated_by: actor.id, generated_at: generatedAt.toISOString(),
  }).select("id,version").single());
  receipt.inserted = inserted;
  receipt.status = "inserted";
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  const after = await read(service.from("client_playbooks").select("*").eq("client_id", clientId).order("version"));
  assert.deepEqual(after.map((row) => row.version), [1, 2]);
  assert.equal(hash(after[0]), beforeHash);
  assert.deepEqual(after[1].owner_curriculum, data.ownerCurriculum);
  receipt.status = "verified";
  receipt.version1Unchanged = true;
  receipt.databaseWrites = writes;
  receipt.narrativeAttempts = narrative.attempts;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
