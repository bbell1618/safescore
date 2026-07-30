import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sha256(path: string) {
  return createHash("sha256")
    .update(readFileSync(resolve(process.cwd(), path)))
    .digest("hex");
}

const globals = source("app/globals.css");
const layout = source("app/(portal)/portal/layout.tsx");
const nav = source("components/portal/nav.tsx");
const brand = source("components/portal/brand.tsx");
const divider = source("components/ui/section-divider.tsx");
const routeSkeleton = source("components/portal/route-skeleton.tsx");
const accountSkeleton = source("app/(portal)/portal/account/account-skeleton.tsx");
const home = source("app/(portal)/portal/page.tsx");
const playbook = source("app/(portal)/portal/playbook/page.tsx");
const activity = source("app/(portal)/portal/activity/page.tsx");
const documents = source("app/(portal)/portal/documents/page.tsx");
const account = source("app/(portal)/portal/account/page.tsx");
const sparkline = source("components/portal/burden-sparkline.tsx");
const chart = source("components/portal/burden-history-chart.tsx");
const motion = source("components/portal/motion.tsx");
const truck = source("components/portal/truck-loader.tsx");
const requestUpload = source("components/portal/request-upload.tsx");
const reportPrint = source("components/portal/sent-report-print-button.tsx");
const vault = source("app/(portal)/portal/documents/document-vault.tsx");
const tierUpgradeNote = source("components/portal/tier-upgrade-note.tsx");

const expectedAssetHashes = {
  "public/images/wallpaper.png":
    "2f12f4dbd4fb4ee13e46dc011b35281c051478a404dd3ebfe7fc2ed1c9d097c8",
  "public/images/navy-wallpaper.png":
    "8c3538287dfc2f90cf4e37440e15aff0084376bca5793e1f95aadf6d1c8218fb",
  "public/images/wallpaper.webp":
    "349adda5dff1096c6e90e587d6ff06b7b2beea64be144059b7c667757c95bd96",
  "public/images/navy-wallpaper.webp":
    "eac470344936815ddec0165469794fff0e870cd99116d1871d9411ac45a8f204",
};

for (const [path, expected] of Object.entries(expectedAssetHashes)) {
  assert.equal(sha256(path), expected, `${path} must match the optimized Run 4 artifact`);
}

assert.match(globals, /url\("\/images\/wallpaper\.png"\)/);
assert.match(globals, /url\("\/images\/navy-wallpaper\.png"\)/);
assert.match(globals, /url\("\/images\/wallpaper\.webp"\) type\("image\/webp"\)/);
assert.match(globals, /url\("\/images\/navy-wallpaper\.webp"\) type\("image\/webp"\)/);
assert.match(globals, /background-size:\s*400px 400px/);
assert.match(globals, /background-size:\s*500px 500px/);
assert.match(globals, /\.portal-brand-root \.btn-primary/);
assert.match(globals, /0 8px 24px rgba\(198, 122, 30, 0\.22\)/);
assert.match(globals, /\.portal-brand-root \.btn-secondary/);
assert.match(globals, /prefers-reduced-motion:\s*reduce/);
assert.match(globals, /\.portal-motion-reveal/);
assert.match(globals, /\.portal-motion-pressure-bar/);

assert.match(layout, /portal-brand-root portal-warm-texture/);
assert.match(nav, /portal-navy-texture sticky top-0/);
assert.match(nav, /text-warm-white/);
assert.match(nav, /h-0\.5 origin-left bg-gold/);
assert.match(nav, /layoutId="portal-active-tab-indicator"/);
assert.match(nav, /border-amber\/35 bg-amber\/10/);
assert.match(brand, /PortalHeroBand/);
assert.match(brand, /PortalFooterBand/);
assert.match(brand, /PortalSectionDivider/);
assert.match(divider, /M0,60 C360,100 1080,0 1440,60 L1440,80 L0,80 Z/);

for (const [name, page] of Object.entries({
  playbook,
  activity,
  documents,
  account,
})) {
  assert.match(page, /<PortalHeroBand/, `${name} needs the shared navy hero`);
  assert.match(page, /transition="navy-to-warm"/, `${name} needs a hero/body divider`);
  assert.match(page, /<PortalPageBody/, `${name} needs the warm textured body`);
  assert.match(page, /transition="warm-to-navy"/, `${name} needs a body/footer divider`);
  assert.match(page, /<PortalFooterBand/, `${name} needs the navy identity footer`);
}

assert.match(home, /portal-navy-texture/);
assert.match(home, /text-amber-light/);
assert.match(home, /<BurdenSparkline/);
assert.match(home, /FMCSA publishes no percentiles for low-volume carriers/);
assert.match(home, /<PortalPageBody/);
assert.match(home, /<PortalFooterBand/);

for (const graph of [sparkline, `${chart}\n${motion}`]) {
  assert.match(graph, /linearGradient/);
  assert.match(graph, /polygon/);
  assert.match(graph, /var\(--color-amber/);
  assert.match(graph, /var\(--color-gold\)/);
}
assert.match(chart, /PortalAnimatedActivitySeries/);
assert.match(motion, /motion\.polyline/);
assert.match(motion, /pathLength:\s*0/);
assert.match(truck, /GoldenEraTruckLoader/);
assert.match(truck, /useReducedMotion/);

for (const skeleton of [routeSkeleton, accountSkeleton]) {
  assert.match(skeleton, /PortalSectionDivider/);
  assert.match(skeleton, /portal-navy-texture|PortalHeroBand/);
  assert.match(skeleton, /PortalFooterBand|FooterSkeleton/);
}

for (const cta of [home, documents, requestUpload, reportPrint, vault]) {
  assert.match(cta, /btn-(?:primary|secondary)/);
}
assert.match(layout, /btn-secondary/);
assert.match(vault, /if \(!uploading\) fileInputRef\.current\?\.click\(\)/);
assert.match(tierUpgradeNote, /headingLevel\?: "h1" \| "h2"/);
assert.match(playbook, /headingLevel="h2"/);
assert.match(activity, /headingLevel="h2"/);

for (const portalSource of [
  layout,
  nav,
  routeSkeleton,
  accountSkeleton,
  home,
  playbook,
  activity,
  documents,
  account,
  requestUpload,
  reportPrint,
  vault,
  motion,
  truck,
]) {
  assert.doesNotMatch(portalSource, /\b(?:bg|text|border)-white(?:\/|\b)/);
  assert.doesNotMatch(portalSource, /#[0-9a-f]{3,8}\b/i);
}

assert.match(brand, /const NAVY = "var\(--color-navy\)"/);
assert.match(brand, /const TEXTURED_WARM = "transparent"/);

console.log(
  JSON.stringify(
    {
      passed: true,
      assetHashes: expectedAssetHashes,
      pages: ["Home", "Playbook", "Activity", "Documents", "Account"],
      contract: {
        navyChrome: true,
        texturedSurfaces: true,
        heroBodyFooterRhythm: true,
        sectionDividers: true,
        sharedButtons: true,
        amberCharts: true,
        reducedMotion: true,
        brandMatchedSkeletons: true,
      },
    },
    null,
    2
  )
);
