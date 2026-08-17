import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(
  content: string,
  expected: string,
  contract: string
): void {
  assert.ok(content.includes(expected), `${contract}: missing ${JSON.stringify(expected)}`);
}

function assertMatches(
  content: string,
  expected: RegExp,
  contract: string
): void {
  assert.match(content, expected, contract);
}

function assertOrdered(
  content: string,
  values: readonly string[],
  contract: string
): void {
  let cursor = -1;
  for (const value of values) {
    const next = content.indexOf(value, cursor + 1);
    assert.ok(next >= 0, `${contract}: missing ${JSON.stringify(value)}`);
    assert.ok(
      next > cursor,
      `${contract}: ${JSON.stringify(value)} appeared out of order`
    );
    cursor = next;
  }
}

function filesUnder(path: string): string[] {
  const absolute = join(root, path);
  const output: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const candidate = join(absolute, entry);
    if (statSync(candidate).isDirectory()) {
      output.push(...filesUnder(relative(root, candidate)));
    } else {
      output.push(relative(root, candidate));
    }
  }
  return output;
}

const clientTabs = source("components/console/client-tabs.tsx");
assertMatches(
  clientTabs,
  /const TABS:[\s\S]*?=\s*\[\s*\{\s*key:\s*["']checklist["'],\s*label:\s*["']Checklist["'],\s*href:\s*["']\/checklist["']\s*\}/,
  "Checklist must be the first client-detail tab"
);
assertIncludes(
  clientTabs,
  'if (pathname.includes("/checklist")) return "checklist";',
  "Checklist tab must resolve as active"
);

const checklistPage = source(
  "app/(console)/console/clients/[id]/checklist/page.tsx"
);
assertIncludes(
  checklistPage,
  'import { getClientChecklist } from "@/lib/operator/checklist-server";',
  "Checklist page must load the server-derived payload"
);
assertIncludes(
  checklistPage,
  "<OperatorChecklist",
  "Checklist page must render the interactive checklist"
);
assertOrdered(
  checklistPage,
  ["try {", "await getClientChecklist(id)", "} catch (error)", 'role="alert"'],
  "Checklist context failures must render a loud error rather than an all-clear"
);
assertIncludes(
  checklistPage,
  "No all-clear is shown.",
  "Checklist error copy must reject a false empty state"
);

const checklistUi = source("components/console/operator-checklist.tsx");
assertIncludes(checklistUi, '"use client";', "Checklist UI must be a client component");
assertOrdered(
  checklistUi,
  [
    'label: "Needs you"',
    'label: "Waiting on client"',
    'label: "Waiting on gates"',
    "function ManualItems",
  ],
  "Checklist groups must render in the required order"
);
for (const requiredCopy of [
  "familyVariant(item.family)",
  "{item.title}",
  "{item.why}",
  "Do this next",
  "{item.instructions.map",
  "item.href.trim()",
  "Mark done",
  "Snooze {snoozeDays} days",
  "Add item",
  "Due date (optional)",
  "Nothing needs you right now",
  "waiting on client",
  "waiting on gates",
]) {
  assertIncludes(checklistUi, requiredCopy, "Checklist item/UI contract");
}
assertMatches(
  checklistUi,
  /item\.canMarkDone\s*\?\s*\([\s\S]*?Mark done/,
  "Mark-done control must be capability-gated"
);
assertMatches(
  checklistUi,
  /item\.canSnooze\s*\?\s*\([\s\S]*?Snooze \{snoozeDays\} days/,
  "Snooze control must be capability-gated"
);
assertMatches(
  checklistUi,
  /item\.href\.trim\(\)\s*\?\s*\([\s\S]*?\bGo\b/,
  "The Go control must disappear for the no-action waiting item"
);
for (const endpoint of [
  "/checklist`",
  "/checklist/ack`",
  "/checklist/manual`",
  "/checklist/manual/${encodeURIComponent(item.id)}`",
]) {
  assertIncludes(checklistUi, endpoint, "Checklist UI must wire every mutation/read route");
}

const consolePage = source("app/(console)/console/page.tsx");
assertIncludes(
  consolePage,
  'import { getOperatorToday } from "@/lib/operator/checklist-server";',
  "Console home must derive Today server-side"
);
assertOrdered(
  consolePage,
  ["<OperatorToday", "{/* Header */}", "Client overview", "All clients"],
  "Today must appear before the existing console overview"
);
assertMatches(
  consolePage,
  /getOperatorToday\(\)[\s\S]*?catch\(\(error:[\s\S]*?Unknown Today context loading failure/,
  "Today must preserve context-load errors"
);

const todayUi = source("components/console/operator-today.tsx");
for (const requiredCopy of [
  "Primary operating surface",
  "Today",
  "Today could not load a complete operator context.",
  "No all-clear is shown.",
  "System gates",
  "Open checklist",
]) {
  assertIncludes(todayUi, requiredCopy, "Today UI contract");
}
assertMatches(
  todayUi,
  /items\.length\}\s+need\$\{items\.length\s*===\s*1\s*\?\s*["']s["']\s*:\s*["']["']\}\s+you/,
  "Today must display the dynamic needs-you count"
);
assertIncludes(
  todayUi,
  "item.href.trim()",
  "Today must not render empty links"
);

const monitoringPage = source(
  "app/(console)/console/clients/[id]/monitoring/page.tsx"
);
assertIncludes(
  monitoringPage,
  '"id, type, severity, title, message, created_at, acknowledged_at, acknowledged_by"',
  "Monitoring must load acknowledgement state"
);
assertIncludes(
  monitoringPage,
  "<MonitoringAlertList",
  "Monitoring must render the acknowledgment-aware alert list"
);
const alertUi = source("components/console/monitoring-alert-list.tsx");
for (const requiredCopy of [
  '"use client";',
  "/api/monitoring/alerts/${encodeURIComponent(alertId)}/acknowledge",
  '{ method: "POST" }',
  "alert.acknowledged_at === null",
  "Acknowledge",
  "Acknowledged",
  'isUnread ? "bg-[#FFF9EF]" : "bg-white text-gray-500"',
]) {
  assertIncludes(alertUi, requiredCopy, "Monitoring alert acknowledgement contract");
}

const routePaths = [
  "app/api/clients/[id]/checklist/route.ts",
  "app/api/clients/[id]/checklist/ack/route.ts",
  "app/api/clients/[id]/checklist/manual/route.ts",
  "app/api/clients/[id]/checklist/manual/[itemId]/route.ts",
  "app/api/operator/today/route.ts",
  "app/api/monitoring/alerts/[id]/acknowledge/route.ts",
] as const;
for (const routePath of routePaths) {
  const route = source(routePath);
  assertIncludes(
    route,
    "requireStaffOnboardingUser",
    `${routePath} must use the established staff-auth guard`
  );
  assertMatches(
    route,
    /await requireStaffOnboardingUser\(\)/,
    `${routePath} must execute the staff-auth guard`
  );
}

const checklistAckRoute = source("app/api/clients/[id]/checklist/ack/route.ts");
assertIncludes(checklistAckRoute, ".strict();", "Checklist ack schema must reject extra fields");
assertIncludes(
  checklistAckRoute,
  "evaluateChecklist(context).find",
  "Checklist ack must validate the exact current derived item"
);
assertIncludes(
  checklistAckRoute,
  "CHECKLIST_ITEM_NOT_ACTIVE",
  "Checklist ack must reject stale/suppressed items"
);
assertIncludes(
  checklistAckRoute,
  "CHECKLIST_DONE_NOT_ALLOWED",
  "Checklist ack must enforce canMarkDone"
);
assertIncludes(
  checklistAckRoute,
  "CHECKLIST_SNOOZE_NOT_ALLOWED",
  "Checklist ack must enforce canSnooze"
);

const manualCreateRoute = source(
  "app/api/clients/[id]/checklist/manual/route.ts"
);
assertIncludes(manualCreateRoute, ".strict();", "Manual create schema must reject extra fields");
const manualPatchRoute = source(
  "app/api/clients/[id]/checklist/manual/[itemId]/route.ts"
);
assertIncludes(manualPatchRoute, ".strict()", "Manual patch schema must reject extra fields");
assertIncludes(
  manualPatchRoute,
  "Provide exactly one manual-item action.",
  "Manual patch must accept exactly one action"
);
assertIncludes(
  manualPatchRoute,
  "{ deleted_at: now }",
  "Manual removal must be a soft delete"
);
assert.ok(
  !manualPatchRoute.includes(".delete("),
  "Manual item route must never hard-delete rows"
);
assertIncludes(
  manualPatchRoute,
  '.is("deleted_at", null)',
  "Manual patch must ignore already-deleted rows"
);

const alertAckRoute = source(
  "app/api/monitoring/alerts/[id]/acknowledge/route.ts"
);
assertIncludes(
  alertAckRoute,
  '.is("acknowledged_at", null)',
  "Alert acknowledgement must use a compare-and-set predicate"
);
assertIncludes(
  alertAckRoute,
  "ALERT_ALREADY_ACKNOWLEDGED",
  "Alert acknowledgement must reject an existing receipt"
);

const proxy = source("proxy.ts");
assertIncludes(proxy, '"/api/clients"', "Checklist APIs must remain staff-only in proxy");
assertIncludes(proxy, '"/api/monitoring/"', "Monitoring mutations must remain staff-only in proxy");
assertIncludes(proxy, '"/api/operator/"', "Operator APIs must remain staff-only in proxy");
const publicPathSource = `${proxy}\n${source("lib/auth/public-paths.ts")}`;
for (const forbiddenPublicPath of [
  "/api/operator/",
  "/api/monitoring/",
  "/api/clients/[id]/checklist",
]) {
  const publicLists = /const publicApiExactPaths[\s\S]*?const isPublicEvidenceUpload/.exec(
    proxy
  )?.[0] ?? "";
  assert.ok(
    !publicLists.includes(forbiddenPublicPath),
    `${forbiddenPublicPath} must not be exposed through proxy public API lists`
  );
  if (forbiddenPublicPath.includes("[id]")) {
    assert.ok(
      !source("lib/auth/public-paths.ts").includes("checklist"),
      "Checklist routes must not be exposed by public-path helpers"
    );
  }
}
assert.ok(
  !publicPathSource.includes('path.startsWith("/api/operator/")') &&
    !publicPathSource.includes('path.startsWith("/api/monitoring/")'),
  "No public-path helper may classify the new operator routes as public"
);

const reportSendRoute = source("app/api/reports/[id]/send/route.ts");
assertOrdered(
  reportSendRoute,
  [
    'if (report.status !== "reviewed")',
    "status: 409",
    '.update({ status: "sent"',
    '.eq("status", "reviewed")',
    "sendReportReady",
  ],
  "Report send must reject non-reviewed rows before mutation/delivery and atomically claim reviewed"
);
assertIncludes(
  reportSendRoute,
  'process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false"',
  "Report delivery must remain fail-closed behind EMAIL_DRY_RUN"
);
const reportActions = source("components/console/report-detail-actions.tsx");
assertIncludes(
  reportActions,
  'const isReviewed = status === "reviewed";',
  "Report UI must derive reviewed state"
);
assertMatches(
  reportActions,
  /\{isReviewed\s*&&\s*\([\s\S]*?Send to client[\s\S]*?\)\}/,
  "Send-to-client control must appear only for reviewed reports"
);
assertIncludes(
  reportActions,
  "Marked sent — email suppressed by dry-run gate",
  "Report UI must show the exact dry-run confirmation"
);

const clientFiles = [...filesUnder("app"), ...filesUnder("components")].filter(
  (path) => path.endsWith(".ts") || path.endsWith(".tsx")
);
const clientServerImportViolations = clientFiles.filter((path) => {
  const content = source(path);
  const beginsAsClient = /^\s*["']use client["'];/m.test(content.slice(0, 300));
  return beginsAsClient && content.includes("@/lib/operator/checklist-server");
});
assert.deepEqual(
  clientServerImportViolations,
  [],
  `Client files imported checklist-server: ${clientServerImportViolations.join(", ")}`
);

const checklistServer = source("lib/operator/checklist-server.ts");
assertIncludes(
  checklistServer,
  "await Promise.all([",
  "Checklist server must batch independent context reads"
);
assertMatches(
  checklistServer,
  /evaluateChecklist\(context\)[\s\S]*?filter\(\(itemValue\) => itemValue\.state === "needs_you"\)/,
  "Today must include only client items needing staff action"
);
assertIncludes(
  checklistServer,
  "evaluateSystemGates",
  "Today must append system gates"
);

const sop = source("docs/OPERATOR_SOP.md");
assertIncludes(sop, "## 10. Operator Checklist", "SOP must include the new §10 heading");
assertIncludes(
  sop,
  "The Operator Checklist is the primary operating surface",
  "SOP must establish checklist-first operations"
);
assertIncludes(
  sop,
  "Operator checklist items are DERIVED from live data; stored todo rows drift and are forbidden. Stored state is only acks/snoozes/manual items.",
  "SOP must preserve the derived-work invariant verbatim"
);
assertIncludes(sop, "### Rule-family guide", "SOP must document rule families");
assertOrdered(
  sop,
  [
    "| Monitoring |",
    "| Reporting |",
    "| Evidence |",
    "| Cases |",
    "| Compliance |",
    "| Onboarding |",
    "| Service |",
    "| Gates |",
  ],
  "SOP rule-family guide must cover every family in checklist order"
);
for (const sectionCitation of ["§2", "§8", "§5", "§4", "§7", "§3", "§9"]) {
  assertIncludes(
    sop.slice(sop.indexOf("## 10. Operator Checklist")),
    sectionCitation,
    `SOP §10 must cite existing ${sectionCitation} instructions`
  );
}
assertIncludes(
  sop,
  "Nothing needs you right now — {N} waiting on client, {M} waiting on gates.",
  "SOP must explain the exact checklist empty-state contract"
);

const ruleSource = source("lib/operator/checklist-rules.ts");
for (const exactCopy of [
  "Client email delivery OFF (dry-run)",
  "LexisNexis PAR delivery not configured",
  "Billing in test mode",
  "Monthly reviewed; email delivery gated (dry-run)",
  "Quarterly strategic review with client due",
  "Collect driver roster — the compliance layer is empty",
  "Portal invite not accepted — resend or follow up",
  "Baseline assessment not delivered",
]) {
  assertIncludes(ruleSource, exactCopy, "Fixed derived-rule copy contract");
}
assertIncludes(
  ruleSource,
  "using SOP §2, §4, §5, and §8.",
  "Quarterly-review instructions must cite their existing SOP workbenches"
);
assertIncludes(
  ruleSource,
  "Follow SOP §9 to configure and verify the integration",
  "LexisNexis gate instructions must cite the launch runbook"
);

console.log(
  JSON.stringify(
    {
      passed: true,
      checks: {
        checklistFirstTabAndGroupedUi: true,
        todayFirstAndFailLoud: true,
        monitoringAcknowledgementWiring: true,
        staffOnlyProxyAndRouteAuth: true,
        strictSchemasAndSoftDelete: true,
        reviewedOnlyAtomicReportSend: true,
        noClientServerImport: true,
        sopSection10AndFixedCopy: true,
      },
      scannedClientFiles: clientFiles.length,
      routesChecked: routePaths,
    },
    null,
    2
  )
);
