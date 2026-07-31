import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SentReportContent } from "../components/portal/sent-report-content";

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const documentsPage = source("app/(portal)/portal/documents/page.tsx");
const vault = source(
  "app/(portal)/portal/documents/document-vault.tsx"
);
const printPage = source(
  "app/(report-print)/portal/documents/reports/[reportId]/print/page.tsx"
);
const printLoading = source(
  "app/(report-print)/portal/documents/reports/[reportId]/print/loading.tsx"
);
const reportRenderer = source("components/portal/sent-report-content.tsx");
const printButton = source(
  "components/portal/sent-report-print-button.tsx"
);

assert.equal(
  (documentsPage.match(/getPortalClientPageContext\(\)/g) ?? []).length,
  1,
  "Documents must resolve the shared portal context once"
);
for (const feature of [
  "evidence_requests",
  "compliance_layer",
  "monthly_reports",
]) {
  assert.ok(
    documentsPage.includes(`tierHasFeature(context.tier, "${feature}")`),
    `Documents must gate ${feature} on the server`
  );
}
assert.match(documentsPage, /canSeeRequests\s*\?\s*loadOpenRequests/);
assert.match(documentsPage, /canSeeVault\s*\?\s*loadDocuments/);
assert.match(documentsPage, /canSeeReports\s*\?\s*loadSentReports/);
assert.match(documentsPage, /\.eq\("responsibility", "client"\)/);
assert.match(
  documentsPage,
  /status\.eq\.open,evidence_status\.in\.\(submitted,applied,insufficient\)/
);
assert.match(documentsPage, /\.eq\("status", "sent"\)/);
assert.match(documentsPage, /<Suspense fallback=/);

assert.match(vault, /initialDocuments: PortalDocumentRow\[\]/);
assert.doesNotMatch(vault, /useEffect/);
assert.doesNotMatch(vault, /fetch\("\/api\/portal\/documents"\)(?:;|\))/);
assert.match(vault, /router\.refresh\(\)/);
assert.match(vault, /\{ value: "report", label: "Archived report files" \}/);
assert.match(vault, /\.csv/);
assert.doesNotMatch(vault, /#[0-9a-f]{3,8}/i);

assert.match(printPage, /getPortalPageAccess\("monthly_reports"\)/);
assert.match(
  printPage,
  /if \(!access\.allowed\) redirect\("\/portal\/documents#from-geia"\)/
);
assert.match(printPage, /\.eq\("client_id", access\.clientId\)/);
assert.match(printPage, /\.eq\("status", "sent"\)/);
assert.match(printPage, /report\.final_content \?\? ""/);
assert.doesNotMatch(printPage, /ai_content/);

const sample = `Monthly progress report
Report date: July 30, 2026

## Burden Trend
Your burden improved by **one point**.

- Review the next installment

[FMCSA source](https://www.fmcsa.dot.gov/)

<script>alert("unsafe")</script>`;
const markup = renderToStaticMarkup(
  createElement(SentReportContent, { content: sample })
);
assert.match(markup, /<h1[^>]*>Monthly progress report<\/h1>/);
assert.match(markup, /<h2[^>]*>Burden Trend<\/h2>/);
assert.match(markup, /href="https:\/\/www\.fmcsa\.dot\.gov\/"/);
assert.doesNotMatch(markup, /<script>/);
assert.match(markup, /&lt;script&gt;/);

for (const [name, file] of Object.entries({
  documentsPage,
  vault,
  printPage,
  printLoading,
  reportRenderer,
  printButton,
})) {
  assert.doesNotMatch(file, /#[0-9a-f]{3,8}/i, `${name} must use theme tokens`);
}

console.log(
  JSON.stringify(
    {
      passed: true,
      zoneGates: [
        "evidence_requests",
        "compliance_layer",
        "monthly_reports",
      ],
      lockedZoneQueries: false,
      vaultInitialServerQuery: true,
      sentReportGuards: ["feature", "client_id", "status=sent"],
      reportSource: "final_content only",
      printDelivery: "HTML print view with browser Save as PDF",
    },
    null,
    2
  )
);
