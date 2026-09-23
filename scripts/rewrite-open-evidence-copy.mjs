// Copy-only repair: --dry-run <plan.json>, inspect the plan, then --apply <plan.json>.
// Never invokes request creation, reconciliation, notification or reminder code.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadTs, root } from "./score-copy-runtime.mjs";

const { buildLaneBEvidenceRequestCopy, LANE_B_EVIDENCE_CLASSES } = loadTs("lib/evidence-loop/taxonomy.ts");
const fields = ["status_copy", "why_copy", "requested_items"];
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const oldCopy = (row) => Object.fromEntries(fields.map((key) => [key, row[key]]));
const protectedData = (row) => ({
  columns: Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key))),
  items: Array.isArray(row.requested_items) ? row.requested_items.map((item) =>
    item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([key]) => !["label", "contextNote"].includes(key))) : item) : row.requested_items,
});

export function rebuildEvidenceCopy(row, context) {
  if (row.status !== "open" || row.request_type !== "evidence" || row.response !== null) return { reason: "Not an unanswered open evidence request" };
  if (!LANE_B_EVIDENCE_CLASSES.includes(row.evidence_class)) return { reason: `Unknown evidence class: ${row.evidence_class}` };
  if (!Number.isFinite(row.potential_points) || row.potential_points < 0) return { reason: "Missing or invalid potential_points" };
  if (!Array.isArray(row.requested_items) || row.requested_items.length === 0) return { reason: "Missing stored items" };
  const copy = buildLaneBEvidenceRequestCopy(row.evidence_class, row.potential_points, context);
  const byKey = new Map(copy.requestedItems.map((item) => [item.itemKey, item]));
  for (const item of row.requested_items) {
    if (!item || typeof item !== "object" || !byKey.has(item.itemKey)) return { reason: `Unknown stored itemKey: ${item?.itemKey ?? "missing"}` };
  }
  return { patch: {
    status_copy: copy.statusCopy,
    why_copy: copy.whyCopy,
    requested_items: row.requested_items.map((item) => ({ ...item,
      label: byKey.get(item.itemKey).label,
      contextNote: byKey.get(item.itemKey).contextNote,
    })),
  } };
}

async function main() {
  const [mode, planPath] = process.argv.slice(2);
  if (!["--dry-run", "--apply"].includes(mode) || !planPath) throw new Error("Usage: node scripts/rewrite-open-evidence-copy.mjs --dry-run|--apply <plan.json>");
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
        if (mode !== "--apply" || method !== "PATCH" || endpoint.pathname !== "/rest/v1/client_requests" || endpoint.searchParams.get("status") !== "eq.open" || endpoint.searchParams.get("request_type") !== "eq.evidence" || endpoint.searchParams.get("response") !== "is.null" || !endpoint.searchParams.get("id")?.startsWith("eq.")) throw new Error("Blocked write outside unanswered open evidence copy repair");
        assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), [...fields].sort());
      }
      return fetch(input, init);
    } },
  });
  const allRequests = async () => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const result = await service.from("client_requests").select("*").order("id").range(offset, offset + 499);
      if (result.error) throw new Error(result.error.message);
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
  };
  const rows = await allRequests();
  const targets = rows.filter((row) => row.status === "open" && row.request_type === "evidence" && row.response === null);
  const changes = [], skipped = [], unchanged = [];
  for (const row of targets) {
    if (!row.violation_id) { skipped.push({ id: row.id, reason: "No linked violation_id" }); continue; }
    const result = await service.from("violations").select("violation_code,violation_description,inspections(inspection_date)").eq("id", row.violation_id).maybeSingle();
    if (result.error) throw new Error(`Request ${row.id}: ${result.error.message}`);
    if (!result.data) { skipped.push({ id: row.id, reason: "Linked violation not found" }); continue; }
    const violation = result.data;
    const inspection = Array.isArray(violation.inspections) ? violation.inspections[0] : violation.inspections;
    const context = { violationCode: violation.violation_code, violationDescription: violation.violation_description, inspectionDate: inspection?.inspection_date ?? null };
    const rebuilt = rebuildEvidenceCopy(row, context);
    if (rebuilt.reason) { skipped.push({ id: row.id, reason: rebuilt.reason }); continue; }
    if (hash(oldCopy(row)) === hash(rebuilt.patch)) { unchanged.push(row.id); continue; }
    changes.push({ id: row.id, clientId: row.client_id, evidenceClass: row.evidence_class, old: oldCopy(row), new: rebuilt.patch, context, beforeHash: hash(row), protectedHash: hash(protectedData(row)) });
  }
  const plan = { createdAt: new Date().toISOString(), changes, skipped, unchanged, baseline: rows.map((row) => ({ id: row.id, hash: hash(row) })) };
  if (mode === "--dry-run") {
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: "wx" });
    for (const change of changes) console.log(JSON.stringify({ id: change.id, old: change.old, new: change.new }));
    console.log(JSON.stringify({ mode, wouldUpdate: changes.length, skipped, unchanged: unchanged.length, protectedRows: rows.length }));
    return;
  }
  const approved = JSON.parse(fs.readFileSync(planPath, "utf8"));
  for (const field of ["changes", "skipped", "unchanged", "baseline"]) assert.deepEqual(plan[field], approved[field], `Live ${field} changed since dry run; create a new dry run`);
  const receiptPath = `${planPath}.applied.json`;
  const receipt = { updated: [], skipped, unchanged: unchanged.length, unchangedNonTargets: 0, verified: false };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx" });
  for (const change of changes) {
    let query = service.from("client_requests").update(change.new).eq("id", change.id).eq("status", "open").eq("request_type", "evidence").is("response", null);
    for (const field of fields) query = change.old[field] === null ? query.is(field, null) : query.eq(field, typeof change.old[field] === "object" ? JSON.stringify(change.old[field]) : change.old[field]);
    const result = await query.select("*").single();
    if (result.error) throw new Error(`Copy update failed for ${change.id}: ${result.error.message}`);
    assert.equal(hash(oldCopy(result.data)), hash(change.new), `Copy mismatch for ${change.id}`);
    assert.equal(hash(protectedData(result.data)), change.protectedHash, `Protected data changed on ${change.id}`);
    receipt.updated.push(change.id);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  }
  const after = await allRequests();
  assert.equal(after.length, rows.length, "Request row count changed during backfill");
  for (const row of after) {
    const change = changes.find((item) => item.id === row.id);
    if (change) {
      assert.equal(hash(oldCopy(row)), hash(change.new));
      assert.equal(hash(protectedData(row)), change.protectedHash);
    } else {
      assert.equal(hash(row), approved.baseline.find((item) => item.id === row.id)?.hash, `Untargeted request changed: ${row.id}`);
      receipt.unchangedNonTargets++;
    }
  }
  receipt.verified = true;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
