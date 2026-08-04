import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  sendFmcsaPinRequestEmail,
  sendOperationsNotification,
  sendSafeScoreLiveEmail,
} from "../lib/email/client";
import { tierHasFeature } from "../lib/tiers";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const postActivation = read("lib/activation/post-activation-server.ts");
const staffActivation = read("app/api/clients/[id]/activate/route.ts");
const paidActivation = read("lib/billing/activation.ts");
const analysisImport = read("app/api/analysis/import/route.ts");
const migration = read(
  "supabase/migrations/20260804170401_run_a_activation_initialization_and_request_titles.sql"
);
const emailSource = read("lib/email/client.ts");

assert.match(staffActivation, /runPostActivationInitialization/);
assert.match(staffActivation, /newlyActivated:\s*result\.already_active\s*!==\s*true/);
assert.match(staffActivation, /initialization\.status === "in_progress"/);
assert.match(paidActivation, /runPostActivationInitialization/);
assert.match(paidActivation, /newlyActivated:\s*result\.already_active\s*!==\s*true/);
assert.match(paidActivation, /initialization\.status === "in_progress"/);
assert.doesNotMatch(analysisImport, /client_activated_by_analysis/);
assert.doesNotMatch(
  analysisImport,
  /\.update\(\{\s*status:\s*["']active["']\s*\}\)/
);

assert.match(postActivation, /tierHasFeature\(tier,\s*"case_visibility"\)/);
assert.match(postActivation, /MAX_CHALLENGEABILITY_BATCHES/);
assert.match(postActivation, /claim_client_activation_initialization_v1/);
assert.match(postActivation, /p_create_if_missing:\s*input\.newlyActivated/);
assert.match(postActivation, /client_activation_initialization_failed/);
assert.match(postActivation, /client_email_delivery/);
assert.match(postActivation, /staff_email_delivery/);

assert.match(migration, /create table if not exists public\.client_activation_initializations/);
assert.match(migration, /after update of status on public\.clients/);
assert.match(migration, /new\.status::text = 'active'/);
assert.match(migration, /'pending'/);
assert.match(migration, /p_create_if_missing boolean default false/);
assert.match(migration, /'not_enqueued'/);
assert.match(migration, /enable row level security/);
assert.match(migration, /to service_role/);

assert.equal(tierHasFeature("assessment", "case_visibility"), false);
assert.equal(tierHasFeature("monitor", "case_visibility"), false);
assert.equal(tierHasFeature("remediate", "case_visibility"), true);
assert.equal(tierHasFeature("total_safety", "case_visibility"), true);

assert.match(emailSource, /const OPERATIONS_RECIPIENT = "operations@goldenerainsurance\.com"/);
assert.match(
  emailSource,
  /Where to find your PIN:<\/strong> Log in to the ai\.fmcsa\.dot\.gov portal and look under your profile settings\./
);
assert.match(emailSource, /Do not send the PIN through ordinary email\./);
assert.match(emailSource, /portal sign-in[\s\S]*is ready/);
assert.doesNotMatch(emailSource, /SafeScore account[^\n]*is now active/);

async function main() {
  const priorDryRun = process.env.EMAIL_DRY_RUN;
  const originalLog = console.log;
  const dryRunEvents: Array<Record<string, unknown>> = [];
  console.log = (...args: unknown[]) => {
    if (args[0] !== "EMAIL_DRY_RUN" || typeof args[1] !== "string") return;
    dryRunEvents.push(JSON.parse(args[1]) as Record<string, unknown>);
  };

  try {
  process.env.EMAIL_DRY_RUN = "false";
  const blocked = await sendOperationsNotification({
    trigger: "staff_client_activated",
    subject: "SafeScore activated — Test Carrier (DOT 0000001)",
    heading: "Client activated",
    message: "The first analysis completed.",
    consoleUrl: "https://example.test/console/clients/client-id",
  });
  assert.equal(blocked.success, false);
  assert.match(blocked.error ?? "", /EMAIL_DRY_RUN is explicitly true/);
  assert.equal(dryRunEvents.length, 0);

  process.env.EMAIL_DRY_RUN = "true";
  const [operations, live, pin] = await Promise.all([
    sendOperationsNotification({
      trigger: "staff_client_activated",
      subject: "SafeScore activated — Test Carrier (DOT 0000001)",
      heading: "Client activated",
      message: "The first analysis completed.",
      consoleUrl: "https://example.test/console/clients/client-id",
    }),
    sendSafeScoreLiveEmail({
      to: "client@example.test",
      companyName: "Test Carrier",
      dotNumber: "0000001",
      tierLabel: "Remediate",
      portalUrl: "https://example.test/portal",
    }),
    sendFmcsaPinRequestEmail({
      to: "client@example.test",
      companyName: "Test Carrier",
      portalUrl: "https://example.test/portal/documents#needed-from-you",
    }),
  ]);
  assert.equal(operations.success, true);
  assert.equal(operations.dryRun, true);
  assert.equal(live.success, true);
  assert.equal(live.dryRun, true);
  assert.equal(pin.success, true);
  assert.equal(pin.dryRun, true);
  assert.equal(dryRunEvents.length, 3);
  assert.ok(
    dryRunEvents.some(
      (event) =>
        event.recipient === "operations@goldenerainsurance.com" &&
        event.trigger === "staff_client_activated"
    )
  );
  assert.ok(
    dryRunEvents.some(
      (event) =>
        event.recipient === "client@example.test" &&
        event.trigger === "client_safescore_live"
    )
  );
  assert.ok(
    dryRunEvents.some(
      (event) =>
        event.subject === "FMCSA Portal PIN requested — Test Carrier" &&
        event.trigger === "fmcsa_pin_requested"
    )
  );
  } finally {
    console.log = originalLog;
    if (priorDryRun === undefined) delete process.env.EMAIL_DRY_RUN;
    else process.env.EMAIL_DRY_RUN = priorDryRun;
  }

  console.log(
    JSON.stringify(
      {
        passed: true,
        activation: {
          sharedInitializer: true,
          lifecycleIntentTrigger: true,
          longstandingActiveWithoutIntent: "not_required",
          challengeabilityByTier: {
            assessment: false,
            monitor: false,
            remediate: true,
            total_safety: true,
          },
        },
        notifications: {
          operationsRecipientFixed: true,
          explicitDryRunRequired: true,
          clientLive: true,
          fmcsaPin: true,
        },
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
