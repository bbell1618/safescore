import type { PortalActivitySnapshot } from "@/lib/portal/activity-server";
import { PortalAnimatedActivitySeries } from "@/components/portal/motion";

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
  accessibleLabel: string;
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

function fullTimestamp(value: string): string {
  const parsed = timestamp(value);
  if (!parsed) return value;
  return parsed.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
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
      accessibleLabel: `${fullTimestamp(snapshot.capturedAt)}: ${snapshot.totalPoints.toLocaleString(
        "en-US"
      )} weighted points`,
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
  const polyline = points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const chartBottom = CHART_HEIGHT - BOTTOM;
  const areaPoints = `${LEFT},${chartBottom} ${polyline} ${
    width - RIGHT
  },${chartBottom}`;
  const gridValues = Array.from({ length: 5 }, (_, index) =>
    Math.round(upper - ((upper - lower) * index) / 4)
  );

  return (
    <figure>
      <div className="overflow-x-auto rounded-lg border border-sand bg-cream">
        <svg
          aria-label={`Weighted burden across ${snapshots.length} stored ${
            snapshots.length === 1 ? "snapshot" : "snapshots"
          }`}
          className="block h-80"
          role="img"
          style={{ width: `${width}px`, minWidth: "100%" }}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        >
          <defs>
            <linearGradient
              id="portal-activity-burden-fill"
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor="var(--color-amber)"
                stopOpacity="0.24"
              />
              <stop
                offset="100%"
                stopColor="var(--color-amber)"
                stopOpacity="0.02"
              />
            </linearGradient>
          </defs>
          {gridValues.map((value, index) => {
            const y =
              TOP +
              ((CHART_HEIGHT - TOP - BOTTOM) * index) /
                (gridValues.length - 1);
            return (
              <g key={`${value}-${index}`}>
                <line
                  opacity="0.28"
                  stroke="var(--color-gold)"
                  strokeDasharray={index === gridValues.length - 1 ? "0" : "4 6"}
                  x1={LEFT}
                  x2={width - RIGHT}
                  y1={y}
                  y2={y}
                />
                <text
                  dominantBaseline="middle"
                  fontFamily="var(--font-dm-mono)"
                  fontSize="10"
                  textAnchor="end"
                  x={LEFT - 10}
                  y={y}
                  style={{ fill: "var(--color-warm-gray)" }}
                >
                  {value}
                </text>
              </g>
            );
          })}

          {points.length > 1 ? (
            <PortalAnimatedActivitySeries
              areaPoints={areaPoints}
              linePoints={polyline}
            />
          ) : null}

          {points.map((point) => (
            <g key={point.id}>
              <title>{point.accessibleLabel}</title>
              <circle
                cx={point.x}
                cy={point.y}
                fill="var(--color-warm-white)"
                r="5"
                stroke="var(--color-amber)"
                strokeWidth="3"
              />
              <text
                fontFamily="var(--font-dm-mono)"
                fontSize="12"
                fontWeight="600"
                textAnchor="middle"
                x={point.x}
                y={Math.max(18, point.y - 14)}
                style={{ fill: "var(--color-warm-dark)" }}
              >
                {point.totalPoints.toLocaleString("en-US")}
              </text>
              <text
                fontFamily="var(--font-dm-mono)"
                fontSize="10"
                textAnchor="middle"
                x={point.x}
                y={CHART_HEIGHT - 44}
                style={{ fill: "var(--color-warm-mid)" }}
              >
                {point.dateLabel}
              </text>
              {point.timeLabel ? (
                <text
                  fontFamily="var(--font-dm-mono)"
                  fontSize="9"
                  textAnchor="middle"
                  x={point.x}
                  y={CHART_HEIGHT - 27}
                  style={{ fill: "var(--color-warm-gray)" }}
                >
                  {point.timeLabel}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-warm-gray">
        Every stored monitoring snapshot is shown. Multiple checks on the same
        date include their capture time.
      </figcaption>
    </figure>
  );
}
