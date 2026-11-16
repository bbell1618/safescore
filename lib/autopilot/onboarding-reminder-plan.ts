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

const STAGE_COPY: Record<ReminderStage, { subject: (company: string) => string; lines: (company: string) => string[] }> = {
  not_opened: {
    subject: (company) => `Your safety plan is ready, ${company}`,
    lines: (company) => [
      `This is Sunny, the AI assistant at Golden Era Insurance Agency. We built a safety plan for ${company} from your public DOT record.`,
      "It shows where your record stands today and the first things to fix. Reading it is free and takes about 5 minutes.",
      "Use the button below to open it. You do not need a password.",
    ],
  },
  opened: {
    subject: (company) => `Two short steps to start, ${company}`,
    lines: () => [
      "This is Sunny, the AI assistant at Golden Era Insurance Agency. Thank you for opening your safety plan.",
      "Two short steps start the work:\n1. Sign so we can work on your DOT record for you.\n2. Choose your service and pay.",
      "Both are on your plan page and take about 5 minutes. Use the button below.",
    ],
  },
  signed: {
    subject: (company) => `One step left, ${company}`,
    lines: () => [
      "This is Sunny, the AI assistant at Golden Era Insurance Agency. Thank you for signing.",
      "One step is left: choose your service and pay. Then we start work on your DOT record.",
      "It is on your plan page. Use the button below.",
    ],
  },
};

export function reminderEmail(stage: ReminderStage, number: number, ctx: { company: string; contactName: string | null }) {
  const name = firstName(ctx.contactName);
  const copy = STAGE_COPY[stage];
  const lines = [name ? `Hi ${name},` : "Hello,", ...copy.lines(ctx.company)];
  if (number >= REMINDER_DAYS.length) lines.push("This is our last reminder. Your plan link keeps working whenever you are ready.");
  lines.push("Questions? Reply to this email.");
  return { subject: copy.subject(ctx.company), body: lines.join("\n\n") };
}

/** What the invite card shows so the approval covers the reminders too. */
export function reminderPreview(ctx: { company: string; contactName: string | null }) {
  const when: Record<ReminderStage, string> = {
    not_opened: "If they have not opened the plan",
    opened: "If they opened it but have not signed",
    signed: "If they signed but have not paid",
  };
  return {
    days: [...REMINDER_DAYS],
    variants: (Object.keys(STAGE_COPY) as ReminderStage[]).map((stage) => ({ stage, when: when[stage], ...reminderEmail(stage, 1, ctx) })),
    lastLine: "The third reminder also says it is the last one.",
  };
}
