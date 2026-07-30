import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportContent } from "../components/reports/report-content";
import { isStaffReportActionPath } from "../lib/auth/report-paths";
import {
  buildDraftReportUpdate,
  isDraftReport,
} from "../lib/reports/report-actions";
import {
  parseReportContent,
  parseReportInline,
} from "../lib/reports/report-content";

const sample = `Monthly progress report
Report date: July 23, 2026

## Burden Trend
Weighted burden improved by **17 points**.

- New violation reviewed
- Existing issue monitored

| BASIC | Points |
| --- | ---: |
| Unsafe Driving | 113 |

Read the [FMCSA source](https://www.fmcsa.dot.gov/) and keep \`ai_content\` intact.

<script>alert("unsafe")</script>`;

const blocks = parseReportContent(sample);
assert.deepEqual(
  blocks.slice(0, 3).map((block) => block.type),
  ["heading", "metadata", "heading"]
);
assert.equal(
  blocks.find((block) => block.type === "unordered-list")?.type,
  "unordered-list"
);
const table = blocks.find((block) => block.type === "table");
assert.ok(table && table.type === "table");
assert.deepEqual(table.headers, ["BASIC", "Points"]);
assert.deepEqual(table.rows, [["Unsafe Driving", "113"]]);

assert.deepEqual(parseReportInline("**reviewed**"), [
  { type: "strong", value: "reviewed" },
]);
assert.deepEqual(parseReportInline("[unsafe](javascript:alert(1))"), [
  { type: "text", value: "[unsafe](javascript:alert(1))" },
]);

const markup = renderToStaticMarkup(
  createElement(ReportContent, { content: sample })
);
assert.match(markup, /<h1[^>]*>Monthly progress report<\/h1>/);
assert.match(markup, /<h2[^>]*>Burden Trend<\/h2>/);
assert.match(markup, /<strong[^>]*>17 points<\/strong>/);
assert.match(markup, /<ul[^>]*>/);
assert.match(markup, /<table[^>]*>/);
assert.match(markup, /href="https:\/\/www\.fmcsa\.dot\.gov\/"/);
assert.doesNotMatch(markup, /<script>/);
assert.match(markup, /&lt;script&gt;/);

const emptyMarkup = renderToStaticMarkup(
  createElement(ReportContent, { content: "" })
);
assert.match(emptyMarkup, /No content recorded for this report\./);

const saveUpdate = buildDraftReportUpdate({
  action: "save",
  finalContent: "Operator-edited final copy",
  reviewerId: "00000000-0000-0000-0000-000000000001",
  reviewedAt: "2026-07-23T16:00:00.000Z",
});
assert.deepEqual(saveUpdate, {
  final_content: "Operator-edited final copy",
});
assert.equal("ai_content" in saveUpdate, false);

const reviewUpdate = buildDraftReportUpdate({
  action: "review",
  finalContent: "Approved final copy",
  reviewerId: "00000000-0000-0000-0000-000000000001",
  reviewedAt: "2026-07-23T16:00:00.000Z",
});
assert.deepEqual(reviewUpdate, {
  final_content: "Approved final copy",
  status: "reviewed",
  reviewed_by: "00000000-0000-0000-0000-000000000001",
  reviewed_at: "2026-07-23T16:00:00.000Z",
});
assert.equal("ai_content" in reviewUpdate, false);
assert.equal(isDraftReport("draft"), true);
assert.equal(isDraftReport("reviewed"), false);
assert.equal(isDraftReport("sent"), false);

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const migration = source(
  "supabase/migrations/20260723163056_add_report_review_audit.sql"
);
assert.match(migration, /add column if not exists reviewed_by uuid/i);
assert.match(migration, /add column if not exists reviewed_at timestamptz/i);
assert.match(migration, /reports_reviewed_by_fkey/);
assert.match(migration, /references public\.users\(id\)/i);

const access = source("lib/reports/report-access-server.ts");
assert.match(access, /staff\.role !== "geia_admin"/);
assert.match(access, /staff\.role !== "geia_staff"/);
assert.match(access, /\.eq\("id", reportId\)/);
assert.match(access, /\.eq\("client_id", clientId\)/);

const actionRoute = source("app/api/reports/[id]/route.ts");
assert.ok(
  (actionRoute.match(/\.eq\("status", "draft"\)/g) ?? []).length >= 2
);
assert.ok(
  (actionRoute.match(/\.eq\("client_id", clientId\)/g) ?? []).length >= 2
);
assert.match(actionRoute, /\.delete\(\)/);
assert.match(actionRoute, /status: 409/);

const generator = source("components/console/report-generator.tsx");
assert.doesNotMatch(generator, /fetch\(`\/api\/reports`/);
assert.doesNotMatch(generator, /\/send/);
assert.doesNotMatch(generator, /Save as reviewed/);
assert.match(generator, /Review saved draft/);
assert.equal(
  existsSync(resolve(process.cwd(), "app/api/reports/route.ts")),
  false
);
assert.match(
  generator,
  /`\/console\/clients\/\$\{clientId\}\/reports\/\$\{reportId\}`/
);

const history = source(
  "app/(console)/console/clients/[id]/reports/page.tsx"
);
assert.match(
  history,
  /href=\{`\/console\/clients\/\$\{id\}\/reports\/\$\{r\.id\}`\}/
);

const detailPage = source(
  "app/(console)/console/clients/[id]/reports/[reportId]/page.tsx"
);
const printPage = source(
  "app/(report-print)/console/clients/[id]/reports/[reportId]/print/page.tsx"
);
assert.match(detailPage, /loadStaffReportDetail\(\{ clientId, reportId \}\)/);
assert.match(printPage, /loadStaffReportDetail\(\{ clientId, reportId \}\)/);
assert.equal(
  existsSync(resolve(process.cwd(), "app/(report-print)/layout.tsx")),
  false
);

const proxy = source("proxy.ts");
assert.match(proxy, /isStaffReportActionPath\(path\)/);
assert.doesNotMatch(proxy, /path === "\/api\/reports"/);
assert.equal(
  isStaffReportActionPath(
    "/api/reports/00000000-0000-4000-8000-000000000001"
  ),
  true
);
assert.equal(
  isStaffReportActionPath(
    "/api/reports/00000000-0000-4000-8000-000000000001/send"
  ),
  true
);
assert.equal(isStaffReportActionPath("/api/reports/generate"), true);
assert.equal(isStaffReportActionPath("/api/reports/generate-text"), true);

const pdfGenerator = source("app/api/reports/generate/route.ts");
assert.match(pdfGenerator, /role !== "geia_admin"/);
assert.match(pdfGenerator, /role !== "geia_staff"/);
assert.match(pdfGenerator, /JSON\.stringify\(\{ error: "Forbidden" \}\)/);
assert.match(pdfGenerator, /client_id is required for staff users/);
assert.doesNotMatch(pdfGenerator, /userRecord\?\.client_id/);

const portalDocuments = source("app/(portal)/portal/documents/page.tsx");
const portalPrint = source(
  "app/(report-print)/portal/documents/reports/[reportId]/print/page.tsx"
);
assert.doesNotMatch(portalDocuments, /PortalDownloadReportButton/);
assert.match(portalDocuments, /\.eq\("status", "sent"\)/);
assert.match(portalPrint, /\.eq\("client_id", access\.clientId\)/);
assert.match(portalPrint, /\.eq\("status", "sent"\)/);
assert.match(portalPrint, /report\.final_content \?\? ""/);
assert.doesNotMatch(portalPrint, /ai_content/);
assert.equal(
  existsSync(
    resolve(process.cwd(), "components/portal/download-report-button.tsx")
  ),
  false
);

console.log(
  JSON.stringify(
    {
      passed: true,
      markdownBlocks: blocks.map((block) => block.type),
      aiContentPreserved: true,
      reviewedAudit: {
        reviewed_by: reviewUpdate.reviewed_by,
        reviewed_at: reviewUpdate.reviewed_at,
      },
      guardedMutations: ["save", "review", "delete"],
      generatorCreatesDuplicateRow: false,
      generatorExposesSend: false,
      portalPdfGenerationStaffOnly: true,
      portalPdfButtonRemoved: true,
      sentReportPrintGuarded: true,
    },
    null,
    2
  )
);
