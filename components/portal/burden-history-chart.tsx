import { InteractiveBurdenHistoryChart } from "@/components/portal/interactive-burden-history-chart";
import type { PortalActivitySnapshot } from "@/lib/portal/activity-server";

const CHART_HEIGHT = 320;
const TOP = 40;
const RIGHT = 34;
const BOTTOM = 78;
const LEFT = 58;
const MINIMUM_WIDTH = 720;
const POINT_WIDTH = 112;

type ChartPoint = PortalActivitySnapshot & {
  x: number;
  y: number;
  dateLabel: string;
  timeLabel: string | null;
  delta: number | null;
};

function timestamp(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shortDate(value: string): string {
  const parsed = timestamp(
    value.includes("T") ? value : `${value}T00:00:00Z`
  );
  if (!parsed) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function shortTime(value: string): string {
  const parsed = timestamp(value);
  if (!parsed) return value;
  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

function roundedDomain(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const rawRange = maximum - minimum;
  const padding = rawRange === 0 ? Math.max(10, maximum * 0.05) : rawRange * 0.18;
  const lower = Math.max(0, Math.floor((minimum - padding) / 10) * 10);
  const upperCandidate = Math.ceil((maximum + padding) / 10) * 10;
  return {
    lower,
    upper: upperCandidate === lower ? lower + 20 : upperCandidate,
  };
}

function chartPoints(
  snapshots: PortalActivitySnapshot[],
  width: number,
  lower: number,
  upper: number
): ChartPoint[] {
  const duplicateDates = new Map<string, number>();
  for (const snapshot of snapshots) {
    duplicateDates.set(
      snapshot.snapshotDate,
      (duplicateDates.get(snapshot.snapshotDate) ?? 0) + 1
    );
  }
  const usableWidth = width - LEFT - RIGHT;
  const usableHeight = CHART_HEIGHT - TOP - BOTTOM;

  return snapshots.map((snapshot, index) => {
    const x =
      snapshots.length === 1
        ? LEFT + usableWidth / 2
        : LEFT + (index / (snapshots.length - 1)) * usableWidth;
    const y =
      TOP + ((upper - snapshot.totalPoints) / (upper - lower)) * usableHeight;
    const duplicate = (duplicateDates.get(snapshot.snapshotDate) ?? 0) > 1;
    return {
      ...snapshot,
      x,
      y,
      dateLabel: shortDate(snapshot.snapshotDate),
      timeLabel: duplicate ? shortTime(snapshot.capturedAt) : null,
      delta:
        index === 0
          ? null
          : snapshot.totalPoints - snapshots[index - 1]!.totalPoints,
    };
  });
}

export function BurdenHistoryChart({
  snapshots,
}: {
  snapshots: PortalActivitySnapshot[];
}) {
  if (snapshots.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-lg border border-sand bg-cream px-6 text-center">
        <div>
          <p className="font-heading text-lg font-semibold text-warm-dark">
            Your trend begins with the first snapshot
          </p>
          <p className="mt-1 text-sm text-warm-mid">
            GEIA will chart each stored monitoring result here.
          </p>
        </div>
      </div>
    );
  }

  const width = Math.max(MINIMUM_WIDTH, snapshots.length * POINT_WIDTH);
  const values = snapshots.map((snapshot) => snapshot.totalPoints);
  const { lower, upper } = roundedDomain(values);
  const points = chartPoints(snapshots, width, lower, upper);
  const linePoints = points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const chartBottom = CHART_HEIGHT - BOTTOM;
  const areaPoints = `${LEFT},${chartBottom} ${linePoints} ${
    width - RIGHT
  },${chartBottom}`;
  const gridValues = Array.from({ length: 5 }, (_, index) => ({
    value: Math.round(upper - ((upper - lower) * index) / 4),
    y:
      TOP +
      ((CHART_HEIGHT - TOP - BOTTOM) * index) /
        4,
  }));

  return (
    <InteractiveBurdenHistoryChart
      areaPoints={areaPoints}
      chartBottom={chartBottom}
      chartHeight={CHART_HEIGHT}
      gridValues={gridValues}
      left={LEFT}
      linePoints={linePoints}
      points={points}
      right={RIGHT}
      top={TOP}
      width={width}
    />
  );
}
