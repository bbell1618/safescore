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
  "SafeScore is a safety-record review and support service provided by Golden Era Insurance Agency (GEIA). We help trucking companies understand the records held by the Federal Motor Carrier Safety Administration (FMCSA), the federal trucking safety agency. Your selected plan determines the work included.",
  "Assessment is a one-time review of your company's safety record with findings and recommended next steps. Its listed price is $299 unless GEIA records an approved waiver. It does not include ongoing monitoring or filing work. Monitor includes checks for changes to your public safety record, alerts, monthly reports and a history of changes. It does not include filing requests to correct records. Remediate includes Monitor plus review of possible record corrections, document requests, preparation and submission of authorized requests, and a prioritized safety improvement plan. GEIA evaluates the evidence before deciding whether a request is supported. Total Safety includes Remediate plus tracking of driver qualification documents, vehicle maintenance and inspection records, and required drug-and-alcohol database query dates. Tracking does not replace your company's duty to keep records, perform checks, maintain equipment and operate safely.",
  "SafeScore is not an insurance policy and does not provide, replace, or guarantee insurance coverage. It is not legal advice. Federal and state reviewers decide whether records should change; insurers make their own coverage and pricing decisions.",
  "We do not guarantee a lower score, removal of a violation or crash, acceptance of a correction request, a particular review time, or lower insurance costs. Reports depend on available records and may lag behind an agency's latest information.",
  "If your plan includes filing work and you give the required authorization, you authorize GEIA to access your company's safety data and prepare and submit requests on your company's behalf. These may include a Request for Data Review through DataQs (asking the agency to correct a record) or a Crash Preventability Determination Program request (asking whether a crash could have been prevented). FMCSA may notify the officials listed for your company when a request is filed under its USDOT number. You may revoke authorization by written notice to GEIA; this may prevent further filing work and does not withdraw a request already submitted.",
  "You must provide complete, accurate records and tell GEIA promptly if information is wrong or has changed. Review facts and supporting documents when asked. Authorizing GEIA to file does not transfer your responsibility for truthful information to GEIA. Federal law, including 18 U.S.C. 1001, prohibits knowingly and willfully making materially false statements or using materially false documents in matters within federal jurisdiction. This duty remains with you and also applies to anyone making a covered submission; the authorization does not excuse GEIA from its own duties.",
  "Some records have separate agency or provider charges, such as a police department's fee for a crash report. These are third-party pass-through costs, separate from the SafeScore service price. GEIA will identify any proposed charge and obtain your approval before ordering a paid record on your behalf. A provider's fee does not guarantee that a record is available or that a filing will succeed.",
  "The Assessment is a one-time purchase. Monthly plans bill in advance at the price shown before you subscribe. Total Safety also has a per-driver charge; the billed count uses the highest supported count from your current federal filing, confirmed company information, approved active driver roster or stated count. Tell GEIA when your count changes so it can be checked. You can cancel a monthly plan through the billing portal or by contacting GEIA; cancellation stops future renewals at the end of the paid period. Any refund or exception must be confirmed by GEIA; this draft does not promise one.",
  "We use public safety records, account information and documents you provide to deliver the services you authorize. GEIA staff and service providers may process that information for the service. Authorized filings may share relevant records with government reviewers. We do not sell your data. Keep access to your account secure and upload only information you are entitled to share. Contact GEIA with access, correction or deletion requests; legal and recordkeeping duties may limit what can be deleted. GEIA must approve the detailed retention and privacy terms before launch.",
  "GEIA will identify material changes to your plan or these terms before asking you to accept them or renewing at changed terms. This draft remains subject to GEIA approval. Daven must approve both these terms and the filing authorization wording before the draft banner is removed and new customers are asked to rely on them.",
  "Golden Era Insurance Agency, 200 Brown Rd Suite 203, Fremont, CA 94539. Contact info@goldenerainsurance.com for service, billing, cancellation or data questions."
] as const;

const expectedTitles = [
  "What SafeScore is",
  "Services by plan",
  "What SafeScore is not",
  "No outcome guarantees",
  "Filing authorization",
  "Accurate information and your responsibilities",
  "Third-party costs",
  "Billing and cancellation",
  "Data handling",
  "Service and terms changes",
  "Contact"
] as const;

assert.match(termsText, /SafeScore Terms of Service/);
assert.match(termsText, /Draft — pending GEIA approval/);
assert.match(termsText, /18 U\.S\.C\. 1001/);
assert.match(termsText, /third-party pass-through costs/);
assert.match(termsText, /Assessment is a one-time/);
assert.match(termsText, /highest supported count/);
assert.match(termsMarkup, /aria-label="Draft approval status"/);
assert.ok(
  termsText.includes(
    "Draft version — September 2026 · Golden Era Insurance Agency"
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
