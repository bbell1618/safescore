import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadResolver } from "./verify-billable-drivers.mjs";
const resolveCount = loadResolver();
const clientId = "fixture-client";

async function resolveFixture(values = {}, failTable) {
  const calls = [];
  const supabase = createClient("https://billing-fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input);
      const table = url.pathname.split("/").pop();
      calls.push({ table, method: init.method, params: url.searchParams });
      assert.ok(["GET", "HEAD"].includes(init.method));
      assert.equal(url.searchParams.get(table === "clients" ? "id" : "client_id"), `eq.${clientId}`);
      if (table === failTable) return new Response(JSON.stringify({ message: "source permission denied", code: "42501" }), { status: 403 });
      if (table === "drivers") {
        assert.equal(url.searchParams.get("status"), "eq.active");
        assert.equal(url.searchParams.get("approved_at"), "not.is.null");
        assert.equal(init.method, "HEAD");
        return new Response(null, { headers: { "content-range": `*/${values.roster ?? 0}` } });
      }
      let rows;
      if (table === "clients") rows = [{ driver_count: values.client ?? null }];
      if (table === "carrier_profiles") {
        assert.equal(url.searchParams.get("order"), "created_at.desc.nullslast");
        rows = values.fmcsa === undefined ? [] : [{ drivers: values.fmcsa, mcs150_date: "2026-05-08" }];
      }
      if (table === "client_attested_profiles") {
        const dated = url.searchParams.get("attested_at") === "not.is.null";
        assert.equal(url.searchParams.get("order"), `${dated ? "attested_at" : "updated_at"}.desc.nullslast`);
        rows = dated ? values.attested ?? [] : values.fallback ?? [];
      }
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    } },
  });
  const result = await resolveCount(supabase, clientId);
  assert.equal(calls.length, 5);
  return JSON.parse(JSON.stringify(result));
}

(async () => {
  const dated = (drivers, date = "2026-08-01T00:00:00Z") => [{ drivers, attested_at: date, updated_at: date }];
  const sources = ["fmcsa_mcs150", "attested", "active_roster", "client_stated"];
  for (let i = 0; i < sources.length; i++) {
    const result = await resolveFixture({ client: 45, fmcsa: i < 1 ? 45 : null, attested: i < 2 ? dated(45) : [], roster: i < 3 ? 45 : 0 });
    assert.equal(result.billable, 45);
    assert.equal(result.winningSource, sources[i]);
  }
  for (const invalid of [null, 0, -1, 1.5, "45"]) {
    const result = await resolveFixture({ client: invalid, fmcsa: invalid, attested: dated(invalid) });
    assert.equal(result.billable, null);
    assert.equal(result.winningSource, null);
    assert.ok(result.sources.every((s) => s.value === null));
  }
  const highRoster = await resolveFixture({ client: 5, fmcsa: 45, attested: dated(45), roster: 60 });
  assert.equal(highRoster.billable, 60);
  assert.equal(highRoster.winningSource, "active_roster");
  const fallback = await resolveFixture({ attested: dated(70), fallback: [{ drivers: 45, attested_at: null, updated_at: "2026-09-01T00:00:00Z" }] });
  assert.equal(fallback.billable, 45);
  assert.equal(fallback.sources.find((s) => s.source === "attested").asOf, null);
  const datedWins = await resolveFixture({ attested: dated(45), fallback: [{ drivers: 70, attested_at: null, updated_at: "2026-07-01T00:00:00Z" }] });
  assert.equal(datedWins.billable, 45);
  assert.equal(datedWins.sources.find((s) => s.source === "attested").asOf, "2026-08-01T00:00:00Z");
  for (const table of ["clients", "carrier_profiles", "client_attested_profiles", "drivers"]) {
    await assert.rejects(resolveFixture({ client: 5, fmcsa: 45 }, table), /source permission denied/);
  }
  console.log("PASS: tie priority, invalid/missing counts, larger roster, latest profile fallback, tenant/approved-active filters, and source failures (16 cases)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
