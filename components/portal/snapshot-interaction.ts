export type PortalSnapshotInteractionPoint = {
  id: string;
  capturedAt: string;
  snapshotDate: string;
  source: string;
  totalPoints: number;
};

const SOURCE_LABELS: Record<string, string> = {
  scheduled_refresh: "Scheduled check",
  monitoring_cron: "Scheduled check",
  rerun: "Re-analysis",
  reanalysis: "Re-analysis",
  re_analysis: "Re-analysis",
  ingest: "Data import",
  monitoring: "Monitoring snapshot",
};

function parsedTimestamp(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function snapshotCaptureLabel(
  capturedAt: string,
  snapshotDate: string
): string {
  const dateOnly = parsedTimestamp(
    snapshotDate.includes("T") ? snapshotDate : `${snapshotDate}T00:00:00Z`
  );
  const dateLabel = dateOnly
    ? dateOnly.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : snapshotDate;
  const captured = parsedTimestamp(capturedAt);
  if (captured) {
    const timeLabel = captured.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
      timeZoneName: "short",
    });
    return `${dateLabel} · ${timeLabel}`;
  }
  return dateLabel;
}

export function snapshotSourceLabel(source: string): string | null {
  const normalized = source.trim().toLowerCase();
  if (!normalized) return null;
  const known = SOURCE_LABELS[normalized];
  if (known) return known;

  const humanized = normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
  return humanized || "Monitoring snapshot";
}

export function signedSnapshotDelta(delta: number): string {
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString(
    "en-US"
  )}`;
}

export function snapshotDeltaDescription(
  delta: number | null
): string {
  return delta === null
    ? "First stored snapshot"
    : `${signedSnapshotDelta(delta)} vs prior snapshot`;
}

export function snapshotInteractionLabel(
  point: PortalSnapshotInteractionPoint,
  delta: number | null
): string {
  const source = snapshotSourceLabel(point.source);
  return [
    snapshotCaptureLabel(point.capturedAt, point.snapshotDate),
    `${point.totalPoints.toLocaleString("en-US")} weighted points`,
    snapshotDeltaDescription(delta),
    source,
  ]
    .filter((value): value is string => Boolean(value))
    .join(". ");
}
