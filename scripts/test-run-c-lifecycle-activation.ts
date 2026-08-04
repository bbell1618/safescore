import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isStaffManualActivationCandidate,
  subscriptionMrr,
} from "../lib/activation/staff-manual-activation";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

assert.equal(subscriptionMrr("monitor", null), 199);
assert.equal(subscriptionMrr("remediate", 500), 599);
assert.equal(subscriptionMrr("total_safety", 1), 1_028);
assert.equal(subscriptionMrr("total_safety", 5), 1_144);
assert.throws(
  () => subscriptionMrr("total_safety", null),
  /billing driver count of at least 1/
);

assert.equal(
  isStaffManualActivationCandidate({
    tier: "assessment",
    status: "awaiting_activation",
    serviceAgreementAccepted: true,
  }),
  true
);
assert.equal(
  isStaffManualActivationCandidate({
    tier: "assessment",
    status: "onboarding",
    serviceAgreementAccepted: true,
  }),
  false
);
for (const tier of ["monitor", "remediate", "total_safety"] as const) {
  assert.equal(
    isStaffManualActivationCandidate({
      tier,
      status: "onboarding",
      serviceAgreementAccepted: true,
    }),
    true
  );
  assert.equal(
    isStaffManualActivationCandidate({
      tier,
      status: "onboarding",
      serviceAgreementAccepted: false,
    }),
    false
  );
}

const route = read("app/api/clients/[id]/activate/route.ts");
const migration = read(
  "supabase/migrations/20260804235900_run_c_atomic_staff_subscription_activation.sql"
);
assert.match(route, /activate_assessment_client_v1/);
assert.match(route, /activateStaffConfirmedSubscription/);
assert.match(route, /activate_staff_confirmed_subscription_v1/);
assert.doesNotMatch(route, /\.from\("subscriptions"\)/);
assert.doesNotMatch(route, /\.from\("activity_log"\)/);
assert.doesNotMatch(route, /\.update\(\{\s*status:\s*"active"/);
assert.doesNotMatch(route, /stripe\.(customers|subscriptions|checkout)/);
assert.match(route, /runPostActivationInitialization/);
assert.match(route, /newlyActivated:\s*result\.already_active\s*!==\s*true/);

assert.match(
  migration,
  /create or replace function public\.activate_staff_confirmed_subscription_v1/
);
assert.match(migration, /language plpgsql[\s\S]*?security invoker/);
assert.match(migration, /from public\.clients c[\s\S]*?for update/);
assert.match(migration, /v_tier not in \('monitor', 'remediate', 'total_safety'\)/);
assert.match(migration, /when 'monitor' then 199/);
assert.match(migration, /when 'remediate' then 599/);
assert.match(
  migration,
  /when 'total_safety' then 999 \+ \(coalesce\(v_driver_count, 0\) \* 29\)/
);
assert.match(migration, /ONBOARDING_PROFILE_INCOMPLETE/);
assert.match(migration, /STRIPE_BILLING_PRESENT/);
assert.match(
  migration,
  /insert into public\.subscriptions \([\s\S]*?billing_cycle[\s\S]*?on conflict \(client_id\) do update/
);
assert.doesNotMatch(
  migration.match(/insert into public\.subscriptions \([\s\S]*?\) values/)?.[0] ?? "",
  /stripe_customer_id|stripe_subscription_id/
);
assert.match(migration, /update public\.clients[\s\S]*?status = 'active'/);
assert.match(migration, /'client_activated_by_staff'/);
assert.match(migration, /'source', 'console_manual_payment'/);
assert.match(migration, /'stripe_mutated', false/);
assert.match(
  migration,
  /revoke all on function public\.activate_staff_confirmed_subscription_v1\([\s\S]*?from public, anon, authenticated/
);
assert.match(
  migration,
  /grant execute on function public\.activate_staff_confirmed_subscription_v1\([\s\S]*?to service_role/
);

const control = read("components/console/client-activation-control.tsx");
const layout = read("app/(console)/console/clients/[id]/layout.tsx");
assert.match(control, /isStaffManualActivationCandidate/);
assert.match(control, /Confirm payment & activate/);
assert.match(control, /subscription payment outside Stripe/);
assert.match(layout, /service_agreement_accepted/);
assert.match(layout, /showActivationControl/);

const postActivation = read("lib/activation/post-activation-server.ts");
assert.match(postActivation, /notifyOperations\(service/);
assert.match(postActivation, /event:\s*"client_activated"/);
assert.match(postActivation, /trigger:\s*"staff_client_activated"/);
assert.match(postActivation, /staffEmailDelivery\s*=\s*operationsNotification\.delivery/);
assert.doesNotMatch(postActivation, /sendOperationsNotification/);

console.log(
  JSON.stringify(
    {
      passed: true,
      assessmentPath: "preserved RPC",
      recurringPath: {
        lifecycle: "onboarding/prospect -> active",
        billing: {
          monitor: 199,
          remediate: 599,
          totalSafetyExampleFiveDrivers: 1144,
        },
        stripeMutation: false,
      },
      operationsNotificationActivity: {
        actionType: "operations_notification_email",
        event: "client_activated",
      },
    },
    null,
    2
  )
);
