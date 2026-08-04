import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLIENT_REQUEST_REMINDER_INTERVAL_DAYS,
  MAX_CLIENT_REQUEST_REMINDERS,
  processDueClientRequestReminders,
  type ClientReminderRecipient,
  type ClientRequestReminderRepository,
  type DueClientRequest,
  type ReminderActivity,
  type ReminderClaim,
  type ReminderDeliveryResult,
} from "../lib/request-queue/reminder-processor";

type MutableRequest = Omit<DueClientRequest, "nextReminderAt"> & {
  nextReminderAt: string | null;
  lastRemindedAt: string | null;
  escalatedAt: string | null;
};

class MemoryRepository implements ClientRequestReminderRepository {
  readonly requests: MutableRequest[];
  readonly activities: Array<ReminderActivity & { id: string }> = [];

  constructor(
    requests: Array<
      Omit<MutableRequest, "lastRemindedAt" | "escalatedAt"> &
        Partial<Pick<MutableRequest, "lastRemindedAt" | "escalatedAt">>
    >,
    private readonly recipients: Record<
      string,
      ClientReminderRecipient | null
    >
  ) {
    this.requests = requests.map((request) => ({
      ...request,
      lastRemindedAt: request.lastRemindedAt ?? null,
      escalatedAt: request.escalatedAt ?? null,
    }));
  }

  async listDue(nowIso: string) {
    return this.requests
      .filter(
        (request) =>
          request.nextReminderAt !== null && request.nextReminderAt <= nowIso
      )
      .map((request) => ({
        ...request,
        nextReminderAt: request.nextReminderAt as string,
      }));
  }

  async recipientFor(clientId: string) {
    return this.recipients[clientId] ?? null;
  }

  async claim(claim: ReminderClaim) {
    const request = this.requests.find((row) => row.id === claim.requestId);
    if (
      !request ||
      request.reminderCount !== claim.expectedReminderCount ||
      request.nextReminderAt === null ||
      request.nextReminderAt > claim.dueThrough
    ) {
      return false;
    }
    request.reminderCount = claim.reminderNumber;
    request.lastRemindedAt = claim.nowIso;
    request.nextReminderAt = claim.nextReminderAt;
    request.escalatedAt = claim.escalatedAt;
    return true;
  }

  async stopExhausted(input: {
    requestId: string;
    expectedReminderCount: number;
    dueThrough: string;
    nowIso: string;
  }) {
    const request = this.requests.find((row) => row.id === input.requestId);
    if (
      !request ||
      request.reminderCount !== input.expectedReminderCount ||
      request.nextReminderAt === null ||
      request.nextReminderAt > input.dueThrough
    ) {
      return false;
    }
    request.nextReminderAt = null;
    request.escalatedAt = input.nowIso;
    return true;
  }

  async logActivity(activity: ReminderActivity) {
    const id = `activity-${this.activities.length + 1}`;
    this.activities.push({ ...activity, id });
    return id;
  }
}

const now = new Date("2026-08-04T13:00:00.000Z");
const dueAt = "2026-08-04T12:59:00.000Z";
const portalUrl =
  "https://safescore.vercel.app/portal/documents#needed-from-you";

function request(
  id: string,
  overrides: Partial<MutableRequest> = {}
): MutableRequest {
  return {
    id,
    clientId: `client-${id}`,
    companyName: `ZZ ${id}`,
    title: `Updated document ${id}`,
    reminderCount: 0,
    reminderLimit: 3,
    nextReminderAt: dueAt,
    lastRemindedAt: null,
    escalatedAt: null,
    ...overrides,
  };
}

function dryRunSender(calls: Array<Record<string, unknown>>) {
  return async (input: Record<string, unknown>): Promise<ReminderDeliveryResult> => {
    calls.push(input);
    return { success: true, dryRun: true };
  };
}

async function main() {
assert.equal(MAX_CLIENT_REQUEST_REMINDERS, 3);
assert.equal(CLIENT_REQUEST_REMINDER_INTERVAL_DAYS, 7);

const normalCalls: Array<Record<string, unknown>> = [];
const normal = new MemoryRepository([request("normal")], {
  "client-normal": { email: "zz-normal@example.com" },
});
const firstRun = await processDueClientRequestReminders(normal, {
  now,
  source: "monitoring_cron",
  portalUrl,
  sendReminder: dryRunSender(normalCalls),
});
assert.deepEqual(
  {
    due: firstRun.due,
    processed: firstRun.processed,
    dryRun: firstRun.dryRun,
    sent: firstRun.sent,
    failed: firstRun.failed,
    skipped: firstRun.skipped,
  },
  { due: 1, processed: 1, dryRun: 1, sent: 0, failed: 0, skipped: 0 }
);
assert.equal(normal.requests[0]?.reminderCount, 1);
assert.equal(normal.requests[0]?.lastRemindedAt, now.toISOString());
assert.equal(
  normal.requests[0]?.nextReminderAt,
  "2026-08-11T13:00:00.000Z",
  "the next reminder must be exactly seven days after processing"
);
assert.equal(normal.activities[0]?.idempotencyKey, "normal:reminder:1");
assert.equal(normal.activities[0]?.deliveryStatus, "dry_run");
assert.equal(normal.activities[0]?.source, "monitoring_cron");

const replay = await processDueClientRequestReminders(normal, {
  now,
  source: "monitoring_cron",
  portalUrl,
  sendReminder: dryRunSender(normalCalls),
});
assert.equal(replay.processed, 0);
assert.equal(normalCalls.length, 1, "a replay must not emit reminder 1 twice");
assert.equal(normal.activities.length, 1);

const concurrentCalls: Array<Record<string, unknown>> = [];
const concurrent = new MemoryRepository([request("concurrent")], {
  "client-concurrent": { email: "zz-concurrent@example.com" },
});
const concurrentRuns = await Promise.all([
  processDueClientRequestReminders(concurrent, {
    now,
    source: "monitoring_cron",
    portalUrl,
    sendReminder: dryRunSender(concurrentCalls),
  }),
  processDueClientRequestReminders(concurrent, {
    now,
    source: "monitoring_cron",
    portalUrl,
    sendReminder: dryRunSender(concurrentCalls),
  }),
]);
assert.equal(
  concurrentRuns.reduce((sum, run) => sum + run.processed, 0),
  1,
  "the compare-and-update claim must allow one concurrent worker"
);
assert.equal(concurrentCalls.length, 1);
assert.equal(concurrent.activities.length, 1);

const thirdCalls: Array<Record<string, unknown>> = [];
const third = new MemoryRepository(
  [request("third", { reminderCount: 2, reminderLimit: 9 })],
  { "client-third": { email: "zz-third@example.com" } }
);
const thirdRun = await processDueClientRequestReminders(third, {
  now,
  source: "monitoring_cron",
  portalUrl,
  sendReminder: dryRunSender(thirdCalls),
});
assert.equal(thirdRun.processed, 1);
assert.equal(third.requests[0]?.reminderCount, 3);
assert.equal(third.requests[0]?.nextReminderAt, null);
assert.equal(third.requests[0]?.escalatedAt, now.toISOString());
assert.equal(thirdCalls[0]?.reminderNumber, 3);

const staleCalls: Array<Record<string, unknown>> = [];
const staleExhausted = new MemoryRepository(
  [request("stale", { reminderCount: 3 })],
  { "client-stale": { email: "zz-stale@example.com" } }
);
const staleRun = await processDueClientRequestReminders(staleExhausted, {
  now,
  source: "monitoring_cron",
  portalUrl,
  sendReminder: dryRunSender(staleCalls),
});
assert.equal(staleRun.processed, 0);
assert.equal(staleRun.skipped, 1);
assert.equal(staleExhausted.requests[0]?.nextReminderAt, null);
assert.equal(staleCalls.length, 0, "reminder 4 must never be emitted");

const failure = new MemoryRepository([request("failure")], {
  "client-failure": { email: "zz-failure@example.com" },
});
const failureRun = await processDueClientRequestReminders(failure, {
  now,
  source: "monitoring_cron",
  portalUrl,
  sendReminder: async () => ({
    success: false,
    dryRun: false,
    error: "SMTP is not configured",
  }),
});
assert.equal(failureRun.failed, 1);
assert.equal(failure.requests[0]?.reminderCount, 1);
assert.equal(failure.activities[0]?.deliveryStatus, "failed");
assert.equal(failure.activities[0]?.delivery.error, "SMTP is not configured");

const noRecipient = new MemoryRepository([request("no-recipient")], {
  "client-no-recipient": null,
});
const noRecipientRun = await processDueClientRequestReminders(noRecipient, {
  now,
  source: "monitoring_cron",
  portalUrl,
  sendReminder: async () => {
    throw new Error("must not send without a recipient");
  },
});
assert.equal(noRecipientRun.failed, 1);
assert.equal(noRecipient.requests[0]?.reminderCount, 0);
assert.equal(noRecipient.activities.length, 0);

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const cron = read("app/api/cron/monitoring-refresh/route.ts");
const staffRoute = read("app/api/requests/reminders/route.ts");
const adapter = read("lib/request-queue/reminders.ts");
const email = read("lib/email/client.ts");

assert.match(cron, /await runDueClientRequestReminders\(supabase/);
assert.match(cron, /source: "monitoring_cron"/);
assert.match(cron, /request_reminders_processed/);
assert.match(cron, /request_reminder_results/);
assert.match(staffRoute, /source: "staff_route"/);
assert.match(adapter, /\.eq\("reminder_count", claim\.expectedReminderCount\)/);
assert.match(adapter, /action_type: "client_request_reminder_email"/);
assert.match(adapter, /idempotency_key: activity\.idempotencyKey/);
assert.match(adapter, /email_delivery:/);
assert.match(email, /Promise<EmailDeliveryResult>/);

console.log(
  JSON.stringify(
    {
      passed: true,
      policy: { maxReminders: 3, intervalDays: 7 },
      firstRun,
      replay,
      concurrentProcessed: concurrentRuns.map((run) => run.processed),
      thirdRun,
      staleRun,
      failureRun,
      noRecipientRun,
    },
    null,
    2
  )
);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
