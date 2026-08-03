import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  humanEnteredNameOrEmpty,
  ONBOARDING_PLACEHOLDER_NAMES,
  parseRequiredDriverCount,
  validateOnboardingStep2,
} from "../lib/onboarding/validation";
import {
  isClientOnboardingLocked,
  isClientPostOnboardingLifecycle,
} from "../lib/auth/access";
import { resolveAssignedInviteTier } from "../lib/portal/invites";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const inviteRoute = read("app/api/clients/[id]/invite/route.ts");
assert.equal(resolveAssignedInviteTier(null), null);
assert.equal(resolveAssignedInviteTier("bogus"), null);
assert.equal(resolveAssignedInviteTier("monitor"), "monitor");
assert.match(inviteRoute, /\.select\([\s\S]*?tier[\s\S]*?\)/);
assert.match(inviteRoute, /TIER_REQUIRED/);
const tierGuardIndex = inviteRoute.indexOf("TIER_REQUIRED");
const inviteInsertIndex = inviteRoute.indexOf('.from("client_invites")', tierGuardIndex);
assert.ok(tierGuardIndex >= 0 && inviteInsertIndex > tierGuardIndex,
  "The assigned-tier refusal must run before invite creation");
const clientsRoute = read("app/api/clients/route.ts");
assert.match(clientsRoute, /isClientTier\(tier\)/);
assert.match(clientsRoute, /CLIENT_TIER_REQUIRED/);
assert.doesNotMatch(clientsRoute, /tier\s*\?\?\s*SUBSCRIPTION_TIERS\[0\]/);

const onboarding = read("app/onboarding/page.tsx");
assert.doesNotMatch(onboarding, /assignedTierData[^\n]*\?\?\s*TIERS\[0\]/);
assert.match(onboarding, /Your GEIA account manager has selected/);
assert.match(onboarding, /view other service options/i);
assert.match(onboarding, /confirm the switch/i);
assert.match(
  onboarding,
  /service_agreement_accepted === true[\s\S]{0,180}setStep\(4\)/
);
assert.doesNotMatch(onboarding, /Onboarding details are read-only/);
assert.match(onboarding, /step2Validation\.summary/);
assert.match(onboarding, /Skip FMCSA access for now[^\n]*requires the service agreement above/i);
assert.match(onboarding, /Accept the service agreement above before skipping FMCSA access/i);
assert.match(
  onboarding,
  /couldn&apos;t verify this DOT with FMCSA[\s\S]{0,180}Confirm the[\s\S]{0,80}company name and USDOT number below/i
);
assert.match(onboarding, /min=\{1\}/);
assert.doesNotMatch(onboarding, /useState\(0\).*driver/i);
assert.match(
  onboarding,
  /step2Validation\.errors\.citationDismissedLast24Months/
);
assert.doesNotMatch(onboarding, /hasEvidenceRequests[^\n]*&&[\s\S]{0,180}CITATION_DISMISSED_INTAKE_QUESTION/);

assert.equal(humanEnteredNameOrEmpty("Pending Onboarding"), "");
assert.equal(humanEnteredNameOrEmpty("  Pending onboarding  "), "");
assert.equal(humanEnteredNameOrEmpty("Invite pending"), "");
assert.equal(humanEnteredNameOrEmpty("  Jamie Carrier  "), "Jamie Carrier");
assert.ok(ONBOARDING_PLACEHOLDER_NAMES.size > 0);
assert.equal(parseRequiredDriverCount(""), null);
assert.equal(parseRequiredDriverCount(0), null);
assert.equal(parseRequiredDriverCount("1"), 1);
assert.equal(parseRequiredDriverCount("4.5"), null);
const missingStep2 = validateOnboardingStep2({
  vehicleTypes: [],
  operatingStates: [],
  operatingRadius: "",
  driverCount: "0",
  citationDismissedLast24Months: null,
});
assert.equal(missingStep2.valid, false);
assert.match(missingStep2.summary ?? "", /^Still needed:/);
assert.equal(missingStep2.errors.driverCount,
  "Enter your current driver count (at least 1).");
assert.equal(missingStep2.errors.citationDismissedLast24Months,
  "Choose yes or no.");

const profileRoute = read("app/api/portal/onboarding-profile/route.ts");
assert.match(profileRoute, /driverCount[^\n]*(?:>=\s*1|<\s*1)/);
assert.match(profileRoute, /DRIVER_COUNT_INVALID|VALIDATION_ERROR/);
assert.match(profileRoute, /citation_dismissed_last_24_months/);
assert.doesNotMatch(profileRoute, /FEATURE_NOT_IN_TIER/);

const tierRoute = read("app/api/portal/onboarding-tier/route.ts");
assert.match(tierRoute, /isClientTier/);
assert.match(tierRoute, /change_client_onboarding_tier_v1/);
assert.match(tierRoute, /assignedTier/);
assert.match(tierRoute, /previousTier/);

const activationRoute = read("app/api/portal/onboarding-activation/route.ts");
assert.match(activationRoute, /submit_assessment_activation_v1/);
assert.match(activationRoute, /nextPath:\s*"\/onboarding"/);

const staffActivationRoute = read("app/api/clients/[id]/activate/route.ts");
assert.match(staffActivationRoute, /activate_assessment_client_v1/);
assert.match(staffActivationRoute, /requireStaffOnboardingUser/);

const access = read("lib/auth/access.ts");
assert.match(access, /awaiting_activation/);
assert.equal(isClientOnboardingLocked({ status: "awaiting_activation" }), true);
assert.equal(isClientPostOnboardingLifecycle({ status: "awaiting_activation" }), false);
assert.equal(isClientPostOnboardingLifecycle({ status: "active" }), true);
const proxy = read("proxy.ts");
assert.match(proxy, /client\.status === "active"/);
assert.match(proxy, /isClientPostOnboardingLifecycle\(client\)/);

const checkout = read("app/api/billing/create-checkout-session/route.ts");
assert.match(checkout, /tier[^\n]*(?:client|persisted)|client[^\n]*tier/i);
assert.match(checkout, /TIER_MISMATCH|does not match|selected service tier/i);
assert.doesNotMatch(checkout, /body\.tier\s*\?\?\s*"monitor"/);
assert.match(checkout, /driver_count/);

const sync = read("app/api/billing/sync/route.ts");
assert.match(sync, /tier/);
assert.match(sync, /activatePaidSubscription/);
assert.match(sync, /payment_status\s*!==\s*"paid"/);
assert.match(sync, /metadata\?\.tier/);

const webhook = read("app/api/billing/webhook/route.ts");
assert.match(webhook, /checkout\.session\.completed/);
assert.match(webhook, /tier/);
assert.match(webhook, /activatePaidSubscription/);

const billingActivation = read("lib/billing/activation.ts");
assert.match(billingActivation, /activate_paid_subscription_v1/);

const clientConsole = [
  "app/(console)/console/clients/[id]/layout.tsx",
  "app/(console)/console/clients/[id]/page.tsx",
  "app/(console)/console/clients/[id]/account/page.tsx",
].map(read).join("\n");
assert.match(clientConsole, /tier_changed_by_client|service option[\s\S]*changed|selected[\s\S]*assigned/i);

const homeFiles = [
  "app/(portal)/portal/page.tsx",
  "components/portal/home-client.tsx",
  "components/portal/home-hero.tsx",
].filter((path) => existsSync(resolve(root, path)));
assert.ok(homeFiles.length > 0, "Portal Home implementation was not found");
assert.ok(homeFiles.some((path) => read(path).includes("pending first analysis")),
  "Portal Home must render the explicit first-analysis pending state");

const migrationFiles = readdirSync(resolve(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"));
const statusMigration = migrationFiles.find((name) => {
  const sql = read(`supabase/migrations/${name}`);
  return sql.includes("awaiting_activation") && sql.includes("client_status");
});
assert.ok(statusMigration, "An idempotent client_status migration must add awaiting_activation");
const migrationSql = read(`supabase/migrations/${statusMigration}`);
assert.match(migrationSql, /ADD VALUE IF NOT EXISTS/i);
const migrationCorpus = migrationFiles
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n");
assert.match(migrationCorpus, /submit_assessment_activation_v1/);
assert.match(migrationCorpus, /service_agreement_accepted/);
assert.match(migrationCorpus, /status\s*=\s*'awaiting_activation'/);
assert.match(migrationCorpus, /activate_assessment_client_v1/);
assert.match(migrationCorpus, /v_status\s*<>\s*'awaiting_activation'/);
assert.match(migrationCorpus, /'client_activated_by_staff'/);
assert.match(migrationCorpus, /activate_paid_subscription_v1/);
assert.match(migrationCorpus, /v_tier\s*<>\s*p_tier::text/);
assert.match(migrationCorpus, /tier_changed_by_client/);
assert.match(migrationCorpus, /activity_log/);
assert.match(migrationCorpus, /requires_staff_follow_up/);

console.log(JSON.stringify({
  passed: true,
  contracts: {
    tierlessInvite: "refused before insert",
    assignedTier: "no Assessment fallback",
    tierChange: "persisted and staff-surfaced",
    assessment: "awaiting_activation",
    staffActivation: "awaiting_activation -> active",
    driverCount: "integer minimum 1",
    citationQuestion: "unconditional persistence",
    checkout: "persisted tier bound to test checkout",
    placeholders: "known seeds suppressed",
    homeZeroState: "pending first analysis",
  },
  migration: statusMigration,
}, null, 2));
