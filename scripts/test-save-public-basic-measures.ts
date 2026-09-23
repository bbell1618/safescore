import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePublicBasicMeasures } from "../lib/fmcsa/public-basic-measures";
import { savePublicBasicMeasures } from "../lib/fmcsa/save-public-basic-measures";

const clientId = "fixture-client";
const release = parsePublicBasicMeasures(readFileSync("scripts/fixtures/public-basic-measures.html", "utf8"), "2533650", new Date("2026-09-23"));
let stored: Array<Record<string, unknown>> = [];
let clientDot = "2533650", failure = "", inserts = 0;
function reset() { stored = []; clientDot = "2533650"; failure = ""; inserts = 0; }
const service = { from(table: string) {
  let newest = false, payload: Record<string, unknown> | null = null;
  const filters: Record<string, unknown> = {};
  const query = {
    select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
    order() { newest = true; return query; }, limit() { return query; },
    insert(row: Record<string, unknown>) { payload = row; return query; },
    async single() {
      if (table === "clients") return { data: { id: clientId, dot_number: clientDot }, error: null };
      assert.ok(payload); inserts++;
      if (failure === "database") return { data: null, error: { code: "XX000", message: "real database failure" } };
      const row = { ...payload, id: "saved", captured_at: "original timestamp" };
      stored.push(row);
      if (failure === "race") return { data: null, error: { code: "23505", message: "unique conflict" } };
      return { data: row, error: null };
    },
    async maybeSingle() {
      if (failure === "read") return { data: null, error: { message: "real read failure" } };
      const rows = stored.filter(row => Object.entries(filters).every(([k,v])=>row[k]===v));
      if (newest) rows.sort((a,b)=>String(b.sms_run_date).localeCompare(String(a.sms_run_date)));
      return { data: rows[0] ?? null, error: null };
    },
  };
  return query;
} } as unknown as SupabaseClient;
const run = (source = release) => savePublicBasicMeasures(service, clientId, "2533650", "test", async()=>source);
async function main() {
  reset(); assert.equal((await run()).status,"inserted"); assert.equal(inserts,1);
  assert.equal((stored[0].measures as typeof release.measures).crash_indicator.measure,null);
  assert.equal((stored[0].measures as typeof release.measures).controlled_substance.measure,0);
  const unchanged = JSON.stringify(stored);
  assert.equal((await run({...release, measures:{...release.measures,unsafe_driving:{...release.measures.unsafe_driving,measure:99}}})).status,"already_present");
  assert.equal(inserts,1); assert.equal(JSON.stringify(stored),unchanged,"Duplicate must preserve all stored fields");
  reset(); stored.push({id:"newer",client_id:clientId,sms_run_date:"2026-09-01",source:"authenticated_all_basics"});
  assert.equal((await run()).status,"older_than_saved"); assert.equal(inserts,0);
  reset(); failure="race"; assert.equal((await run()).status,"already_present"); assert.equal(stored.length,1);
  reset(); failure="database"; await assert.rejects(run,/real database failure/); assert.equal(stored.length,0);
  reset(); failure="read"; await assert.rejects(run,/real read failure/); assert.equal(inserts,0);
  reset(); clientDot="3720456"; await assert.rejects(run,/stored client USDOT/); assert.equal(inserts,0);
  reset(); await assert.rejects(()=>run({...release,dotNumber:"3720456"}),/different carrier/); assert.equal(inserts,0);
  reset(); await assert.rejects(()=>run({...release,currentness:"stale"}),/is stale/); assert.equal(inserts,0);
  const cron = readFileSync("app/api/cron/monitoring-refresh/route.ts","utf8");
  assert.match(cron,/client.id === PUBLIC_BASIC_ROLLOUT_CLIENT/);
  assert.match(readFileSync("lib/monitoring/run-client-refresh.ts","utf8"),/onConflict: "client_id,sms_run_date,source", ignoreDuplicates: true/);
  console.log("PASS: public BASIC insert-only preservation, null vs zero, older source, concurrent duplicate, real DB errors, carrier/date rejection, scoped scheduled wiring.");
}
void main();
