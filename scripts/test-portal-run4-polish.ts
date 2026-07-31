import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const packageJson = JSON.parse(source("package.json")) as {
  dependencies: Record<string, string>;
};
const globals = source("app/globals.css");
const groupLoading = source("app/(portal)/loading.tsx");
const brand = source("components/portal/brand.tsx");
const divider = source("components/ui/section-divider.tsx");
const nav = source("components/portal/nav.tsx");
const motion = source("components/portal/motion.tsx");
const truck = source("components/portal/truck-loader.tsx");
const routeSkeleton = source("components/portal/route-skeleton.tsx");
const accountSkeleton = source(
  "app/(portal)/portal/account/account-skeleton.tsx"
);
const complianceLoading = source(
  "app/(portal)/portal/compliance/loading.tsx"
);
const home = source("app/(portal)/portal/page.tsx");
const playbook = source("app/(portal)/portal/playbook/page.tsx");
const activity = source("app/(portal)/portal/activity/page.tsx");
const interactiveChart = source(
  "components/portal/interactive-burden-history-chart.tsx"
);
const pressureBars = source("components/portal/basic-pressure-list.tsx");
const documents = source("app/(portal)/portal/documents/page.tsx");
const vault = source("app/(portal)/portal/documents/document-vault.tsx");
const account = source("app/(portal)/portal/account/page.tsx");

assert.equal(packageJson.dependencies["framer-motion"], "^12.35.0");

const assets = [
  "public/images/wallpaper.webp",
  "public/images/navy-wallpaper.webp",
  "public/images/wallpaper.png",
  "public/images/navy-wallpaper.png",
];
const assetSizes = Object.fromEntries(
  assets.map((path) => [path, statSync(resolve(process.cwd(), path)).size])
);
for (const [path, bytes] of Object.entries(assetSizes)) {
  assert.ok(bytes <= 200_000, `${path} is ${bytes} bytes; expected <= 200 KB`);
}

assert.match(globals, /html:has\(\.portal-brand-root\)/);
assert.match(globals, /body:has\(\.portal-brand-root\)/);
assert.match(globals, /image-set\(/);
assert.match(globals, /wallpaper\.webp/);
assert.match(globals, /navy-wallpaper\.webp/);
assert.match(globals, /\.portal-motion-reveal/);
assert.match(globals, /\.portal-motion-pressure-bar/);
assert.match(globals, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(globals, /\.portal-section-enter/);
assert.doesNotMatch(globals, /\.portal-card-lift/);

assert.match(brand, /const TEXTURED_WARM = "transparent"/);
assert.doesNotMatch(brand, /border-y border-warm-white/);
assert.match(divider, /fromColor = "transparent"/);
assert.match(divider, /toColor = "var\(--color-navy\)"/);
assert.match(divider, /pointer-events-none/);
assert.match(divider, /M0,0 H1440 V60 C1080,0 360,100 0,60 Z/);
assert.doesNotMatch(divider, /<rect/);
assert.doesNotMatch(home, /border-y border-warm-white/);
assert.doesNotMatch(routeSkeleton, /border-y border-warm-white/);

assert.match(nav, /layoutId="portal-active-tab-indicator"/);
assert.match(nav, /type: "spring"/);
assert.match(nav, /useReducedMotion/);
assert.match(nav, /border-b border-gold\/15/);

assert.match(motion, /PortalAnimatedNumber/);
assert.match(motion, /PortalAnimatedPressureBar/);
assert.match(motion, /PortalAnimatedActivitySeries/);
assert.match(motion, /useInView/);
assert.match(motion, /useReducedMotion/);
assert.match(motion, /useState\(0\)/);
assert.match(motion, /Math\.round\(visibleValue\)/);
assert.doesNotMatch(motion, /started\.current/);
assert.match(motion, /whileHover/);
assert.match(motion, /pathLength:\s*0/);
assert.match(motion, /pathLength:\s*1/);

assert.match(truck, /GoldenEraTruckLoader/);
assert.match(truck, /useReducedMotion/);
assert.match(truck, /motion\.div/);
assert.doesNotMatch(truck, /motion\.svg/);
assert.match(routeSkeleton, /GoldenEraTruckLoader/);
assert.match(accountSkeleton, /GoldenEraTruckLoader/);
assert.match(complianceLoading, /GoldenEraTruckLoader/);
assert.match(groupLoading, /PortalRouteSkeleton/);
assert.match(groupLoading, /portal-brand-root portal-warm-texture/);

assert.match(home, /PortalAnimatedNumber value=\{latest\.total_points\}/);
assert.match(pressureBars, /portal-motion-pressure-bar/);
assert.match(pressureBars, /whileInView/);
assert.match(home, /PortalMotionListItem/);
assert.match(home, /GoldenEraTruckLoader compact/);

assert.match(playbook, /function PlaybookHeroMetric/);
assert.match(
  playbook,
  /PortalAnimatedNumber value=\{playbook\.family_programs\.length\}/
);
assert.match(playbook, /PortalMotionListItem/);
assert.match(playbook, /PortalMotionArticle/);
assert.match(playbook, /GoldenEraTruckLoader compact/);

assert.match(activity, /function ActivityHeroMetric/);
assert.match(activity, /PortalAnimatedNumber value=\{latest\.totalPoints\}/);
assert.match(activity, /PortalMotionSection/);
assert.match(activity, /PortalMotionListItem/);
assert.match(activity, /GoldenEraTruckLoader compact/);
assert.match(interactiveChart, /PortalAnimatedActivitySeries/);

assert.match(documents, /<PortalMotionSection/);
assert.match(documents, /interactive/);
assert.match(documents, /PortalMotionArticle/);
assert.match(documents, /GoldenEraTruckLoader compact/);
assert.match(documents, /aria-label="Loading documents"/);
assert.doesNotMatch(documents, /className="[^"]*\sanimate-pulse/);
assert.match(vault, /motion\.div/);
assert.match(vault, /cursor-pointer/);
assert.match(vault, /useReducedMotion/);

assert.match(account, /<PortalMotionSection/);
assert.match(account, /ariaLabelledBy=\{labelledBy\}/);

for (const [name, page] of Object.entries({
  Home: home,
  Playbook: playbook,
  Activity: activity,
  Documents: documents,
  Account: account,
})) {
  assert.match(
    page,
    /PortalMotion(?:Section|Article|ListItem)/,
    `${name} needs Framer-backed reveal surfaces`
  );
  assert.match(page, /transition="navy-to-warm"/);
  assert.match(page, /transition="warm-to-navy"/);
}

console.log(
  JSON.stringify(
    {
      passed: true,
      framerMotion: packageJson.dependencies["framer-motion"],
      assetSizes,
      motionInventory: {
        Home: ["burden count-up", "BASIC bar fill", "sections", "service cards"],
        Playbook: ["program count-up", "sections", "program/installment cards"],
        Activity: ["latest count-up", "chart draw", "sections", "filing rows"],
        Documents: ["zone reveals/lifts", "request/report cards", "drop-zone press"],
        Account: ["account-card reveals"],
      },
      truckLoader: {
        routeSkeletons: true,
        streamedFallbacks: true,
        reducedMotion: true,
      },
      seams: {
        warmSide: "transparent over portal warm texture",
        navySide: "Brand v3 navy token",
        outerWhiteBorders: false,
      },
    },
    null,
    2
  )
);
