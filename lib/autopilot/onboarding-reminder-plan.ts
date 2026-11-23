// QF-215: onboarding reminders. Pure planning and wording, no I/O, so it can be tested with node:test.
//
// Brandon's ruling (11/16/2026): approving the invite also pre-approves a fixed set of reminders.
// The wording below is fixed for that reason. It is shown on the invite card before he approves.
// At most three reminders, on days 2, 5 and 9 after the invite was sent, never on a weekend, and
// they stop the moment the carrier has paid or reminders are switched off for that carrier.

export const REMINDER_DAYS = [2, 5, 9] as const;
export const REMINDER_TEMPLATE = "autopilot_onboarding_reminder";
export const REMINDER_NOTE = "Pre-approved with the invite";

export type ReminderStage = "not_opened" | "opened" | "signed";

export type ReminderState = {
  inviteSentAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
  opened: boolean;
  signed: boolean;
  paid: boolean;
  enabled: boolean;
  hasEmail: boolean;
};

export type ReminderDecision =
  | { send: false; reason: string }
  | { send: true; number: number; stage: ReminderStage };

const DAY_MS = 86_400_000;

export function stageOf(state: Pick<ReminderState, "opened" | "signed">): ReminderStage {
  if (state.signed) return "signed";
  return state.opened ? "opened" : "not_opened";
}

export function isPacificWeekend(now: Date): boolean {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now);
  return day === "Sat" || day === "Sun";
}

export function planReminder(state: ReminderState, now: Date): ReminderDecision {
  if (!state.enabled) return { send: false, reason: "reminders are switched off for this carrier" };
  if (state.paid) return { send: false, reason: "the carrier has paid" };
  if (!state.hasEmail) return { send: false, reason: "no email on file" };
  if (!state.inviteSentAt) return { send: false, reason: "the invite has not been sent" };
  if (state.remindersSent >= REMINDER_DAYS.length) return { send: false, reason: "all reminders have been sent" };
  if (isPacificWeekend(now)) return { send: false, reason: "no reminders on a weekend" };
  const sinceInvite = (now.getTime() - new Date(state.inviteSentAt).getTime()) / DAY_MS;
  const due = REMINDER_DAYS[state.remindersSent];
  if (sinceInvite < due) return { send: false, reason: `next reminder is due ${due} days after the invite` };
  if (state.lastReminderAt && now.getTime() - new Date(state.lastReminderAt).getTime() < 1.8 * DAY_MS) {
    return { send: false, reason: "the last reminder went out less than 2 days ago" };
  }
  return { send: true, number: state.remindersSent + 1, stage: stageOf(state) };
}

export function firstName(contact: string | null | undefined): string | null {
  const word = (contact ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Za-z][A-Za-z'-]{1,}$/.test(word)) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// QF-221: the stage keys are kept (the invite card and its tests read them); their meaning is now
// not_opened = no account yet, opened = account made but not signed, signed = signed but not paid.
// QF-223: subjects never carry the company name (the carrier knows it).
const STAGE_COPY: Record<ReminderStage, { subject: (company: string) => string; lines: (company: string) => string[] }> = {
  not_opened: {
    subject: () => "Reminder: your SafeScore account is ready to set up",
    lines: (company) => [
      `This is Sunny, the AI assistant at Golden Era Insurance Agency. Your SafeScore account for ${company} is waiting. Use the button below to set it up.`,
      "It takes about 5 minutes: create a password, confirm your details, choose your service, sign, and pay.",
      "Once you are in, your account shows your safety plan, what to fix first, and a short list of what we need from you.",
    ],
  },
  opened: {
    subject: () => "Finish setting up your SafeScore account",
    lines: () => [
      "This is Sunny, the AI assistant at Golden Era Insurance Agency. Thank you for making your account. Use the button below to sign in and finish.",
      "What is left:\n1. Confirm your details and choose your service.\n2. Sign so we can work on your DOT record for you.\n3. Pay.",
      "It takes about 5 minutes. Then your safety plan opens and we start work.",
    ],
  },
  signed: {
    subject: () => "One step left to start SafeScore",
    lines: () => [
      "This is Sunny, the AI assistant at Golden Era Insurance Agency. Thank you for signing. Use the button below to sign in and finish.",
      "One step is left: pay. Then your safety plan opens and we start work on your DOT record.",
    ],
  },
};

export function reminderEmail(stage: ReminderStage, number: number, ctx: { company: string; contactName: string | null }) {
  const name = firstName(ctx.contactName);
  const copy = STAGE_COPY[stage];
  const lines = [name ? `Hi ${name},` : "Hello,", ...copy.lines(ctx.company)];
  if (number >= REMINDER_DAYS.length) lines.push("This is our last reminder. Your account link keeps working whenever you are ready.");
  lines.push("Questions? Reply to this email.");
  return { subject: copy.subject(ctx.company), body: lines.join("\n\n") };
}

/** What the invite card shows so the approval covers the reminders too. */
export function reminderPreview(ctx: { company: string; contactName: string | null }) {
  const when: Record<ReminderStage, string> = {
    not_opened: "If they have not made their account",
    opened: "If they made the account but have not signed",
    signed: "If they signed but have not paid",
  };
  return {
    days: [...REMINDER_DAYS],
    variants: (Object.keys(STAGE_COPY) as ReminderStage[]).map((stage) => ({ stage, when: when[stage], ...reminderEmail(stage, 1, ctx) })),
    lastLine: "The third reminder also says it is the last one.",
  };
}
