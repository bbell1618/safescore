// One historical request only. No case mutation or notification calls.
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const mode = process.argv[2];
if (!["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: node scripts/backfill-agency-requests.mjs --dry-run|--apply");
process.loadEnvFile(resolve(".env.local"));
const clean = value => (value ?? "").trim().replace(/\\[rn]/g, "").trim();
const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (new URL(url).hostname !== "kzndtvkblfbrsnrnjodf.supabase.co") throw new Error("Unexpected Supabase project");
const caseId = "147054ba-7ec6-44e5-aa4c-6788c099fbc3";
let expectedRow;
const service = createClient(url, clean(process.env.SUPABASE_SERVICE_ROLE_KEY), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init = {}) => {
    const endpoint = new URL(input);
    const method = init.method ?? "GET";
    if (!["GET", "HEAD"].includes(method)) {
      if (mode !== "--apply" || method !== "POST" || endpoint.pathname !== "/rest/v1/case_agency_requests") throw new Error("Blocked write outside historical agency request");
      assert.deepEqual(JSON.parse(init.body), expectedRow);
    }
    return fetch(input, init);
  } },
});
const loadCase = async () => {
  const result = await service.from("dataq_cases").select("*").eq("id", caseId).single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const before = await loadCase();
assert.equal(before.case_number, "6103911");
assert.equal(before.outcome, null);
expectedRow = {
  client_id: before.client_id, case_kind: "dataq", case_id: caseId,
  requested_on: "2026-05-29", response_due: "2026-06-08",
  requesting_agency: "California Highway Patrol", contact_name: "Officer Marcus Denton",
  contact_phone: "916-843-3400",
  request_text: "Submit the correction through eRODS with comment code 18747, call 916-843-3400, then set the DataQs request status to pending agency review.",
  status: "lapsed",
  response_notes: "No response sent. DataQs auto-closed the request 2026-06-15 (No Requestor Response). Not decided on the merits.",
};
const existing = await service.from("case_agency_requests").select("*").eq("case_id", caseId).eq("requested_on", expectedRow.requested_on);
if (existing.error) throw new Error(existing.error.message);
console.log(JSON.stringify({ mode, plannedRow: expectedRow, existingRows: existing.data.length }, null, 2));
if (existing.data.length) {
  console.log(JSON.stringify({ skipped: true, reason: "Case and requested_on already exist", rows: existing.data }, null, 2));
} else if (mode === "--apply") {
  const inserted = await service.from("case_agency_requests").insert(expectedRow).select("*").single();
  if (inserted.error) throw new Error(inserted.error.message);
  const readback = await service.from("case_agency_requests").select("*").eq("id", inserted.data.id).single();
  if (readback.error) throw new Error(readback.error.message);
  for (const [key, value] of Object.entries(expectedRow)) assert.deepEqual(readback.data[key], value);
  console.log(JSON.stringify({ inserted: 1, row: readback.data }, null, 2));
}
assert.deepEqual(await loadCase(), before, "Historical DataQ case must remain entirely unchanged");
console.log(JSON.stringify({ caseUnchanged: true, outcome: before.outcome }));
