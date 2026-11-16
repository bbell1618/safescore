import { test } from "node:test";
import assert from "node:assert/strict";
import { planReminder, reminderEmail, reminderPreview, firstName, type ReminderState } from "./onboarding-reminder-plan";

// Mon 11/16/2026 9:00 AM Pacific
const MON = new Date("2026-11-16T17:00:00Z");
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000).toISOString();
const base: ReminderState = { inviteSentAt: daysBefore(MON, 3), remindersSent: 0, lastReminderAt: null, opened: false, signed: false, paid: false, enabled: true, hasEmail: true };

test("first reminder goes out 2+ days after the invite", () => {
  assert.deepEqual(planReminder(base, MON), { send: true, number: 1, stage: "not_opened" });
  assert.equal(planReminder({ ...base, inviteSentAt: daysBefore(MON, 1) }, MON).send, false);
});

test("stops when paid, switched off, no email, invite not sent, or three sent", () => {
  assert.equal(planReminder({ ...base, paid: true }, MON).send, false);
  assert.equal(planReminder({ ...base, enabled: false }, MON).send, false);
  assert.equal(planReminder({ ...base, hasEmail: false }, MON).send, false);
  assert.equal(planReminder({ ...base, inviteSentAt: null }, MON).send, false);
  assert.equal(planReminder({ ...base, inviteSentAt: daysBefore(MON, 30), remindersSent: 3 }, MON).send, false);
});

test("never on a weekend (Pacific)", () => {
  const sat = new Date("2026-11-14T18:00:00Z");
  assert.equal(planReminder({ ...base, inviteSentAt: daysBefore(sat, 4) }, sat).send, false);
});

test("second and third follow the 5 and 9 day marks and keep 2 days apart", () => {
  const s2 = { ...base, inviteSentAt: daysBefore(MON, 5), remindersSent: 1, lastReminderAt: daysBefore(MON, 3), opened: true };
  assert.deepEqual(planReminder(s2, MON), { send: true, number: 2, stage: "opened" });
  assert.equal(planReminder({ ...s2, inviteSentAt: daysBefore(MON, 4) }, MON).send, false);
  assert.equal(planReminder({ ...s2, inviteSentAt: daysBefore(MON, 12), lastReminderAt: daysBefore(MON, 1) }, MON).send, false);
  const s3 = { ...base, inviteSentAt: daysBefore(MON, 9), remindersSent: 2, lastReminderAt: daysBefore(MON, 4), opened: true, signed: true };
  assert.deepEqual(planReminder(s3, MON), { send: true, number: 3, stage: "signed" });
});

test("wording: AI disclosed, last reminder says so, greeting falls back", () => {
  const first = reminderEmail("not_opened", 1, { company: "ACME TRUCKING", contactName: "manjinder singh" });
  assert.match(first.body, /^Hi Manjinder,/);
  assert.match(first.body, /AI assistant at Golden Era Insurance Agency/);
  assert.doesNotMatch(first.body, /last reminder/);
  const last = reminderEmail("signed", 3, { company: "ACME TRUCKING", contactName: null });
  assert.match(last.body, /^Hello,/);
  assert.match(last.body, /last reminder/);
  assert.equal(firstName("123 Dispatch"), null);
  assert.equal(reminderPreview({ company: "ACME", contactName: null }).variants.length, 3);
});
