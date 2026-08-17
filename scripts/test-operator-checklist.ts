import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DQF_CHECKLIST_ITEMS } from "../lib/compliance/health";
import {
  CHECKLIST_RULES,
  currentQuarter,
  evaluateChecklist,
  evaluateSystemGates,
  sortChecklistItems,
} from "../lib/operator/checklist-rules";
import type {
  ChecklistItem,
  OperatorWorkContext,
} from "../lib/operator/checklist-types";

const NOW = "2026-08-17T19:00:00.000Z";
const CLIENT_ID = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

function daysBefore(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

function baseContext(): OperatorWorkContext {
  return {
    now: NOW,
    emailDeliveryDryRun: false,
    client: {
      id: CLIENT_ID,
      name: "Checklist Test Carrier",
      tier: "monitor",
      status: "active",
    },
    snapshots: [
      {
        id: "snapshot-latest",
        capturedAt: daysBefore(1),
        snapshotDate: "2026-08-16",
        source: "scheduled_refresh",
        totalPoints: 550,
      },
      {
        id: "snapshot-previous",
        capturedAt: daysBefore(31),
        snapshotDate: "2026-07-17",
        source: "scheduled_refresh",
        totalPoints: 575,
      },
    ],
    alerts: [],
    reports: [
      {
        id: "monthly-sent",
        type: "monthly",
        status: "sent",
        sentAt: daysBefore(10),
        createdAt: daysBefore(11),
      },
      {
        id: "assessment-sent",
        type: "assessment",
        status: "sent",
        sentAt: daysBefore(20),
        createdAt: daysBefore(21),
      },
    ],
    requests: [],
    cases: [],
    compliance: {
      available: true,
      drivers: [],
      driverDocuments: [],
      vehicles: [],
      clearinghouseRecords: [],
    },
    portalUsers: [
      {
        id: "portal-user",
        lastSignInAt: daysBefore(2),
      },
    ],
    manualItems: [],
    acknowledgements: [
      {
        id: "quarter-done",
        ruleKey: "service.quarterly_review",
        contextKey: "2026-Q3",
        action: "done",
        snoozedUntil: null,
        createdAt: daysBefore(1),
      },
    ],
  };
}

function itemsFor(
  context: OperatorWorkContext,
  ruleKey: string
): ChecklistItem[] {
  return evaluateChecklist(context).filter((entry) => entry.ruleKey === ruleKey);
}

function one(context: OperatorWorkContext, ruleKey: string): ChecklistItem {
  const entries = itemsFor(context, ruleKey);
  assert.equal(entries.length, 1, `${ruleKey} should derive exactly one item`);
  return entries[0]!;
}

const expectedRuleKeys = [
  "monitoring.unread_alerts",
  "reporting.monthly_due",
  "reporting.stacked_drafts",
  "evidence.escalated",
  "evidence.waiting",
  "evidence.submitted",
  "cases.stale_draft",
  "cases.determination_check",
  "compliance.roster_empty",
  "compliance.dqf_gaps",
  "compliance.expirations",
  "compliance.clearinghouse",
  "onboarding.portal_invite",
  "onboarding.baseline_unsent",
  "service.quarterly_review",
] as const;
assert.deepEqual(
  CHECKLIST_RULES.map((rule) => rule.ruleKey),
  expectedRuleKeys
);
assert.deepEqual(evaluateChecklist(baseContext()), []);

// Monitoring: aggregate only unacknowledged alerts and use the oldest date.
{
  const context = baseContext();
  context.alerts = [
    { id: "new", createdAt: daysBefore(1), acknowledgedAt: null },
    { id: "old", createdAt: daysBefore(5), acknowledgedAt: null },
    { id: "acked", createdAt: daysBefore(9), acknowledgedAt: daysBefore(2) },
  ];
  const result = one(context, "monitoring.unread_alerts");
  assert.equal(result.priority, 1);
  assert.equal(result.state, "needs_you");
  assert.equal(result.contextKey, "unacknowledged");
  assert.match(result.why, /^2 unread alerts, oldest Aug 12, 2026$/);
  assert.equal(result.href, `/console/clients/${CLIENT_ID}/monitoring`);
  assert.equal(result.canMarkDone, false);
  assert.equal(result.canSnooze, false);

  context.acknowledgements.push({
    id: "active-snooze",
    ruleKey: result.ruleKey,
    contextKey: result.contextKey,
    action: "snooze",
    snoozedUntil: new Date(Date.parse(NOW) + 1).toISOString(),
    createdAt: NOW,
  });
  assert.equal(itemsFor(context, result.ruleKey).length, 0);
  context.acknowledgements.at(-1)!.snoozedUntil = NOW;
  assert.equal(itemsFor(context, result.ruleKey).length, 1);
}

// Monthly due: 30-day boundary, dry-run exception, and never-sent copy.
{
  const context = baseContext();
  context.reports[0]!.sentAt = daysBefore(30);
  assert.equal(itemsFor(context, "reporting.monthly_due").length, 0);
  context.reports[0]!.sentAt = daysBefore(30.0001);
  const overdue = one(context, "reporting.monthly_due");
  assert.equal(overdue.state, "needs_you");
  assert.match(overdue.why, /^Last monthly sent Jul 18, 2026$/);

  context.reports.push({
    id: "monthly-reviewed",
    type: "monthly",
    status: "reviewed",
    sentAt: null,
    createdAt: daysBefore(1),
  });
  context.emailDeliveryDryRun = true;
  const gated = one(context, "reporting.monthly_due");
  assert.equal(gated.state, "waiting_gate");
  assert.equal(gated.why, "Monthly reviewed; email delivery gated (dry-run)");
  context.emailDeliveryDryRun = false;
  assert.equal(one(context, "reporting.monthly_due").state, "needs_you");

  context.reports = context.reports.filter((report) => report.type !== "monthly");
  assert.equal(one(context, "reporting.monthly_due").why, "Last monthly sent never");
}

// Draft count is complete and includes every report type.
{
  const context = baseContext();
  context.reports.push(
    {
      id: "draft-1",
      type: "quarterly",
      status: "draft",
      sentAt: null,
      createdAt: daysBefore(1),
    },
    {
      id: "draft-2",
      type: "improvement",
      status: "draft",
      sentAt: null,
      createdAt: daysBefore(2),
    }
  );
  const result = one(context, "reporting.stacked_drafts");
  assert.equal(result.priority, 2);
  assert.equal(result.title, "Review or delete 2 draft reports");
  context.reports = context.reports.filter((report) => report.status !== "draft");
  assert.equal(itemsFor(context, "reporting.stacked_drafts").length, 0);
}

// Evidence states are mutually partitioned: submitted work is not waiting/escalated.
{
  const context = baseContext();
  context.requests = [
    {
      id: "escalated",
      status: "open",
      responsibility: "client",
      evidenceStatus: "open",
      escalatedAt: daysBefore(1),
      nextReminderAt: null,
    },
    {
      id: "waiting-later",
      status: "open",
      responsibility: "client",
      evidenceStatus: "insufficient",
      escalatedAt: null,
      nextReminderAt: "2026-08-25T16:00:00.000Z",
    },
    {
      id: "waiting-earlier",
      status: "open",
      responsibility: "client",
      evidenceStatus: null,
      escalatedAt: null,
      nextReminderAt: "2026-08-20T16:00:00.000Z",
    },
    {
      id: "submitted",
      status: "open",
      responsibility: "client",
      evidenceStatus: "submitted",
      escalatedAt: daysBefore(2),
      nextReminderAt: "2026-08-18T16:00:00.000Z",
    },
    {
      id: "closed",
      status: "fulfilled",
      responsibility: "client",
      evidenceStatus: "submitted",
      escalatedAt: daysBefore(2),
      nextReminderAt: null,
    },
    {
      id: "geia-owned",
      status: "open",
      responsibility: "geia",
      evidenceStatus: "submitted",
      escalatedAt: daysBefore(3),
      nextReminderAt: "2026-08-19T16:00:00.000Z",
    },
  ];
  assert.equal(
    one(context, "evidence.escalated").title,
    "1 request unanswered after 3 reminders — call or use an alternate contact"
  );
  const waiting = one(context, "evidence.waiting");
  assert.equal(waiting.state, "waiting_client");
  assert.equal(waiting.href, "");
  assert.equal(
    waiting.title,
    "2 requests with client; reminders automatic, next Aug 20, 2026"
  );
  assert.equal(one(context, "evidence.submitted").title, "Review 1 submitted item");

  context.requests = context.requests.map((request) => ({
    ...request,
    nextReminderAt:
      request.status === "open" && request.evidenceStatus !== "submitted"
        ? null
        : request.nextReminderAt,
  }));
  assert.match(one(context, "evidence.waiting").title, /next not scheduled$/);
}

// Case age is strictly greater than seven days; determination is filed-date based.
{
  const context = baseContext();
  context.cases = [
    {
      id: "dataq-stale",
      kind: "DataQ",
      caseNumber: null,
      status: "draft",
      createdAt: daysBefore(8),
      filedDate: null,
      determinationOutcome: null,
    },
    {
      id: "cpdp-boundary",
      kind: "CPDP",
      caseNumber: null,
      status: "draft",
      createdAt: daysBefore(7),
      filedDate: null,
      determinationOutcome: null,
    },
    {
      id: "filed-case",
      kind: "DataQ",
      caseNumber: "6103911",
      status: "filed",
      createdAt: daysBefore(90),
      filedDate: "2026-05-29",
      determinationOutcome: null,
    },
    {
      id: "determined-case",
      kind: "CPDP",
      caseNumber: "6123719",
      status: "determination_made",
      createdAt: daysBefore(90),
      filedDate: "2026-06-09",
      determinationOutcome: "not_preventable",
    },
    {
      id: "legacy-pending",
      kind: "CPDP",
      caseNumber: "LEGACY-PENDING",
      status: "pending",
      createdAt: daysBefore(90),
      filedDate: "2026-06-01",
      determinationOutcome: null,
    },
    {
      id: "closed-without-new-field",
      kind: "DataQ",
      caseNumber: "CLOSED-OLD",
      status: "closed",
      createdAt: daysBefore(120),
      filedDate: "2026-04-01",
      determinationOutcome: null,
    },
  ];
  const stale = one(context, "cases.stale_draft");
  assert.equal(stale.contextKey, "dataq:dataq-stale");
  assert.equal(stale.title, "Finish or discard draft DataQ case");
  assert.match(stale.href, /\/dataq\?case=dataq-stale$/);

  const determination = one(context, "cases.determination_check");
  assert.equal(
    determination.title,
    "Check DataQs for determination — case 6103911"
  );
  assert.equal(determination.canSnooze, true);
  assert.equal(determination.canMarkDone, false);
  assert.equal(determination.defaultSnoozeDays, 14);

  context.acknowledgements.push({
    id: "case-snooze",
    ruleKey: determination.ruleKey,
    contextKey: determination.contextKey,
    action: "snooze",
    snoozedUntil: "2026-08-31T19:00:00.000Z",
    createdAt: NOW,
  });
  assert.equal(itemsFor(context, "cases.determination_check").length, 0);
}

function totalSafetyContext(): OperatorWorkContext {
  const context = baseContext();
  context.client.tier = "total_safety";
  return context;
}

// Compliance rules fail closed when tables are unavailable and apply only to Total Safety.
{
  const unavailable = totalSafetyContext();
  unavailable.compliance.available = false;
  assert.ok(
    evaluateChecklist(unavailable).every(
      (entry) => entry.family !== "compliance"
    )
  );
  const nonTotal = baseContext();
  assert.ok(
    evaluateChecklist(nonTotal).every((entry) => entry.family !== "compliance")
  );

  const empty = totalSafetyContext();
  assert.equal(
    one(empty, "compliance.roster_empty").title,
    "Collect driver roster — the compliance layer is empty"
  );
  empty.compliance.drivers.push({
    id: "terminated-driver",
    full_name: "Former Driver",
    status: "terminated",
    cdl_expiry: null,
    medical_cert_expiry: null,
  });
  assert.equal(itemsFor(empty, "compliance.roster_empty").length, 0);
}

// DQF counts drivers (not missing documents) and clears with all seven required rows.
{
  const context = totalSafetyContext();
  context.compliance.drivers = [
    {
      id: "driver-1",
      full_name: "Test Driver",
      status: "active",
      cdl_expiry: "2027-12-31",
      medical_cert_expiry: "2027-12-31",
    },
  ];
  assert.equal(
    one(context, "compliance.dqf_gaps").title,
    "1 driver missing DQF items"
  );
  context.compliance.driverDocuments = DQF_CHECKLIST_ITEMS.map(
    (definition, index) => ({
      id: `doc-${index}`,
      driver_id: "driver-1",
      doc_type: definition.docType,
      status: "current",
      completed_date: definition.annual ? "2026-08-01" : null,
      expiry_date: definition.annual ? "2027-08-01" : null,
      document_id: `document-${index}`,
    })
  );
  assert.equal(itemsFor(context, "compliance.dqf_gaps").length, 0);
}

// Expiration window is inclusive at 60/today and excludes >60-day and expired dates.
{
  const context = totalSafetyContext();
  context.compliance.drivers = [
    {
      id: "driver-1",
      full_name: "Near Driver",
      status: "active",
      cdl_expiry: "2026-10-16",
      medical_cert_expiry: "2026-10-17",
    },
    {
      id: "driver-2",
      full_name: "Today Driver",
      status: "active",
      cdl_expiry: "2026-08-17",
      medical_cert_expiry: "2026-08-16",
    },
  ];
  const expiration = one(context, "compliance.expirations");
  assert.match(expiration.title, /^2 expirations within 60 days/);
  assert.match(expiration.title, /CDL — Today Driver Aug 17, 2026/);
}

// Clearinghouse is per active driver; an anniversary-date query is due today.
{
  const context = totalSafetyContext();
  context.compliance.drivers = [
    {
      id: "driver-1",
      full_name: "Recent Driver",
      status: "active",
      cdl_expiry: null,
      medical_cert_expiry: null,
    },
    {
      id: "driver-2",
      full_name: "Due Driver",
      status: "active",
      cdl_expiry: null,
      medical_cert_expiry: null,
    },
    {
      id: "driver-3",
      full_name: "Inactive Driver",
      status: "terminated",
      cdl_expiry: null,
      medical_cert_expiry: null,
    },
  ];
  context.compliance.clearinghouseRecords = [
    {
      id: "query-recent",
      driver_id: "driver-1",
      query_date: "2026-08-01",
    },
    {
      id: "query-anniversary",
      driver_id: "driver-2",
      query_date: "2025-08-17",
    },
  ];
  const result = one(context, "compliance.clearinghouse");
  assert.equal(result.title, "Clearinghouse queries due");
  assert.match(result.why, /^1 of 2 active drivers/);
  context.compliance.clearinghouseRecords[1]!.query_date = "2025-08-18";
  assert.equal(itemsFor(context, "compliance.clearinghouse").length, 0);
}

// Portal acceptance and baseline delivery use actual sign-in/report states.
{
  const context = baseContext();
  context.portalUsers = [];
  assert.match(one(context, "onboarding.portal_invite").why, /No portal user/);
  context.portalUsers = [{ id: "never", lastSignInAt: null }];
  assert.match(one(context, "onboarding.portal_invite").why, /never signed in/);
  context.portalUsers.push({ id: "accepted", lastSignInAt: daysBefore(1) });
  assert.equal(itemsFor(context, "onboarding.portal_invite").length, 0);

  context.reports = context.reports.filter(
    (report) => report.type !== "assessment"
  );
  assert.equal(
    one(context, "onboarding.baseline_unsent").title,
    "Baseline assessment not delivered"
  );
  context.reports.push({
    id: "assessment-reviewed",
    type: "assessment",
    status: "reviewed",
    sentAt: null,
    createdAt: daysBefore(1),
  });
  assert.equal(itemsFor(context, "onboarding.baseline_unsent").length, 1);
  context.reports.at(-1)!.status = "sent";
  assert.equal(itemsFor(context, "onboarding.baseline_unsent").length, 0);
}

// Quarterly context changes revive the item; done applies only to the exact quarter.
{
  const context = baseContext();
  context.acknowledgements = [];
  const itemValue = one(context, "service.quarterly_review");
  assert.equal(currentQuarter(context.now), "2026-Q3");
  assert.equal(itemValue.contextKey, "2026-Q3");
  assert.equal(itemValue.canMarkDone, true);
  context.acknowledgements.push({
    id: "prior-quarter",
    ruleKey: itemValue.ruleKey,
    contextKey: "2026-Q2",
    action: "done",
    snoozedUntil: null,
    createdAt: NOW,
  });
  assert.equal(itemsFor(context, itemValue.ruleKey).length, 1);
  context.acknowledgements.push({
    id: "current-quarter",
    ruleKey: itemValue.ruleKey,
    contextKey: "2026-Q3",
    action: "done",
    snoozedUntil: null,
    createdAt: NOW,
  });
  assert.equal(itemsFor(context, itemValue.ruleKey).length, 0);
  context.now = "2026-10-01T08:00:00.000Z";
  assert.equal(one(context, itemValue.ruleKey).contextKey, "2026-Q4");
}

// System gates expose sanitized environment state only.
{
  const gates = evaluateSystemGates({
    emailDeliveryDryRun: true,
    lexisNexisWebhookConfigured: false,
    stripeSecretKeyMode: "test",
  });
  assert.deepEqual(
    gates.map((entry) => entry.title),
    [
      "Billing in test mode",
      "Client email delivery OFF (dry-run)",
      "LexisNexis PAR delivery not configured",
    ]
  );
  assert.ok(
    gates.every(
      (entry) =>
        entry.family === "gates" &&
        entry.state === "waiting_gate" &&
        entry.href === "/console"
    )
  );
  assert.deepEqual(
    evaluateSystemGates({
      emailDeliveryDryRun: false,
      lexisNexisWebhookConfigured: true,
      stripeSecretKeyMode: "live",
    }),
    []
  );
  assert.equal(
    evaluateSystemGates({
      emailDeliveryDryRun: false,
      lexisNexisWebhookConfigured: true,
      stripeSecretKeyMode: "unset",
    }).length,
    0
  );
}

// Stable ordering is state, then numeric priority, then title, then id.
{
  const minimal = (
    id: string,
    state: ChecklistItem["state"],
    priority: ChecklistItem["priority"],
    title: string
  ): ChecklistItem => ({
    id,
    ruleKey: id,
    contextKey: id,
    family: "service",
    state,
    priority,
    title,
    why: "test",
    instructions: ["test"],
    href: "/console",
    canMarkDone: false,
    canSnooze: false,
  });
  const sorted = sortChecklistItems([
    minimal("gate", "waiting_gate", 1, "A"),
    minimal("client", "waiting_client", 1, "A"),
    minimal("needs-p2", "needs_you", 2, "A"),
    minimal("needs-z", "needs_you", 1, "Z"),
    minimal("needs-a-2", "needs_you", 1, "A"),
    minimal("needs-a-1", "needs_you", 1, "A"),
  ]);
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["needs-a-1", "needs-a-2", "needs-z", "needs-p2", "client", "gate"]
  );
}

assert.throws(
  () => evaluateChecklist({ ...baseContext(), now: "not-a-date" }),
  /Invalid checklist now timestamp/
);

const ruleSource = readFileSync(
  resolve(process.cwd(), "lib/operator/checklist-rules.ts"),
  "utf8"
);
assert.doesNotMatch(ruleSource, /createClient|createServiceClient|process\.env|\.from\(|\bfetch\(/);

console.log(
  JSON.stringify(
    {
      passed: true,
      rulesCovered: expectedRuleKeys.length,
      systemGatesCovered: 3,
      activeSnoozeSuppression: true,
      exactDoneContextSuppression: true,
      sortOrder: ["state", "priority", "title", "id"],
      pureRulesNoIo: true,
      dqfRequiredItems: DQF_CHECKLIST_ITEMS.length,
    },
    null,
    2
  )
);
