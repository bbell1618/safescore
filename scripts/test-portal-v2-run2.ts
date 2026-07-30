import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePortalFeatureGate } from "../lib/portal/feature-gate";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const nav = source("components/portal/nav.tsx");
const expectedNav = [
  ["/portal", "Home"],
  ["/portal/playbook", "Playbook"],
  ["/portal/activity", "Activity"],
  ["/portal/documents", "Documents"],
  ["/portal/account", "Account"],
] as const;
let previousIndex = -1;
for (const [href, label] of expectedNav) {
  const index = nav.indexOf(`href: "${href}"`);
  assert.ok(index > previousIndex, `${label} is missing or out of order`);
  assert.ok(
    nav.slice(index, index + 180).includes(`label: "${label}"`),
    `${href} must be labeled ${label}`
  );
  previousIndex = index;
}
assert.equal((nav.match(/label:\s*"/g) ?? []).length, 5);
for (const retiredLabel of [
  "Dashboard",
  "Safety profile",
  "Monitoring",
  "Reports",
  "Cases",
  "Requests",
  "Compliance",
  "Settings",
]) {
  assert.ok(!nav.includes(`label: "${retiredLabel}"`));
}

const redirects = source("next.config.ts");
const expectedRedirects = {
  "/portal/safety": "/portal",
  "/portal/plan": "/portal/playbook",
  "/portal/monitoring": "/portal/activity",
  "/portal/cases": "/portal/activity",
  "/portal/requests": "/portal/documents",
  "/portal/reports": "/portal/documents",
  "/portal/profile": "/portal/account",
} as const;
for (const [from, to] of Object.entries(expectedRedirects)) {
  const sourceIndex = redirects.indexOf(`source: "${from}"`);
  const destinationIndex = redirects.indexOf(
    `destination: "${to}"`,
    sourceIndex
  );
  assert.ok(sourceIndex >= 0, `Missing redirect source ${from}`);
  assert.ok(
    destinationIndex > sourceIndex,
    `${from} must redirect to ${to}`
  );
}

const retiredPages = [
  "app/(portal)/portal/safety/page.tsx",
  "app/(portal)/portal/plan/page.tsx",
  "app/(portal)/portal/monitoring/page.tsx",
  "app/(portal)/portal/cases/page.tsx",
  "app/(portal)/portal/requests/page.tsx",
  "app/(portal)/portal/reports/page.tsx",
  "app/(portal)/portal/profile/page.tsx",
] as const;
for (const path of retiredPages) {
  assert.equal(existsSync(resolve(process.cwd(), path)), false, path);
}

const currentRoutes = [
  "app/(portal)/portal/playbook/page.tsx",
  "app/(portal)/portal/playbook/loading.tsx",
  "app/(portal)/portal/activity/page.tsx",
  "app/(portal)/portal/activity/loading.tsx",
  "app/(portal)/portal/documents/page.tsx",
  "app/(portal)/portal/documents/loading.tsx",
  "app/(portal)/portal/account/page.tsx",
  "app/(portal)/portal/account/loading.tsx",
] as const;
for (const path of currentRoutes) {
  assert.equal(existsSync(resolve(process.cwd(), path)), true, path);
}

const tierMatrix = {
  assessment: { playbook: false, activity: false, cases: false },
  monitor: { playbook: false, activity: true, cases: false },
  remediate: { playbook: true, activity: true, cases: true },
  total_safety: { playbook: true, activity: true, cases: true },
} as const;
for (const [tier, expected] of Object.entries(tierMatrix)) {
  const typedTier = tier as keyof typeof tierMatrix;
  assert.equal(
    evaluatePortalFeatureGate(typedTier, "playbook_coach").allowed,
    expected.playbook
  );
  assert.equal(
    evaluatePortalFeatureGate(typedTier, "trend_history").allowed,
    expected.activity
  );
  assert.equal(
    evaluatePortalFeatureGate(typedTier, "case_visibility").allowed,
    expected.cases
  );
}

const home = source("app/(portal)/portal/page.tsx");
assert.match(home, /href="\/portal\/activity#cases"/);
assert.match(home, /href="\/portal\/documents#needed-from-you"/);
assert.match(
  home,
  /FMCSA publishes no percentiles for low-volume carriers/
);
assert.match(
  home,
  /Under investigation means evidence is still[\s\S]*it does not mean a violation is removable/
);

const playbook = source("app/(portal)/portal/playbook/page.tsx");
const activity = source("app/(portal)/portal/activity/page.tsx");
const documents = source("app/(portal)/portal/documents/page.tsx");
const account = source("app/(portal)/portal/account/page.tsx");
for (const [name, file] of Object.entries({
  playbook,
  activity,
  documents,
  account,
})) {
  assert.doesNotMatch(file, /#[0-9a-f]{3,8}\b/i, `${name} has a raw color`);
  assert.doesNotMatch(
    file,
    /\b(?:bg|text|border)-gray-/,
    `${name} has a raw gray utility`
  );
}
assert.doesNotMatch(
  playbook,
  /\blane\s+c\b|truth[\s-]?up|template version|mapping review|unmapped code/i
);
assert.match(
  activity,
  /Only genuine data errors and crash-preventability are challengeable\./
);

const print = source(
  "app/(report-print)/portal/documents/reports/[reportId]/print/page.tsx"
);
assert.match(print, /getPortalPageAccess\("monthly_reports"\)/);
assert.match(print, /\.eq\("client_id", access\.clientId\)/);
assert.match(print, /\.eq\("status", "sent"\)/);
assert.doesNotMatch(print, /ai_content/);

console.log(
  JSON.stringify(
    {
      passed: true,
      nav: expectedNav,
      redirects: expectedRedirects,
      retiredPages,
      tierMatrix,
      sentReportPrint: {
        clientScoped: true,
        sentOnly: true,
        source: "final_content",
      },
    },
    null,
    2
  )
);
