import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isClientOnboardingLocked,
  isClientPostOnboardingLifecycle,
  resolveAuthCallbackNext,
} from "../lib/auth/access";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

assert.equal(
  isClientOnboardingLocked({
    status: "active",
  }),
  true
);
assert.equal(
  isClientOnboardingLocked({
    status: "paused",
  }),
  true
);
assert.equal(
  isClientOnboardingLocked({
    status: "churned",
  }),
  true
);
assert.equal(
  isClientOnboardingLocked({
    status: "onboarding",
  }),
  false
);
assert.equal(isClientOnboardingLocked({ status: "prospect" }), false);
assert.equal(
  isClientOnboardingLocked({
    status: "onboarding",
    service_agreement_accepted: true,
  }),
  true
);
assert.equal(
  isClientPostOnboardingLifecycle({ status: "onboarding" }),
  false
);
assert.equal(
  isClientPostOnboardingLifecycle({ status: "active" }),
  true
);

assert.equal(resolveAuthCallbackNext("/update-password"), "/update-password");
assert.equal(resolveAuthCallbackNext("/portal"), "/portal");
assert.equal(resolveAuthCallbackNext("/portal/requests"), "/portal/requests");
assert.equal(
  resolveAuthCallbackNext("/console/activity?source=auth"),
  "/console/activity?source=auth"
);
assert.equal(resolveAuthCallbackNext("//example.com"), "/console");
assert.equal(resolveAuthCallbackNext("https://example.com"), "/console");
assert.equal(
  resolveAuthCallbackNext("/unknown", "/update-password"),
  "/update-password"
);

for (const file of [
  "components/console/sidebar.tsx",
  "components/portal/nav.tsx",
]) {
  const source = read(file);
  assert.match(source, /await supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(source, /window\.location\.replace\("\/login"\)/);
  assert.match(source, /Unable to sign out:/);
}

const collision = read("components/auth/session-collision.tsx");
assert.match(
  collision,
  /Signed in as a portal user — sign out to access the console\./
);
assert.match(
  collision,
  /Signed in as a staff user — sign out to access the client portal\./
);

const proxy = read("proxy.ts");
assert.match(proxy, /url\.pathname = isClient \? "\/access-mismatch" : "\/login"/);
assert.match(proxy, /url\.pathname = isStaff \? "\/access-mismatch" : "\/login"/);
assert.match(proxy, /isClientPostOnboardingLifecycle\(client\)/);
assert.match(proxy, /"\/api\/auth\/password-reset"/);
assert.match(proxy, /client\.status === "active"/);

for (const file of [
  "app/api/portal/onboarding-profile/route.ts",
  "app/api/portal/fmcsa-credentials/route.ts",
]) {
  const source = read(file);
  assert.match(source, /isClientOnboardingLocked\(client(?:Record)?\)/);
  assert.match(source, /ONBOARDING_LOCKED/);
  assert.match(source, /status:\s*409/);
}
const checkoutRoute = read(
  "app/api/billing/create-checkout-session/route.ts"
);
assert.match(
  checkoutRoute,
  /isClientPostOnboardingLifecycle\(client\)/
);
assert.match(checkoutRoute, /ONBOARDING_LOCKED/);
assert.match(checkoutRoute, /status:\s*409/);

const setupRoute = read("app/api/auth/setup/route.ts");
assert.match(
  setupRoute,
  /const nextPath = isClientPostOnboardingLifecycle\(clientRecord\)/
);
assert.match(setupRoute, /onboardingRequired: nextPath === "\/onboarding"/);
assert.match(setupRoute, /listUsers\(\{\s*page,\s*perPage\s*\}\)/);
assert.match(setupRoute, /existingProfile\.role !== "client_user"/);
assert.match(
  setupRoute,
  /existingProfile\.client_id !== null/
);
assert.match(setupRoute, /code: "ACCOUNT_CONFLICT"/);

const onboarding = read("app/onboarding/page.tsx");
const finishStart = onboarding.indexOf(
  "async function finishAuthorization(includeFmcsaAccess: boolean)"
);
const finishEnd = onboarding.indexOf("async function handleSubscribe()", finishStart);
const finishSource = onboarding.slice(finishStart, finishEnd);
assert.match(finishSource, /await saveAgreement\(\)/);
assert.match(finishSource, /setOnboardingError/);

const resetRoute = read("app/api/auth/password-reset/route.ts");
assert.match(
  resetRoute,
  /EMAIL_DRY_RUN \?\? ""\)\.trim\(\)\.toLowerCase\(\) !== "false"/
);
assert.match(resetRoute, /resetPasswordForEmail/);
assert.doesNotMatch(resetRoute, /auth\.admin\.generateLink/);
assert.doesNotMatch(resetRoute, /resetUrl/);
assert.match(resetRoute, /requiresStaffAssistance: true/);

const staffResetRoute = read(
  "app/api/clients/[id]/password-reset/route.ts"
);
assert.match(staffResetRoute, /role !== "geia_admin"/);
assert.match(staffResetRoute, /role !== "geia_staff"/);
assert.match(staffResetRoute, /auth\.admin\.generateLink/);
assert.match(staffResetRoute, /type: "recovery"/);
assert.match(staffResetRoute, /password_reset_link_generated/);

const billingSync = read("app/api/billing/sync/route.ts");
assert.match(billingSync, /authClient\.auth\.getUser/);
assert.match(billingSync, /metadataClientId !== caller\.client_id/);
assert.match(billingSync, /activatePaidSubscription/);
assert.match(billingSync, /payment_status\s*!==\s*"paid"/);
assert.match(billingSync, /metadata\?\.tier/);
const billingActivation = read("lib/billing/activation.ts");
assert.match(billingActivation, /activate_paid_subscription_v1/);

const confirmationRoute = read("app/(auth)/auth/confirm/route.ts");
assert.match(confirmationRoute, /verifyOtp/);
assert.match(confirmationRoute, /type !== "recovery"/);

const updatePassword = read("app/(auth)/update-password/page.tsx");
assert.match(updatePassword, /auth\.updateUser\(\{ password \}\)/);
assert.match(updatePassword, /window\.location\.replace\("\/login\?password_reset=success"\)/);

console.log(
  JSON.stringify(
    {
      passed: true,
      onboardingLockCases: {
        active: true,
        paused: true,
        churned: true,
        agreementAccepted: true,
        incomplete: false,
      },
      callbackAllowlist: ["/console", "/portal", "/update-password"],
      guardedWriteRoutes: [
        "/api/portal/onboarding-profile",
        "/api/portal/fmcsa-credentials",
        "/api/billing/create-checkout-session",
      ],
      collisionInterstitials: ["console", "portal"],
      passwordRecovery: ["request", "confirm", "update", "sign-out"],
      passwordRecoveryExposure: "staff-only link generation",
      billingSync: "caller-bound and lifecycle-guarded",
    },
    null,
    2
  )
);
