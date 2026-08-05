export const MONITORING_TIME_ZONE = "America/Los_Angeles";
export const MONITORING_CHECK_HOUR = 6;
export const MONITORING_CRON_SCHEDULES = ["0 13 * * *", "0 14 * * *"] as const;

export const MONITORING_ALERT_EVENTS = [
  "new violation",
  "new inspection",
  "new crash",
  "OOS change",
] as const;

export type MonitoringCheckCandidate = {
  timestamp: string;
  source: string;
  kind: "run" | "snapshot";
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MONITORING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MONITORING_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MONITORING_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function requireValidDate(value: string | Date, context: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${context} requires a valid timestamp`);
  }
  return date;
}

function zonedDateParts(date: Date): ZonedDateParts {
  const parts = Object.fromEntries(
    zonedPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function addLocalDays(
  date: Pick<ZonedDateParts, "year" | "month" | "day">,
  days: number
) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localDateTimeToUtc({
  year,
  month,
  day,
  hour,
}: Pick<ZonedDateParts, "year" | "month" | "day" | "hour">): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let candidateMs = targetAsUtc;

  // Resolve the IANA-zone offset at the target date. Six AM is outside the
  // ambiguous/nonexistent hour on Pacific daylight-saving transition days.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidateParts = zonedDateParts(new Date(candidateMs));
    const representedAsUtc = Date.UTC(
      candidateParts.year,
      candidateParts.month - 1,
      candidateParts.day,
      candidateParts.hour,
      candidateParts.minute,
      candidateParts.second
    );
    const adjustment = targetAsUtc - representedAsUtc;
    candidateMs += adjustment;
    if (adjustment === 0) break;
  }

  const resolved = new Date(candidateMs);
  const resolvedParts = zonedDateParts(resolved);
  if (
    resolvedParts.year !== year ||
    resolvedParts.month !== month ||
    resolvedParts.day !== day ||
    resolvedParts.hour !== hour ||
    resolvedParts.minute !== 0
  ) {
    throw new Error("Unable to resolve the next Pacific monitoring check");
  }
  return resolved;
}

export function nextMonitoringCheck(now: Date = new Date()): Date {
  const validNow = requireValidDate(now, "Next monitoring check");
  const localNow = zonedDateParts(validNow);
  const targetDate =
    localNow.hour < MONITORING_CHECK_HOUR
      ? localNow
      : addLocalDays(localNow, 1);

  return localDateTimeToUtc({
    year: targetDate.year,
    month: targetDate.month,
    day: targetDate.day,
    hour: MONITORING_CHECK_HOUR,
  });
}

/**
 * Vercel cron expressions are UTC-only. Production invokes at both possible
 * UTC hours for 6:00 AM Pacific; the route executes only the DST-correct one.
 * The documented cron user agent is a fallback if the schedule header is not
 * present. Authorized requests with neither cron marker are manual and proceed.
 */
export function shouldRunMonitoringInvocation({
  scheduleHeader,
  userAgent = null,
  now = new Date(),
}: {
  scheduleHeader: string | null;
  userAgent?: string | null;
  now?: Date;
}): boolean {
  const isVercelCron =
    scheduleHeader !== null ||
    userAgent?.toLowerCase().startsWith("vercel-cron/") === true;
  if (!isVercelCron) return true;
  if (
    scheduleHeader !== null &&
    !(MONITORING_CRON_SCHEDULES as readonly string[]).includes(scheduleHeader)
  ) {
    throw new Error(`Unexpected monitoring cron schedule: ${scheduleHeader}`);
  }
  return zonedDateParts(requireValidDate(now, "Monitoring cron gate")).hour === MONITORING_CHECK_HOUR;
}

export function formatMonitoringTimestamp(value: string | Date): string {
  const date = requireValidDate(value, "Monitoring timestamp formatter");
  return `${dateFormatter.format(date)}, ${timeFormatter.format(date)} PT`;
}

export function mostRecentMonitoringCheck(
  candidates: Array<MonitoringCheckCandidate | null | undefined>
): MonitoringCheckCandidate | null {
  let newest: MonitoringCheckCandidate | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!candidate.source.trim()) {
      throw new Error("Monitoring check source cannot be empty");
    }
    const timestampMs = requireValidDate(
      candidate.timestamp,
      "Monitoring check selection"
    ).getTime();
    if (timestampMs > newestMs) {
      newest = candidate;
      newestMs = timestampMs;
    }
  }

  return newest;
}

export function monitoringSourceLabel(check: MonitoringCheckCandidate): string {
  const labels: Record<string, string> = {
    monitoring_cron: "scheduled monitoring run",
    scheduled_refresh: "scheduled-refresh burden snapshot",
    rerun: "operator re-analysis burden snapshot",
    ingest: "ingest burden snapshot",
  };
  const fallback = check.kind === "run" ? "monitoring run" : "burden snapshot";
  return `${labels[check.source] ?? fallback} (${check.source})`;
}

export function monitoringWatchStatusText({
  lastCheck,
  lastRun,
  lastSnapshot,
  now = new Date(),
}: {
  lastCheck: MonitoringCheckCandidate | null;
  lastRun?: { timestamp: string; snapshotStatus: string | null } | null;
  lastSnapshot?: { timestamp: string } | null;
  now?: Date;
}): string {
  if (
    lastRun?.snapshotStatus === "unchanged" &&
    lastSnapshot &&
    requireValidDate(lastRun.timestamp, "Monitoring run").getTime() >
      requireValidDate(lastSnapshot.timestamp, "Monitoring snapshot").getTime()
  ) {
    return [
      `Checked ${formatMonitoringTimestamp(lastRun.timestamp)}; no change since ${formatMonitoringTimestamp(lastSnapshot.timestamp)}`,
      `next check ${formatMonitoringTimestamp(nextMonitoringCheck(now))}`,
      `alerts fire on: ${MONITORING_ALERT_EVENTS.join(", ")}`,
    ].join(" \u00B7 ");
  }
  const lastCheckText = lastCheck
    ? `${formatMonitoringTimestamp(lastCheck.timestamp)} via ${monitoringSourceLabel(lastCheck)}`
    : "not yet recorded";

  return [
    "Watching daily",
    `last check ${lastCheckText}`,
    `next check ${formatMonitoringTimestamp(nextMonitoringCheck(now))}`,
    `alerts fire on: ${MONITORING_ALERT_EVENTS.join(", ")}`,
  ].join(" \u00B7 ");
}
