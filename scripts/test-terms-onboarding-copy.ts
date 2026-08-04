import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TermsPage from "../app/terms/page";
import { isPublicUnauthenticatedPagePath } from "../lib/auth/public-paths";
import {
  parseRequiredDriverCount,
  validateOnboardingStep2,
} from "../lib/onboarding/validation";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

function textFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const termsText = textFromHtml(
  renderToStaticMarkup(React.createElement(TermsPage))
);
const termsMarkup = renderToStaticMarkup(React.createElement(TermsPage));

function textWithoutInventedTagWhitespace(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const expectedTerms = [
  'SafeScore is a safety data and advocacy service provided by Golden Era Insurance Agency ("GEIA"). We analyze your carrier\'s FMCSA safety record, monitor it for changes, and \u2014 on qualifying plans \u2014 prepare and submit data challenges and crash preventability requests on your behalf, and coach your team through a prioritized safety improvement plan.',
  "SafeScore is not an insurance policy and does not provide, replace, or guarantee insurance coverage. It is not legal advice. Decisions on data challenges and crash preventability rest solely with FMCSA and its reviewers.",
  "We commit to the quality of our work, not to outcomes we don't control. We do not guarantee that any score, measure, violation, or crash record will change, or that any challenge will be accepted.",
  "Services and pricing are stated on your subscription confirmation. Monthly plans bill in advance each month. Total Safety pricing includes a per-driver component based on the driver count you provide and keep current. You can cancel any time; cancellation stops future billing at the end of the current period.",
  "Depending on your plan and the boxes you check during setup, you authorize GEIA to: access your carrier's FMCSA safety data; and prepare and submit DataQ Requests for Data Review and Crash Preventability Determination Program requests to FMCSA on your carrier's behalf. FMCSA notifies a carrier's officials of requests filed on its USDOT number. You can revoke authorizations by written notice; revocation may limit the services we can deliver.",
  "Provide accurate information (including your current driver count), respond to evidence requests in a timely way, and keep your contact details current. Our work product is only as good as the information you give us.",
  "We collect your FMCSA safety data and the information you provide in order to deliver the service. We do not sell your data. Documents you upload are used for the challenges and services you've authorized.",
  "We improve SafeScore continuously and may modify features. If we materially reduce what your plan includes, we'll notify you before your next billing cycle.",
  "To the maximum extent permitted by law, GEIA's total liability arising from SafeScore is limited to the amounts you paid for the service in the three months preceding the claim.",
  "We may update these terms; the current version always lives at this page with its version date. Continued use after an update constitutes acceptance.",
  "Golden Era Insurance Agency, 200 Brown Rd Suite 203, Fremont, CA 94539 \u00b7 info@goldenerainsurance.com.",
] as const;

const expectedTitles = [
  "What SafeScore is",
  "What SafeScore is not",
  "No outcome guarantees",
  "Your plan and billing",
  "Authorizations you grant",
  "Your responsibilities",
  "Data handling",
  "Service changes",
  "Liability",
  "Terms updates",
  "Contact",
] as const;

assert.match(termsText, /SafeScore Terms of Service/);
assert.ok(
  termsText.includes(
    "Version 1.0 \u2014 August 2026 \u00b7 Golden Era Insurance Agency"
  )
);
for (const [index, term] of expectedTerms.entries()) {
  const fullClause = `${index + 1}. ${expectedTitles[index]} \u2014 ${term}`;
  assert.ok(
    termsText.includes(fullClause),
    `Missing exact ordered terms clause: ${fullClause}`
  );
}
const renderedHeadings = [...termsMarkup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(
  (match) => textWithoutInventedTagWhitespace(match[1])
);
assert.deepEqual(
  renderedHeadings,
  expectedTitles.map((title, index) => `${index + 1}. ${title}`),
  "Terms headings must contain a real text-space after every clause number"
);
assert.equal(
  (termsText.match(/SafeScore Terms of Service/g) ?? []).length >= 1,
  true
);

assert.equal(isPublicUnauthenticatedPagePath("/terms"), true);
assert.equal(isPublicUnauthenticatedPagePath("/terms/"), true);
assert.equal(isPublicUnauthenticatedPagePath("/terms-extra"), false);
assert.equal(isPublicUnauthenticatedPagePath("/terms/privacy"), false);
assert.equal(isPublicUnauthenticatedPagePath("/evidence/example"), true);

const onboarding = read("app/onboarding/page.tsx");
const normalizedOnboarding = onboarding
  .replaceAll("&apos;", "'")
  .replaceAll('{"\\u2014"}', "\u2014")
  .replace(/\s+/g, " ");
assert.ok(normalizedOnboarding.includes("CURRENT DRIVER COUNT *"));
assert.ok(
  normalizedOnboarding.includes(
    "Count every driver who drives for you today \u2014 company drivers and owner-operators, full or part time. This number becomes your profile's source of truth: we size your service to it and correct your FMCSA record to match it."
  )
);
assert.match(onboarding, /href="\/terms"/);
assert.match(onboarding, /target="_blank"/);
assert.match(onboarding, /rel="noopener noreferrer"/);
assert.match(onboarding, /Terms of Service \(opens in a new tab\)/);
assert.match(
  onboarding,
  /DataQ filing authorization \(required for your plan\)/
);
assert.match(onboarding, /setContactName\(setupFullName\)/);
assert.doesNotMatch(
  onboarding,
  /setContactName\(setupFullName \|\| primaryContact\)/
);
assert.match(onboarding, /aria-labelledby="service-agreement-copy"/);
assert.match(onboarding, /aria-describedby=/);

const setup = read("app/(auth)/setup/page.tsx");
assert.match(setup, /href="\/terms"/);
assert.match(setup, />\s*Terms of Service\s*<\/Link>/);
assert.doesNotMatch(setup, /href="\/terms"[\s\S]{0,120}target="_blank"/);

const portalBrand = read("components/portal/brand.tsx");
assert.match(portalBrand, /href="\/terms"/);
assert.match(portalBrand, />\s*Terms of Service\s*<\/Link>/);

const meRoute = read("app/api/portal/me/route.ts");
assert.match(meRoute, /\.select\("client_id, full_name"\)/);
assert.match(meRoute, /setupFullName:/);

const invalidDriverCount = validateOnboardingStep2({
  vehicleTypes: ["Dry van"],
  operatingStates: ["CA"],
  operatingRadius: "local",
  driverCount: "0",
  citationDismissedLast24Months: false,
});
assert.equal(
  invalidDriverCount.errors.driverCount,
  "Enter your current driver count (at least 1)."
);
assert.equal(parseRequiredDriverCount("0"), null);
assert.equal(parseRequiredDriverCount("1"), 1);

console.log("Terms and onboarding copy contract passed.");
