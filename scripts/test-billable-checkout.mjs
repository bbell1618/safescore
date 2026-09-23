// Executes the route with in-memory doubles only. Never contacts Stripe or Supabase.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(file, mocks) {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    module: compiledModule, exports: compiledModule.exports,
    process: { env: { STRIPE_PRICE_TOTAL_SAFETY: "price_base", STRIPE_PRICE_DRIVER_ADDON: "price_driver", NEXT_PUBLIC_APP_URL: "https://fixture.invalid" } },
    require: (name) => {
      if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return compiledModule.exports;
}

const completeness = load("lib/onboarding/completeness.ts", {
  "@/lib/onboarding/validation": { humanEnteredNameOrEmpty: (value) => typeof value === "string" ? value.trim() : "" },
});

async function run({ stated = 5, billable = 45, failure, signedIn = true } = {}) {
  const payloads = [];
  let resolutions = 0;
  const client = {
    name: "Fixture", status: "onboarding", tier: "total_safety", driver_count: stated,
    primary_contact: "Fixture Owner", phone: "fixture", vehicle_types: ["truck"],
    operating_states: ["CA"], operating_radius: "local", citation_dismissed_last_24_months: false,
    service_agreement_accepted: true,
  };
  const service = {};
  const userDb = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user", email: "owner@example.invalid" } : null } }) },
    from: (table) => ({ select: () => ({ eq: () => ({ single: async () => ({ data: table === "users" ? { client_id: "client" } : client, error: null }) }) }) }),
  };
  const route = load("app/api/billing/create-checkout-session/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => userDb, createServiceClient: async () => service },
    "@/lib/stripe/client": { stripe: { checkout: { sessions: { create: async (payload) => { payloads.push(payload); return { url: "https://fixture.invalid/redirect" }; } } } } },
    "@/lib/auth/access": { isClientPostOnboardingLifecycle: () => false },
    "@/lib/tiers": { isSubscriptionTier: (value) => value === "total_safety" },
    "@/lib/onboarding/completeness": completeness,
    "@/lib/billing/assessment": {}, // Recurring checkout must not enter Assessment billing.
    "@/lib/billing/billable-drivers": { getBillableDriverCount: async (db, id) => {
      resolutions++;
      assert.equal(db, service); assert.equal(id, "client");
      if (failure) throw new Error(failure);
      return { billable };
    } },
  });
  const response = await route.POST({ json: async () => ({ tier: "total_safety" }) });
  return { response, payloads: JSON.parse(JSON.stringify(payloads)), resolutions };
}

(async () => {
  for (const stated of [5, null]) {
    const { response, payloads } = await run({ stated });
    assert.equal(response.status, 200);
    assert.deepEqual(payloads, [{
      mode: "subscription", line_items: [{ price: "price_base", quantity: 1 }, { price: "price_driver", quantity: 45 }],
      success_url: "https://fixture.invalid/onboarding/success?session_id={CHECKOUT_SESSION_ID}", cancel_url: "https://fixture.invalid/onboarding",
      customer_email: "owner@example.invalid", metadata: { client_id: "client", user_id: "user", tier: "total_safety" },
      subscription_data: { metadata: { client_id: "client", tier: "total_safety" } },
    }]);
  }
  const absent = await run({ billable: null });
  assert.equal(absent.response.status, 409);
  assert.equal(absent.response.body.code, "DRIVER_COUNT_REQUIRED");
  assert.equal(absent.payloads.length, 0);
  const failed = await run({ failure: "Unable to load billable drivers from attested: permission denied" });
  assert.equal(failed.response.status, 500);
  assert.match(failed.response.body.error, /attested: permission denied/);
  assert.equal(failed.payloads.length, 0);
  const unauthorized = await run({ signedIn: false });
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.resolutions, 0);
  assert.equal(unauthorized.payloads.length, 0);
  console.log("PASS: resolved add-on quantity and completeness, unchanged prices/metadata/URLs, null/error rejection, and auth guard (5 isolated cases; no network)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
