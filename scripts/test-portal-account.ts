import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fleetSourceLines,
  resolveAccountAddress,
} from "../lib/portal/account";

const clientAddress = resolveAccountAddress(
  {
    address: "100 Carrier Way",
    city: "Fremont",
    state: "CA",
    zip: "94538",
  },
  {
    physical_address: "FMCSA address",
    address: null,
    safer_as_of: "2026-07-28",
    fetched_at: "2026-07-30T13:00:52.881Z",
  }
);
assert.deepEqual(clientAddress, {
  value: "100 Carrier Way, Fremont, CA 94538",
  source: null,
});

const saferFallback = resolveAccountAddress(
  { address: null, city: null, state: null, zip: null },
  {
    physical_address: "380 CLARENCE BROMELL CT TRACY, CA 95377",
    address: "older summary",
    safer_as_of: "2026-07-28",
    fetched_at: "2026-07-30T13:00:52.881Z",
  }
);
assert.deepEqual(saferFallback, {
  value: "380 CLARENCE BROMELL CT TRACY, CA 95377",
  source: {
    label: "FMCSA SAFER Company Snapshot",
    asOf: "2026-07-28",
  },
});

assert.deepEqual(
  resolveAccountAddress(
    { address: null, city: "City alone", state: null, zip: null },
    null
  ),
  { value: null, source: null }
);

assert.deepEqual(
  fleetSourceLines({
    powerUnits: 40,
    fmcsaDrivers: 45,
    servicePlanDrivers: 5,
  }),
  {
    fmcsa:
      "FMCSA on file: 40 power units · 45 drivers (MCS-150)",
    servicePlan: "Your service plan: 5 drivers",
  }
);
assert.deepEqual(
  fleetSourceLines({
    powerUnits: 1,
    fmcsaDrivers: 1,
    servicePlanDrivers: 1,
  }),
  {
    fmcsa: "FMCSA on file: 1 power unit · 1 driver (MCS-150)",
    servicePlan: "Your service plan: 1 driver",
  }
);

const accountPage = readFileSync(
  resolve(process.cwd(), "app/(portal)/portal/account/page.tsx"),
  "utf8"
);
const accountServer = readFileSync(
  resolve(process.cwd(), "lib/portal/account-server.ts"),
  "utf8"
);
assert.equal(
  accountPage.match(/getPortalClientPageContext\(\)/g)?.length,
  1
);
assert.ok(accountPage.includes("<Suspense fallback={<AccountCardsSkeleton />}>"));
assert.ok(accountPage.indexOf("<header>") < accountPage.indexOf("<Suspense"));
assert.ok(accountServer.includes("await Promise.all(["));
assert.ok(accountServer.includes('.eq("id", input.clientId)'));
assert.ok(accountServer.match(/\.eq\("client_id", input\.clientId\)/g)?.length === 3);
assert.ok(!accountServer.includes("primary_contact"));
assert.ok(!accountPage.includes("Primary contact"));
assert.ok(!accountPage.match(/#[0-9a-f]{3,8}/i));
assert.ok(!accountPage.includes("gray-"));
assert.ok(!accountPage.includes("total_safety"));

console.log(
  JSON.stringify(
    {
      passed: true,
      clientAddress,
      saferFallback,
      nationwideFleet: fleetSourceLines({
        powerUnits: 40,
        fmcsaDrivers: 45,
        servicePlanDrivers: 5,
      }),
      access: "single cached portal context + strict client-scoped service reads",
    },
    null,
    2
  )
);
