import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/+$/,
  "",
);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const route = `${baseUrl}/api/clients/${clientId}/authority-insurance`;

type JsonObject = Record<string, unknown>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function json(response: Response): Promise<JsonObject> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as JsonObject;
  } catch {
    throw new Error(
      `Expected JSON from ${response.url}; HTTP ${response.status}: ${raw.slice(
        0,
        300,
      )}`,
    );
  }
}

async function main() {
  const service = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const unauthorized = await fetch(route, { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const staff = await createDeployedStaffSession(baseUrl);
  let revoked = false;
  try {
    const response = await fetch(route, {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: staff.cookie,
      },
    });
    const body = await json(response);
    if (!response.ok) {
      throw new Error(
        `Deployed enrichment returned HTTP ${response.status}: ${String(
          body.error,
        )}`,
      );
    }
    assert.equal(body.status, "refreshed");
    assert.match(
      String(body.refreshId),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const refreshId = String(body.refreshId);
    const sourceResults = body.sources as JsonObject[];
    assert.equal(sourceResults.length, 3);
    assert.deepEqual(
      sourceResults.map((source) => [source.source, source.status]),
      [
        ["safer_company_snapshot", "succeeded"],
        ["fmcsa_motus", "succeeded"],
        ["fmcsa_sms_inspections", "succeeded"],
      ],
    );

    const rowsResult = await service
      .from("carrier_profile_enrichments")
      .select(
        "id, client_id, source, source_url, source_as_of, fetched_at, currentness, data, parser_version, created_at, updated_at",
      )
      .eq("client_id", clientId)
      .order("source", { ascending: true });
    if (rowsResult.error) throw rowsResult.error;
    assert.equal(rowsResult.data.length, 3);
    const safer = rowsResult.data.find(
      (row) => row.source === "safer_company_snapshot",
    );
    const motus = rowsResult.data.find((row) => row.source === "fmcsa_motus");
    const sms = rowsResult.data.find(
      (row) => row.source === "fmcsa_sms_inspections",
    );
    assert.ok(safer && motus && sms);
    const saferData = safer.data as JsonObject;
    const motusData = motus.data as JsonObject;
    assert.deepEqual(saferData.carrierOperations, ["Interstate"]);
    assert.deepEqual(saferData.operationClassifications, ["Auth. For Hire"]);
    assert.equal((saferData.cargoTypes as unknown[]).length, 10);
    assert.deepEqual(motusData.docketNumbers, ["MC-880750"]);
    assert.equal((motusData.authorities as JsonObject[])[0].status, "Active");
    assert.equal(
      (motusData.insuranceFilings as JsonObject[])[0].formType,
      "BMC-91X",
    );
    assert.equal(
      (motusData.insuranceFilings as JsonObject[])[0].filedAmount,
      1_000_000,
    );
    assert.equal(
      (motusData.insuranceFilings as JsonObject[])[0].insuranceCompanyName,
      null,
    );
    assert.deepEqual(motusData.authorityHistory, []);

    const attemptsResult = await service
      .from("activity_log")
      .select(
        "id, client_id, action_type, entity_type, entity_id, description, metadata, created_at",
      )
      .eq("client_id", clientId)
      .eq("action_type", "carrier_profile_enrichment_attempt")
      .eq("entity_id", refreshId)
      .order("created_at", { ascending: true });
    if (attemptsResult.error) throw attemptsResult.error;
    assert.equal(attemptsResult.data.length, 6);
    for (const source of [
      "safer_company_snapshot",
      "fmcsa_motus",
      "fmcsa_sms_inspections",
    ]) {
      const statuses: unknown[] = attemptsResult.data
        .filter(
          (row) => (row.metadata as JsonObject).source === source,
        )
        .map((row) => (row.metadata as JsonObject).status);
      assert.deepEqual(statuses, ["started", "succeeded"]);
    }

    const accountResponse = await fetch(
      `${baseUrl}/console/clients/${clientId}/account`,
      { headers: { cookie: staff.cookie } },
    );
    const accountHtml = await accountResponse.text();
    assert.equal(accountResponse.status, 200);
    for (const marker of [
      "Authority &amp; insurance",
      "MC-880750",
      "BMC-91X",
      "Interstate",
      "General Freight",
      "client-stated billing count is",
      "No separate authority-history events",
    ]) {
      assert.ok(
        accountHtml.includes(marker),
        `Account render is missing ${marker}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          passed: true,
          target: { baseUrl, clientId },
          unauthorizedStatus: unauthorized.status,
          refresh: {
            refreshId,
            sources: sourceResults.map((source) => ({
              source: source.source,
              status: source.status,
              reason: source.reason,
              rowId: (source.row as JsonObject | null)?.id ?? null,
            })),
          },
          rows: rowsResult.data,
          attemptRows: attemptsResult.data,
          render: {
            route: `/console/clients/${clientId}/account`,
            status: accountResponse.status,
            bytes: accountHtml.length,
            markers: [
              "Authority & insurance",
              "MC-880750",
              "BMC-91X",
              "Interstate",
              "General Freight",
              "driver-count mismatch",
              "empty authority history",
            ],
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await staff.revoke();
    revoked = true;
  }
  assert.equal(revoked, true);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
