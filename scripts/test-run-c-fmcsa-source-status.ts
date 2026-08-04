import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FMCSAApiError,
  getBasics,
} from "../lib/fmcsa/client";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const originalFetch = globalThis.fetch;
const priorApiKey = process.env.FMCSA_API_KEY;
const originalInfo = console.info;

async function main() {
  process.env.FMCSA_API_KEY = "test-key-not-real";
  console.info = () => undefined;

  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "carrier not found" }), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" },
      });
    const missingCarrier = await getBasics("99999999", {
      throwOnError: true,
    });
    assert.deepEqual(missingCarrier.sourceStatus, {
      source: "qcmobile_basics",
      status: "no_public_data",
      reason: "carrier_not_found",
      httpStatus: 404,
    });
    assert.equal(missingCarrier.unsafeDriving, null);
    assert.equal(missingCarrier.hosCompliance, null);
    assert.equal(missingCarrier.vehicleMaintenance, null);
    assert.equal(missingCarrier.crashIndicator, null);

    for (const status of [401, 429, 500]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "upstream failure" }), {
          status,
          statusText: "Upstream failure",
          headers: { "content-type": "application/json" },
        });
      await assert.rejects(
        () => getBasics("99999999", { throwOnError: true }),
        (error: unknown) =>
          error instanceof FMCSAApiError && error.status === status
      );
    }

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          content: [],
          retrievalDate: "2026-08-04T12:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    const availableEmpty = await getBasics("99999999", {
      throwOnError: true,
    });
    assert.deepEqual(availableEmpty.sourceStatus, {
      source: "qcmobile_basics",
      status: "available",
      reason: null,
      httpStatus: null,
    });

    const refresh = read("lib/monitoring/run-client-refresh.ts");
    const activation = read("lib/activation/post-activation-server.ts");
    const cron = read("app/api/cron/monitoring-refresh/route.ts");
    const operatorImport = read("app/api/analysis/import/route.ts");
    assert.match(refresh, /sourceStatus:\s*ClientRefreshSourceStatus/);
    assert.match(refresh, /qcmobileBasics:\s*basics\.sourceStatus/);
    assert.match(refresh, /datahubInspections:[\s\S]*?recordCount:\s*inspections\.length/);
    assert.match(refresh, /datahubCrashes:[\s\S]*?recordCount:\s*crashes\.length/);
    assert.match(refresh, /Source status for DOT/);
    assert.match(activation, /sourceStatus:\s*refresh\.sourceStatus/);
    assert.match(cron, /source_status:\s*refresh\.sourceStatus/);
    assert.match(operatorImport, /source_status:\s*refresh\.sourceStatus/);
    assert.match(operatorImport, /sourceStatus:\s*refresh\.sourceStatus/);

    console.log(
      JSON.stringify(
        {
          passed: true,
          qcmobile404: "no_public_data/carrier_not_found",
          non404Failures: [401, 429, 500],
          activationMetadata: "public_analysis.sourceStatus",
          refreshActivityMetadata: "source_status",
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    if (priorApiKey === undefined) delete process.env.FMCSA_API_KEY;
    else process.env.FMCSA_API_KEY = priorApiKey;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
