export const BASICS_CURRENT_MAX_AGE_DAYS = 45;

export type BasicsCurrentness = "current" | "stale" | "unknown";

/** QCMobile sends "2017-01-27T05:00:00.000+0000"; take the date part only. */
export function parseSmsRunDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return match ? match[1] : null;
}

export function classifyBasicsCurrentness(
  rawRunDate: string | null | undefined,
  now: Date = new Date()
): { currentness: BasicsCurrentness; runDate: string | null; ageDays: number | null } {
  const runDate = parseSmsRunDate(rawRunDate);
  if (!runDate) return { currentness: "unknown", runDate: null, ageDays: null };
  const runMs = Date.parse(`${runDate}T00:00:00Z`);
  if (Number.isNaN(runMs)) return { currentness: "unknown", runDate: null, ageDays: null };
  const todayMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const ageDays = Math.floor((todayMs - runMs) / 86_400_000);
  return {
    currentness: ageDays <= BASICS_CURRENT_MAX_AGE_DAYS ? "current" : "stale",
    runDate,
    ageDays,
  };
}
