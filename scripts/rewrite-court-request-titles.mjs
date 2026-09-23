// One-off, title-only repair. First run --dry-run <plan.json>, then --apply <plan.json>.
// No request creation, reconciliation, audit logging, or notification paths are called.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadTs, root } from "./score-copy-runtime.mjs";

const prefixes = ["Certified court disposition — ", "Court paperwork showing how the ticket ended — "];
const hash = (row) => createHash("sha256").update(JSON.stringify(row)).digest("hex");
const withoutTitle = (row) => { const copy = { ...row }; delete copy.title; return copy; };
const { buildLaneBEvidenceRequestCopy, formatLaneBEvidenceViolationContext } = loadTs("lib/evidence-loop/taxonomy.ts");

async function main() {
  const [mode, planPath] = process.argv.slice(2);
  if (!["--dry-run", "--apply"].includes(mode) || !planPath) throw new Error("Usage: node scripts/rewrite-court-request-titles.mjs --dry-run|--apply <plan.json>");
  process.loadEnvFile(path.join(root, ".env.local"));
  const clean = (value) => value?.trim().replace(/(?:\\n)+$/, "").trim();
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key || new URL(url).hostname !== "kzndtvkblfbrsnrnjodf.supabase.co") throw new Error("Missing credentials or unexpected Supabase project");
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init = {}) => {
      const endpoint = new URL(input);
      const method = init.method ?? "GET";
      if (!["GET", "HEAD"].includes(method)) {
        if (mode !== "--apply" || method !== "PATCH" || endpoint.pathname !== "/rest/v1/client_requests" || endpoint.searchParams.get("status") !== "eq.open" || !endpoint.searchParams.get("id")?.startsWith("eq.") || !prefixes.some((prefix) => endpoint.searchParams.get("title")?.startsWith(`eq.${prefix}`))) throw new Error("Blocked write outside open request title repair");
        assert.deepEqual(Object.keys(JSON.parse(init.body)), ["title"]);
      }
      return fetch(input, init);
    } },
  });
  const allRequests = async () => {
    const count = await service.from("client_requests").select("id", { count: "exact", head: true });
    if (count.error) throw new Error(count.error.message);
    const rows = [];
    while (rows.length < count.count) {
      const result = await service.from("client_requests").select("*").order("id").range(rows.length, rows.length + 999);
      if (result.error) throw new Error(result.error.message);
      if (!result.data.length) throw new Error("Request pagination ended before expected count");
      rows.push(...result.data);
    }
    return rows;
  };
  const rows = await allRequests();
  const targets = rows.filter((row) => row.status === "open" && prefixes.some((prefix) => row.title.startsWith(prefix)));
  const changes = [];
  for (const row of targets) {
    if (!row.violation_id) throw new Error(`Request ${row.id} has no linked violation`);
    const result = await service.from("violations").select("violation_code,violation_description,inspections(inspection_date)").eq("id", row.violation_id).single();
    if (result.error) throw new Error(`Request ${row.id}: ${result.error.message}`);
    const violation = result.data;
    const inspection = Array.isArray(violation.inspections) ? violation.inspections[0] : violation.inspections;
    const context = { violationCode: violation.violation_code, violationDescription: violation.violation_description, inspectionDate: inspection?.inspection_date };
    if (!formatLaneBEvidenceViolationContext(context)) throw new Error(`Request ${row.id} has incomplete or unrenderable violation context`);
    const newTitle = buildLaneBEvidenceRequestCopy("citation-dismissed", row.potential_points, context).title;
    changes.push({ id: row.id, clientId: row.client_id, oldTitle: row.title, newTitle, beforeHash: hash(row), otherColumnsHash: hash(withoutTitle(row)), context });
  }
  const plan = { createdAt: new Date().toISOString(), changes, baseline: rows.map((row) => ({ id: row.id, hash: hash(row) })) };
  if (mode === "--dry-run") {
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: "wx" });
    for (const row of changes) console.log(JSON.stringify({ id: row.id, oldTitle: row.oldTitle, newTitle: row.newTitle }));
    console.log(`DRY RUN: ${changes.filter((row) => row.oldTitle !== row.newTitle).length} titles would change; ${rows.length} total request rows protected by baseline hashes.`);
    return;
  }
  const approvedPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.deepEqual(changes, approvedPlan.changes, "Live targets or source facts changed since dry run; create a new dry run");
  assert.deepEqual(plan.baseline, approvedPlan.baseline, "Request data changed since dry run; create a new dry run");
  const receipt = { updated: [], unchangedNonTargets: 0, verified: false };
  const receiptPath = `${planPath}.applied.json`;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx" });
  for (const row of changes.filter((change) => change.oldTitle !== change.newTitle)) {
    const result = await service.from("client_requests").update({ title: row.newTitle }).eq("id", row.id).eq("status", "open").eq("title", row.oldTitle).select("*").single();
    if (result.error) throw new Error(`Title update failed for ${row.id}: ${result.error.message}`);
    assert.equal(result.data.title, row.newTitle);
    assert.equal(hash(withoutTitle(result.data)), row.otherColumnsHash, `Non-title columns changed on ${row.id}`);
    receipt.updated.push(row.id);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  }
  const afterRows = await allRequests();
  assert.equal(afterRows.length, rows.length, "Request row count changed during repair");
  for (const row of afterRows) {
    const target = changes.find((change) => change.id === row.id);
    if (target) {
      assert.equal(row.title, target.newTitle);
      assert.equal(hash(withoutTitle(row)), target.otherColumnsHash);
    } else {
      assert.equal(hash(row), approvedPlan.baseline.find((before) => before.id === row.id)?.hash, `Untargeted request ${row.id} changed`);
      receipt.unchangedNonTargets++;
    }
  }
  receipt.verified = true;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`UPDATED: ${receipt.updated.length}; non-title columns unchanged; ${receipt.unchangedNonTargets} other requests unchanged.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
