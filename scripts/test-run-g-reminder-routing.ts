import assert from "node:assert/strict";
import {
  processDueClientRequestReminders,
  type ClientRequestReminderRepository,
  type DueClientRequest,
  type ReminderActivity,
  type ReminderEmailInput,
} from "../lib/request-queue/reminder-processor";

const now = new Date("2026-08-17T18:00:00.000Z");
const defaultPortalUrl =
  "https://safescore.example/portal/documents#needed-from-you";
const secretRosterUrl =
  "https://safescore.example/roster/11111111-1111-4111-8111-111111111111";
const redactedRosterUrl = "https://safescore.example/roster/[redacted]";

async function runOne(
  request: DueClientRequest,
  recipient: { email: string } | null = { email: "client@example.test" }
) {
  let email: ReminderEmailInput | null = null;
  let activity: ReminderActivity | null = null;
  const repository: ClientRequestReminderRepository = {
    async listDue() {
      return [request];
    },
    async recipientFor() {
      return recipient;
    },
    async claim() {
      return true;
    },
    async stopExhausted() {
      return false;
    },
    async logActivity(value) {
      activity = value;
      return "activity-1";
    },
  };
  const result = await processDueClientRequestReminders(repository, {
    now,
    source: "monitoring_cron",
    portalUrl: defaultPortalUrl,
    async sendReminder(value) {
      email = value;
      return { success: true, dryRun: true };
    },
  });
  return { result, email, activity };
}

const base: DueClientRequest = {
  id: "request-1",
  clientId: "client-1",
  companyName: "Example Carrier",
  title: "Driver roster & qualification documents",
  reminderCount: 0,
  reminderLimit: 3,
  nextReminderAt: "2026-08-17T17:00:00.000Z",
};

async function main() {
  const roster = await runOne({
    ...base,
    portalUrl: secretRosterUrl,
    activityPortalUrl: redactedRosterUrl,
  });
  assert.equal(roster.result.dryRun, 1);
  assert.equal(
    (roster.email as ReminderEmailInput | null)?.portalUrl,
    secretRosterUrl
  );
  assert.equal(
    (roster.activity as ReminderActivity | null)?.portalUrl,
    redactedRosterUrl
  );
  assert.equal(
    JSON.stringify(roster.activity).includes(
      "11111111-1111-4111-8111-111111111111"
    ),
    false,
    "the bearer token must not enter activity metadata"
  );

  const evidence = await runOne({ ...base, id: "request-2" });
  assert.equal(
    (evidence.email as ReminderEmailInput | null)?.portalUrl,
    defaultPortalUrl
  );
  assert.equal(
    (evidence.activity as ReminderActivity | null)?.portalUrl,
    defaultPortalUrl
  );

  const fallback = await runOne(
    {
      ...base,
      id: "request-3",
      portalUrl: secretRosterUrl,
      activityPortalUrl: redactedRosterUrl,
      fallbackRecipientEmail: "account@example.test",
    },
    null
  );
  assert.equal(
    (fallback.email as ReminderEmailInput | null)?.to,
    "account@example.test"
  );

  console.log(
    JSON.stringify(
      {
        passed: true,
        rosterEmailUsesTokenUrl: true,
        rosterActivityRedactsToken: true,
        evidenceReminderUnchanged: true,
        rosterAccountEmailFallback: true,
      },
      null,
      2
    )
  );
}

void main();
