import {
  buildComplianceHealth,
  deriveAnnualDueDate,
} from "@/lib/compliance/health";
import type {
  ChecklistAckContext,
  ChecklistCaseContext,
  ChecklistItem,
  ChecklistItemState,
  OperatorWorkContext,
  SystemGateContext,
} from "@/lib/operator/checklist-types";

const DAY_MS = 86_400_000;
const STATE_ORDER: Record<ChecklistItemState, number> = {
  needs_you: 0,
  waiting_client: 1,
  waiting_gate: 2,
};

export type ChecklistRule = {
  ruleKey: string;
  evaluate: (context: OperatorWorkContext) => ChecklistItem[];
};

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label} timestamp: ${value}`);
  }
  return parsed;
}

function dateOnlyForNow(now: string): string {
  const date = new Date(timestamp(now, "checklist now"));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function formatDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3])
        )
      )
    : new Date(timestamp(value, "checklist fact"));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: dateOnly ? "UTC" : "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return count === 1 ? singular : pluralValue;
}

function clientHref(context: OperatorWorkContext, suffix = "") {
  return `/console/clients/${context.client.id}${suffix}`;
}

function item(params: Omit<ChecklistItem, "id">): ChecklistItem {
  return {
    ...params,
    id: `${params.ruleKey}:${params.contextKey}`,
  };
}

function currentQuarter(now: string): string {
  const date = new Date(timestamp(now, "checklist now"));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Unable to derive a checklist quarter from ${now}`);
  }
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function caseContextKey(reportCase: ChecklistCaseContext) {
  return `${reportCase.kind.toLowerCase()}:${reportCase.id}`;
}

function caseLabel(reportCase: ChecklistCaseContext) {
  return reportCase.caseNumber?.trim() || reportCase.id.slice(0, 8);
}

function caseHref(
  context: OperatorWorkContext,
  reportCase: ChecklistCaseContext
) {
  return reportCase.kind === "CPDP"
    ? clientHref(context, `/cpdp/${encodeURIComponent(reportCase.id)}`)
    : clientHref(
        context,
        `/dataq?case=${encodeURIComponent(reportCase.id)}`
      );
}

function hasSuppressingAck(
  itemValue: ChecklistItem,
  acknowledgements: ChecklistAckContext[],
  nowTime: number
) {
  return acknowledgements.some((ack) => {
    if (
      ack.ruleKey !== itemValue.ruleKey ||
      ack.contextKey !== itemValue.contextKey
    ) {
      return false;
    }
    if (ack.action === "done") return true;
    return (
      ack.action === "snooze" &&
      ack.snoozedUntil !== null &&
      timestamp(ack.snoozedUntil, "snooze") > nowTime
    );
  });
}

const monitoringUnreadAlerts: ChecklistRule = {
  ruleKey: "monitoring.unread_alerts",
  evaluate(context) {
    const alerts = context.alerts
      .filter((alert) => alert.acknowledgedAt === null)
      .sort(
        (left, right) =>
          timestamp(left.createdAt, "alert created_at") -
            timestamp(right.createdAt, "alert created_at") ||
          left.id.localeCompare(right.id)
      );
    if (alerts.length === 0) return [];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "unacknowledged",
        family: "monitoring",
        state: "needs_you",
        priority: 1,
        title: "Review unread monitoring alerts",
        why: `${alerts.length} unread ${plural(alerts.length, "alert")}, oldest ${formatDate(alerts[0]!.createdAt)}`,
        instructions: [
          "Open Monitoring and read each unacknowledged alert.",
          "Compare each alert with the latest snapshot using the SOP §2 burden-change sequence.",
          "Acknowledge each alert after its facts and next action are understood.",
        ],
        href: clientHref(context, "/monitoring"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const reportingMonthlyDue: ChecklistRule = {
  ruleKey: "reporting.monthly_due",
  evaluate(context) {
    const nowTime = timestamp(context.now, "checklist now");
    const sent = context.reports
      .filter(
        (report) =>
          report.type === "monthly" &&
          report.status === "sent" &&
          report.sentAt !== null
      )
      .map((report) => ({
        ...report,
        sentTime: timestamp(report.sentAt!, "monthly sent_at"),
      }))
      .sort(
        (left, right) =>
          right.sentTime - left.sentTime || left.id.localeCompare(right.id)
      );
    const lastSent = sent[0] ?? null;
    if (
      lastSent &&
      lastSent.sentTime <= nowTime &&
      lastSent.sentTime >= nowTime - 30 * DAY_MS
    ) {
      return [];
    }
    const reviewedUnsent = context.reports.some(
      (report) =>
        report.type === "monthly" &&
        report.status === "reviewed" &&
        report.sentAt === null
    );
    const waitingOnDryRun =
      reviewedUnsent && context.emailDeliveryDryRun;
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "monthly-delivery",
        family: "reporting",
        state: waitingOnDryRun ? "waiting_gate" : "needs_you",
        priority: 1,
        title: "Monthly report due",
        why: waitingOnDryRun
          ? "Monthly reviewed; email delivery gated (dry-run)"
          : `Last monthly sent ${lastSent ? formatDate(lastSent.sentAt!) : "never"}`,
        instructions: [
          "Generate the Monthly progress report from the Reports tab.",
          "Review the full report using the SOP §8 review ritual.",
          "Mark the approved final copy reviewed.",
          "Send the reviewed report to the client.",
        ],
        href: clientHref(context, "/reports"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const reportingStackedDrafts: ChecklistRule = {
  ruleKey: "reporting.stacked_drafts",
  evaluate(context) {
    const count = context.reports.filter(
      (report) => report.status === "draft"
    ).length;
    if (count === 0) return [];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "drafts",
        family: "reporting",
        state: "needs_you",
        priority: 2,
        title: `Review or delete ${count} draft ${plural(count, "report")}`,
        why: `${count} draft ${plural(count, "report", "reports")} remain in Report history.`,
        instructions: [
          "Open Report history and review drafts oldest first.",
          "Follow the SOP §8 stacked-drafts protocol to choose the canonical report.",
          "Delete only a draft the operator has confirmed is obsolete or superseded.",
        ],
        href: clientHref(context, "/reports"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

function requestsAwaitingClient(context: OperatorWorkContext) {
  return context.requests.filter(
    (request) =>
      request.responsibility === "client" &&
      request.status === "open" &&
      request.evidenceStatus !== "submitted"
  );
}

const evidenceEscalated: ChecklistRule = {
  ruleKey: "evidence.escalated",
  evaluate(context) {
    const count = requestsAwaitingClient(context).filter(
      (request) => request.escalatedAt !== null
    ).length;
    if (count === 0) return [];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "escalated",
        family: "evidence",
        state: "needs_you",
        priority: 1,
        title: `${count} ${plural(count, "request")} unanswered after 3 reminders — call or use an alternate contact`,
        why: `${count} open ${plural(count, "request")} reached the automatic escalation threshold.`,
        instructions: [
          "Open Requests and confirm the requested evidence and reminder history.",
          "Follow the SOP §5 escalation step by calling or using an approved alternate contact.",
          "Record the contact result without closing a request until its underlying condition clears.",
        ],
        href: clientHref(context, "/requests"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const evidenceWaiting: ChecklistRule = {
  ruleKey: "evidence.waiting",
  evaluate(context) {
    const requests = requestsAwaitingClient(context).filter(
      (request) => request.escalatedAt === null
    );
    if (requests.length === 0) return [];
    const reminderDates = requests
      .map((request) => request.nextReminderAt)
      .filter((value): value is string => value !== null)
      .sort(
        (left, right) =>
          timestamp(left, "request next_reminder_at") -
          timestamp(right, "request next_reminder_at")
      );
    const next = reminderDates[0];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "with-client",
        family: "evidence",
        state: "waiting_client",
        priority: 3,
        title: `${requests.length} ${plural(requests.length, "request")} with client; reminders automatic, next ${next ? formatDate(next) : "not scheduled"}`,
        why: "SafeScore is waiting for the carrier to answer or upload the requested evidence.",
        instructions: [
          "Let the automatic SOP §5 reminder cadence run.",
          "Review this queue only if the carrier responds or a request escalates.",
        ],
        href: "",
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const evidenceSubmitted: ChecklistRule = {
  ruleKey: "evidence.submitted",
  evaluate(context) {
    const count = context.requests.filter(
      (request) =>
        request.responsibility === "client" &&
        request.status === "open" &&
        request.evidenceStatus === "submitted"
    ).length;
    if (count === 0) return [];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "submitted",
        family: "evidence",
        state: "needs_you",
        priority: 1,
        title: `Review ${count} submitted ${plural(count, "item")}`,
        why: `${count} client ${plural(count, "submission")} await evidence review.`,
        instructions: [
          "Open Requests and inspect each submitted document or answer.",
          "Apply the SOP §5 evidence review and challengeability reassessment sequence.",
          "Record whether the evidence was applied or was insufficient.",
        ],
        href: clientHref(context, "/requests"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const casesStaleDraft: ChecklistRule = {
  ruleKey: "cases.stale_draft",
  evaluate(context) {
    const nowTime = timestamp(context.now, "checklist now");
    return context.cases
      .filter(
        (reportCase) =>
          reportCase.status === "draft" &&
          nowTime - timestamp(reportCase.createdAt, "case created_at") >
            7 * DAY_MS
      )
      .map((reportCase) =>
        item({
          ruleKey: this.ruleKey,
          contextKey: caseContextKey(reportCase),
          family: "cases",
          state: "needs_you",
          priority: 2,
          title: `Finish or discard draft ${reportCase.kind} case`,
          why: `Draft case ${caseLabel(reportCase)} was created ${formatDate(reportCase.createdAt)} and is more than 7 days old.`,
          instructions: [
            `Open the ${reportCase.kind} case and verify its evidence and filing basis.`,
            `Follow ${reportCase.kind === "CPDP" ? "SOP §4" : "SOP §5"} before filing or discarding the draft.`,
            "Do not file until the documented human-review gates are satisfied.",
          ],
          href: caseHref(context, reportCase),
          canMarkDone: false,
          canSnooze: false,
        })
      );
  },
};

const casesDeterminationCheck: ChecklistRule = {
  ruleKey: "cases.determination_check",
  evaluate(context) {
    return context.cases
      .filter(
        (reportCase) =>
          reportCase.status === "filed" &&
          reportCase.filedDate !== null &&
          reportCase.determinationOutcome === null
      )
      .map((reportCase) =>
        item({
          ruleKey: this.ruleKey,
          contextKey: caseContextKey(reportCase),
          family: "cases",
          state: "needs_you",
          priority: 2,
          title: `Check DataQs for determination — case ${caseLabel(reportCase)}`,
          why: `${reportCase.kind} case ${caseLabel(reportCase)} was filed ${formatDate(reportCase.filedDate!)} and has no recorded determination.`,
          instructions: [
            "Open the FMCSA DataQs system and check the filed case.",
            `Record the determination on the ${reportCase.kind} case when received.`,
            "Follow SOP §4 for CPDP handling or SOP §5 for DataQ handling.",
          ],
          href: caseHref(context, reportCase),
          canMarkDone: false,
          canSnooze: true,
          defaultSnoozeDays: 14,
        })
      );
  },
};

function complianceHealth(context: OperatorWorkContext) {
  if (!context.compliance.available) return null;
  return buildComplianceHealth({
    asOfDate: dateOnlyForNow(context.now),
    drivers: context.compliance.drivers,
    driverDocuments: context.compliance.driverDocuments,
    vehicles: context.compliance.vehicles,
    clearinghouseRecords: context.compliance.clearinghouseRecords,
  });
}

const complianceRosterEmpty: ChecklistRule = {
  ruleKey: "compliance.roster_empty",
  evaluate(context) {
    if (
      !context.compliance.available ||
      context.client.tier !== "total_safety" ||
      // The server supplies the full roster. Terminated rows still mean a
      // roster exists; only a genuinely empty drivers table triggers intake.
      context.compliance.drivers.length > 0
    ) {
      return [];
    }
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "driver-roster",
        family: "compliance",
        state: "needs_you",
        priority: 1,
        title: "Collect driver roster — the compliance layer is empty",
        why: "This Total Safety client has zero driver records.",
        instructions: [
          "Collect the active driver roster and DQF source documents.",
          "Follow SOP §7 to enter drivers without changing the service-plan billing count.",
          "Verify each roster entry before adding qualification-file records.",
        ],
        href: clientHref(context, "/compliance"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const complianceDqfGaps: ChecklistRule = {
  ruleKey: "compliance.dqf_gaps",
  evaluate(context) {
    if (
      !context.compliance.available ||
      context.client.tier !== "total_safety"
    ) {
      return [];
    }
    const health = complianceHealth(context)!;
    const count = health.drivers.items.filter((driver) =>
      driver.dqfItems.some((document) => document.status === "missing")
    ).length;
    if (count === 0) return [];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "dqf-gaps",
        family: "compliance",
        state: "needs_you",
        priority: 2,
        title: `${count} ${plural(count, "driver")} missing DQF items`,
        why: `${count} active ${plural(count, "driver")} lack at least one required §391 qualification-file item.`,
        instructions: [
          "Open Drivers & qualification files and inspect each missing checklist item.",
          "Follow SOP §7 to request or record the missing document.",
          "Link the verified document to the correct driver and checklist category.",
        ],
        href: clientHref(context, "/compliance"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const complianceExpirations: ChecklistRule = {
  ruleKey: "compliance.expirations",
  evaluate(context) {
    if (
      !context.compliance.available ||
      context.client.tier !== "total_safety"
    ) {
      return [];
    }
    const expirations = complianceHealth(context)!.upcoming.filter(
      (expiration) =>
        expiration.daysRemaining >= 0 && expiration.daysRemaining <= 60
    );
    if (expirations.length === 0) return [];
    const nearest = expirations[0]!;
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "within-60-days",
        family: "compliance",
        state: "needs_you",
        priority: 2,
        title: `${expirations.length} ${plural(expirations.length, "expiration")} within 60 days (nearest: ${nearest.title} ${formatDate(nearest.dueDate)})`,
        why: `${expirations.length} compliance ${plural(expirations.length, "item is", "items are")} due within 60 days.`,
        instructions: [
          "Open Compliance and review the nearest expiration first.",
          "Follow SOP §7 to collect client-supplied renewals and record GEIA-managed checks.",
          "Confirm the new document or date is attached to the correct driver or vehicle.",
        ],
        href: clientHref(context, "/compliance"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const complianceClearinghouse: ChecklistRule = {
  ruleKey: "compliance.clearinghouse",
  evaluate(context) {
    if (
      !context.compliance.available ||
      context.client.tier !== "total_safety"
    ) {
      return [];
    }
    const activeDrivers = context.compliance.drivers.filter(
      (driver) => driver.status === "active"
    );
    if (activeDrivers.length === 0) return [];
    const asOfDate = dateOnlyForNow(context.now);
    const latestByDriver = new Map<string, string>();
    for (const record of context.compliance.clearinghouseRecords) {
      if (!record.driver_id) continue;
      const current = latestByDriver.get(record.driver_id);
      if (!current || record.query_date > current) {
        latestByDriver.set(record.driver_id, record.query_date);
      }
    }
    const dueCount = activeDrivers.filter((driver) => {
      const latest = latestByDriver.get(driver.id);
      if (!latest) return true;
      return deriveAnnualDueDate(latest)! <= asOfDate;
    }).length;
    if (dueCount === 0) return [];
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "annual-queries",
        family: "compliance",
        state: "needs_you",
        priority: 3,
        title: "Clearinghouse queries due",
        why: `${dueCount} of ${activeDrivers.length} active ${plural(activeDrivers.length, "driver")} have no Clearinghouse query recorded in the last 12 months.`,
        instructions: [
          "Open Clearinghouse and identify every driver whose annual query is due.",
          "Perform the query outside SafeScore under the approved process.",
          "Record the completed query in SafeScore following SOP §7.",
        ],
        href: clientHref(context, "/compliance"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const onboardingPortalInvite: ChecklistRule = {
  ruleKey: "onboarding.portal_invite",
  evaluate(context) {
    if (
      context.portalUsers.some((portalUser) => portalUser.lastSignInAt !== null)
    ) {
      return [];
    }
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "portal-access",
        family: "onboarding",
        state: "needs_you",
        priority: 2,
        title: "Portal invite not accepted — resend or follow up",
        why:
          context.portalUsers.length === 0
            ? "No portal user is linked to this client."
            : "The linked portal user has never signed in.",
        instructions: [
          "Open Account and verify the intended portal-user email.",
          "Follow SOP §3B to create or resend access and use the returned setup result honestly.",
          "Follow up through an approved contact channel if the invite remains unused.",
        ],
        href: clientHref(context, "/account"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const onboardingBaselineUnsent: ChecklistRule = {
  ruleKey: "onboarding.baseline_unsent",
  evaluate(context) {
    if (
      context.reports.some(
        (report) => report.type === "assessment" && report.status === "sent"
      )
    ) {
      return [];
    }
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: "assessment-delivery",
        family: "onboarding",
        state: "needs_you",
        priority: 2,
        title: "Baseline assessment not delivered",
        why: "No assessment report has ever reached sent status.",
        instructions: [
          "Generate or open the Initial assessment report.",
          "Complete the SOP §8 review ritual and mark the approved copy reviewed.",
          "Send the reviewed assessment to the client when delivery is enabled.",
        ],
        href: clientHref(context, "/reports"),
        canMarkDone: false,
        canSnooze: false,
      }),
    ];
  },
};

const serviceQuarterlyReview: ChecklistRule = {
  ruleKey: "service.quarterly_review",
  evaluate(context) {
    const quarter = currentQuarter(context.now);
    return [
      item({
        ruleKey: this.ruleKey,
        contextKey: quarter,
        family: "service",
        state: "needs_you",
        priority: 3,
        title: "Quarterly strategic review with client due",
        why: `No completed strategic-review acknowledgment is recorded for ${quarter}.`,
        instructions: [
          "Review the current burden trend, open cases, requests, and service outcomes using SOP §2, §4, §5, and §8.",
          "Conduct the strategic review with the client using those workbench facts.",
          "Mark this checklist item done after the review is completed.",
        ],
        href: clientHref(context),
        canMarkDone: true,
        canSnooze: false,
      }),
    ];
  },
};

export const CHECKLIST_RULES: readonly ChecklistRule[] = [
  monitoringUnreadAlerts,
  reportingMonthlyDue,
  reportingStackedDrafts,
  evidenceEscalated,
  evidenceWaiting,
  evidenceSubmitted,
  casesStaleDraft,
  casesDeterminationCheck,
  complianceRosterEmpty,
  complianceDqfGaps,
  complianceExpirations,
  complianceClearinghouse,
  onboardingPortalInvite,
  onboardingBaselineUnsent,
  serviceQuarterlyReview,
];

export function sortChecklistItems(items: ChecklistItem[]): ChecklistItem[] {
  return [...items].sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
      left.priority - right.priority ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  );
}

export function evaluateChecklist(context: OperatorWorkContext): ChecklistItem[] {
  const nowTime = timestamp(context.now, "checklist now");
  const derived = CHECKLIST_RULES.flatMap((rule) => rule.evaluate(context));
  const ids = new Set<string>();
  for (const itemValue of derived) {
    if (ids.has(itemValue.id)) {
      throw new Error(`Checklist rules produced duplicate item id ${itemValue.id}`);
    }
    ids.add(itemValue.id);
  }
  return sortChecklistItems(
    derived.filter(
      (itemValue) =>
        !hasSuppressingAck(itemValue, context.acknowledgements, nowTime)
    )
  );
}

type SystemGateRule = {
  ruleKey: string;
  active: (context: SystemGateContext) => boolean;
  title: string;
  why: string;
  instructions: string[];
};

export const SYSTEM_GATE_RULES: readonly SystemGateRule[] = [
  {
    ruleKey: "gates.email_dry_run",
    active: (context) => context.emailDeliveryDryRun,
    title: "Client email delivery OFF (dry-run)",
    why: "EMAIL_DRY_RUN is not false, so client email delivery is suppressed.",
    instructions: [
      "Complete the SOP §9 email-production approval checks.",
      "Have an authorized operator set and verify the production delivery gate.",
    ],
  },
  {
    ruleKey: "gates.lexisnexis",
    active: (context) => !context.lexisNexisWebhookConfigured,
    title: "LexisNexis PAR delivery not configured",
    why: "LEXISNEXIS_WEBHOOK_SECRET is unset.",
    instructions: [
      "Obtain the approved LexisNexis webhook secret through the secure handoff process.",
      "Follow SOP §9 to configure and verify the integration without exposing the secret.",
    ],
  },
  {
    ruleKey: "gates.stripe_test_mode",
    active: (context) => context.stripeSecretKeyMode === "test",
    title: "Billing in test mode",
    why: "The configured Stripe secret key is a test-mode key.",
    instructions: [
      "Complete the SOP §9 billing-production approval checks.",
      "Have an authorized operator configure and verify the live Stripe key.",
    ],
  },
];

export function evaluateSystemGates(context: SystemGateContext): ChecklistItem[] {
  return sortChecklistItems(
    SYSTEM_GATE_RULES.filter((rule) => rule.active(context)).map((rule) =>
      item({
        ruleKey: rule.ruleKey,
        contextKey: "system",
        family: "gates",
        state: "waiting_gate",
        priority: 1,
        title: rule.title,
        why: rule.why,
        instructions: rule.instructions,
        href: "/console",
        canMarkDone: false,
        canSnooze: false,
      })
    )
  );
}

export { currentQuarter };
