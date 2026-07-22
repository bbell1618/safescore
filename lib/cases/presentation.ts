const CPDP_DETERMINATION_GUIDANCE_DAYS = 60;

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, monthIndex, day, 12));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function cpdpFiledTimelineLabel(filedDate: string | null): string | null {
  if (!filedDate) return null;

  const filed = parseDateOnly(filedDate);
  if (!filed) return null;

  const expected = new Date(filed);
  expected.setUTCDate(expected.getUTCDate() + CPDP_DETERMINATION_GUIDANCE_DAYS);

  // FMCSA's guidance is approximately 60 calendar days. If that lands on a
  // weekend, present the next business day as the practical expectation.
  if (expected.getUTCDay() === 6) expected.setUTCDate(expected.getUTCDate() + 2);
  if (expected.getUTCDay() === 0) expected.setUTCDate(expected.getUTCDate() + 1);

  return `Filed ${formatMonthDay(filed)} \u00B7 determination expected ~${formatMonthDay(expected)}`;
}

export type FiledAuthorizationPresentation =
  | {
      state: "recorded";
      message: "Signed filing authorization on file for this filing.";
    }
  | {
      state: "missing";
      message: "No signed filing authorization on file for this filing \u2014 upload in onboarding Step 3.";
    };

export function filedAuthorizationPresentation(
  filingAuthorized: boolean
): FiledAuthorizationPresentation {
  return filingAuthorized
    ? {
        state: "recorded",
        message: "Signed filing authorization on file for this filing.",
      }
    : {
        state: "missing",
        message:
          "No signed filing authorization on file for this filing \u2014 upload in onboarding Step 3.",
      };
}
