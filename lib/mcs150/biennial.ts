const DAY_MS = 24 * 60 * 60 * 1000;

export type Mcs150DueYearParity = "odd" | "even";

export interface Mcs150BiennialClock {
  dotNumber: string;
  dueMonth: number;
  dueYearParity: Mcs150DueYearParity;
  lastFiledDate: string | null;
  previousScheduledDueDate: string;
  nextScheduledDueDate: string;
  satisfiedCycleDueDate: string | null;
  nextDueDate: string;
  daysRemaining: number;
  isOverdue: boolean;
  dueWithin60Days: boolean;
}

export interface ComputeMcs150BiennialClockInput {
  dotNumber: string | number;
  lastFiledDate: string | null;
  asOf?: Date | string;
}

function dateOnly(value: Date | string): Date {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      const [, year, month, day] = match;
      const parsed = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day)),
      );
      if (
        parsed.getUTCFullYear() !== Number(year) ||
        parsed.getUTCMonth() !== Number(month) - 1 ||
        parsed.getUTCDate() !== Number(day)
      ) {
        throw new Error(`Invalid calendar date: ${value}`);
      }
      return parsed;
    }
  }

  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${String(value)}`);
  }

  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

function shiftUtcYears(value: Date, years: number): Date {
  return endOfMonth(
    value.getUTCFullYear() + years,
    value.getUTCMonth() + 1,
  );
}

function scheduledDeadline(
  year: number,
  month: number,
  parity: Mcs150DueYearParity,
): Date {
  const requiredRemainder = parity === "odd" ? 1 : 0;
  let scheduledYear = year;
  if (Math.abs(scheduledYear % 2) !== requiredRemainder) {
    scheduledYear += 1;
  }
  return endOfMonth(scheduledYear, month);
}

/**
 * Computes the MCS-150 biennial clock using FMCSA's official digit rule:
 * the LAST USDOT digit sets the month (1-9 => Jan-Sep, 0 => Oct), and the
 * NEXT-TO-LAST digit sets odd/even filing years.
 *
 * An update filed in the 12 months before a scheduled deadline satisfies that
 * cycle. A late filing also satisfies the most recently missed cycle. The
 * returned nextDueDate can therefore be a past date when no qualifying filing
 * has cured an overdue cycle.
 */
export function computeMcs150BiennialClock({
  dotNumber,
  lastFiledDate,
  asOf = new Date(),
}: ComputeMcs150BiennialClockInput): Mcs150BiennialClock {
  const normalizedDot = String(dotNumber).replace(/\D/g, "");
  if (normalizedDot.length < 2) {
    throw new Error("A USDOT number with at least two digits is required");
  }

  const lastDigit = Number(normalizedDot.at(-1));
  const nextToLastDigit = Number(normalizedDot.at(-2));
  const dueMonth = lastDigit === 0 ? 10 : lastDigit;
  const dueYearParity: Mcs150DueYearParity =
    nextToLastDigit % 2 === 0 ? "even" : "odd";

  const asOfDate = dateOnly(asOf);
  const candidate = scheduledDeadline(
    asOfDate.getUTCFullYear(),
    dueMonth,
    dueYearParity,
  );

  let previousScheduledDue: Date;
  let nextScheduledDue: Date;
  if (candidate.getTime() <= asOfDate.getTime()) {
    previousScheduledDue = candidate;
    nextScheduledDue = shiftUtcYears(candidate, 2);
  } else {
    nextScheduledDue = candidate;
    previousScheduledDue = shiftUtcYears(candidate, -2);
  }

  const filedDate = lastFiledDate ? dateOnly(lastFiledDate) : null;
  const validFiledDate =
    filedDate && filedDate.getTime() <= asOfDate.getTime() ? filedDate : null;

  let satisfiedCycleDue: Date | null = null;
  let actionableDue = previousScheduledDue;

  // Check the upcoming deadline first. Once its 12-month early-filing window
  // opens, a qualifying filing satisfies that cycle and advances the clock.
  if (
    validFiledDate &&
    validFiledDate.getTime() >=
      shiftUtcYears(nextScheduledDue, -1).getTime()
  ) {
    satisfiedCycleDue = nextScheduledDue;
    actionableDue = shiftUtcYears(nextScheduledDue, 2);
  } else if (
    validFiledDate &&
    validFiledDate.getTime() >=
      shiftUtcYears(previousScheduledDue, -1).getTime()
  ) {
    // This also covers a filing made after the prior deadline: the late filing
    // cures that missed cycle, so the next regular biennial deadline applies.
    satisfiedCycleDue = previousScheduledDue;
    actionableDue = nextScheduledDue;
  }

  const daysRemaining = Math.ceil(
    (actionableDue.getTime() - asOfDate.getTime()) / DAY_MS,
  );

  return {
    dotNumber: normalizedDot,
    dueMonth,
    dueYearParity,
    lastFiledDate: validFiledDate ? isoDate(validFiledDate) : null,
    previousScheduledDueDate: isoDate(previousScheduledDue),
    nextScheduledDueDate: isoDate(nextScheduledDue),
    satisfiedCycleDueDate: satisfiedCycleDue
      ? isoDate(satisfiedCycleDue)
      : null,
    nextDueDate: isoDate(actionableDue),
    daysRemaining,
    isOverdue: daysRemaining < 0,
    dueWithin60Days: daysRemaining <= 60,
  };
}
