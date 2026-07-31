"use client";

import { PortalAnimatedActivitySeries } from "@/components/portal/motion";
import {
  signedSnapshotDelta,
  snapshotCaptureLabel,
  snapshotDeltaDescription,
  snapshotInteractionLabel,
  snapshotSourceLabel,
  type PortalSnapshotInteractionPoint,
} from "@/components/portal/snapshot-interaction";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export type InteractiveBurdenPoint = PortalSnapshotInteractionPoint & {
  x: number;
  y: number;
  dateLabel: string;
  timeLabel: string | null;
  delta: number | null;
};

type Props = {
  areaPoints: string;
  chartBottom: number;
  chartHeight: number;
  gridValues: Array<{ value: number; y: number }>;
  left: number;
  linePoints: string;
  points: InteractiveBurdenPoint[];
  right: number;
  top: number;
  width: number;
};

const TOOLTIP_WIDTH = 222;
const TOOLTIP_LINE_HEIGHT = 15;
const POINT_TARGET_RADIUS = 20;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function InteractiveBurdenHistoryChart({
  areaPoints,
  chartBottom,
  chartHeight,
  gridValues,
  left,
  linePoints,
  points,
  right,
  top,
  width,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const activeIndex = pinnedIndex ?? focusedIndex ?? hoveredIndex;
  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;

  useEffect(() => {
    if (pinnedIndex === null && focusedIndex === null) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setPinnedIndex(null);
        setFocusedIndex(null);
        setHoveredIndex(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [focusedIndex, pinnedIndex]);

  function pinPoint(index: number) {
    setPinnedIndex((current) => (current === index ? null : index));
  }

  function handlePointPointer(
    event: PointerEvent<SVGGElement>,
    index: number
  ) {
    if (event.pointerType === "mouse") setHoveredIndex(index);
  }

  function handlePointKeyDown(
    event: KeyboardEvent<SVGGElement>,
    index: number
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pinPoint(index);
    } else if (event.key === "Escape") {
      setPinnedIndex(null);
      setFocusedIndex(null);
      event.currentTarget.blur();
    }
  }

  const tooltipSource = activePoint
    ? snapshotSourceLabel(activePoint.source)
    : null;
  const tooltipLines = activePoint
    ? [
        snapshotCaptureLabel(
          activePoint.capturedAt,
          activePoint.snapshotDate
        ),
        `${activePoint.totalPoints.toLocaleString("en-US")} weighted points`,
        snapshotDeltaDescription(activePoint.delta),
        tooltipSource,
      ].filter((line): line is string => line !== null)
    : [];
  const tooltipHeight = 18 + tooltipLines.length * TOOLTIP_LINE_HEIGHT;
  const tooltipX = activePoint
    ? clamp(
        activePoint.x - TOOLTIP_WIDTH / 2,
        8,
        width - TOOLTIP_WIDTH - 8
      )
    : 0;
  const tooltipY = activePoint
    ? activePoint.y - tooltipHeight - 18 >= 6
      ? activePoint.y - tooltipHeight - 18
      : activePoint.y + 18
    : 0;

  return (
    <figure>
      <div
        ref={containerRef}
        className="relative overflow-x-auto rounded-lg border border-sand bg-cream"
        onPointerLeave={() => setHoveredIndex(null)}
        onPointerDown={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest("[data-snapshot-point]")
          ) {
            setPinnedIndex(null);
            setFocusedIndex(null);
            setHoveredIndex(null);
          }
        }}
      >
        <svg
          aria-label={`Interactive weighted burden chart with ${points.length} stored ${
            points.length === 1 ? "snapshot" : "snapshots"
          }`}
          className="block h-80"
          role="group"
          style={{ width: `${width}px`, minWidth: "100%" }}
          viewBox={`0 0 ${width} ${chartHeight}`}
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

          {gridValues.map(({ value, y }, index) => (
            <g key={`${value}-${index}`}>
              <line
                opacity="0.28"
                stroke="var(--color-gold)"
                strokeDasharray={index === gridValues.length - 1 ? "0" : "4 6"}
                x1={left}
                x2={width - right}
                y1={y}
                y2={y}
              />
              <text
                dominantBaseline="middle"
                fontFamily="var(--font-dm-mono)"
                fontSize="10"
                textAnchor="end"
                x={left - 10}
                y={y}
                style={{ fill: "var(--color-warm-gray)" }}
              >
                {value}
              </text>
            </g>
          ))}

          {points.length > 1 ? (
            <PortalAnimatedActivitySeries
              areaPoints={areaPoints}
              linePoints={linePoints}
            />
          ) : null}

          {points.slice(1).map((point, index) => {
            const prior = points[index]!;
            const x = (prior.x + point.x) / 2;
            const y = clamp((prior.y + point.y) / 2 + 27, top + 16, chartBottom - 10);
            const label = signedSnapshotDelta(point.delta ?? 0);
            const badgeWidth = Math.max(34, 17 + label.length * 7);
            return (
              <g key={`delta-${point.id}`} data-delta-badge={label} aria-hidden="true">
                <rect
                  fill="var(--color-warm-white)"
                  height="20"
                  opacity="0.94"
                  rx="10"
                  stroke="var(--color-sand)"
                  width={badgeWidth}
                  x={x - badgeWidth / 2}
                  y={y - 12}
                />
                <text
                  dominantBaseline="middle"
                  fontFamily="var(--font-dm-mono)"
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="middle"
                  x={x}
                  y={y - 2}
                  style={{ fill: "var(--color-warm-mid)" }}
                >
                  {label}
                </text>
              </g>
            );
          })}

          {activePoint ? (
            <g aria-hidden="true" className="pointer-events-none">
              <line
                stroke="var(--color-amber)"
                strokeDasharray="3 4"
                strokeWidth="1.5"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={top}
                y2={chartBottom}
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                fill="var(--color-amber-subtle)"
                r="10"
                stroke="var(--color-amber)"
                strokeWidth="2"
              />
              <g transform={`translate(${tooltipX} ${tooltipY})`}>
                <rect
                  fill="var(--color-navy)"
                  height={tooltipHeight}
                  rx="10"
                  stroke="var(--color-gold)"
                  strokeOpacity="0.42"
                  width={TOOLTIP_WIDTH}
                />
                {tooltipLines.map((line, index) => (
                  <text
                    key={`${line}-${index}`}
                    fontFamily={index === 0 ? "var(--font-dm-mono)" : undefined}
                    fontSize={index === 0 ? "10" : "11"}
                    fontWeight={index === 1 ? "600" : "400"}
                    x="12"
                    y={18 + index * TOOLTIP_LINE_HEIGHT}
                    style={{
                      fill:
                        index === 1
                          ? "var(--color-warm-white)"
                          : "var(--color-cream)",
                    }}
                  >
                    {line}
                  </text>
                ))}
              </g>
            </g>
          ) : null}

          {points.map((point, index) => {
            const label = snapshotInteractionLabel(point, point.delta);
            const active = activeIndex === index;
            return (
              <g
                key={point.id}
                aria-describedby={active ? tooltipId : undefined}
                aria-label={label}
                aria-pressed={pinnedIndex === index}
                className="cursor-crosshair focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                data-snapshot-point={point.id}
                role="button"
                tabIndex={0}
                onBlur={() => setFocusedIndex(null)}
                onClick={() => pinPoint(index)}
                onFocus={() => setFocusedIndex(index)}
                onKeyDown={(event) => handlePointKeyDown(event, index)}
                onPointerEnter={(event) => handlePointPointer(event, index)}
                onPointerMove={(event) => handlePointPointer(event, index)}
              >
                <title>{label}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  fill="transparent"
                  r={POINT_TARGET_RADIUS}
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  fill="var(--color-warm-white)"
                  pointerEvents="none"
                  r={active ? 6 : 5}
                  stroke="var(--color-amber)"
                  strokeWidth="3"
                />
                <text
                  fontFamily="var(--font-dm-mono)"
                  fontSize="12"
                  fontWeight="600"
                  pointerEvents="none"
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
                  pointerEvents="none"
                  textAnchor="middle"
                  x={point.x}
                  y={chartHeight - 44}
                  style={{ fill: "var(--color-warm-mid)" }}
                >
                  {point.dateLabel}
                </text>
                {point.timeLabel ? (
                  <text
                    fontFamily="var(--font-dm-mono)"
                    fontSize="9"
                    pointerEvents="none"
                    textAnchor="middle"
                    x={point.x}
                    y={chartHeight - 27}
                    style={{ fill: "var(--color-warm-gray)" }}
                  >
                    {point.timeLabel}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {activePoint ? (
          <p id={tooltipId} role="tooltip" className="sr-only">
            {snapshotInteractionLabel(activePoint, activePoint.delta)}
          </p>
        ) : null}
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-warm-gray">
        Every stored monitoring snapshot is shown. Hover, tap, or focus a point
        for its captured time, change, and source. Multiple checks on the same
        date include their capture time.
      </figcaption>
    </figure>
  );
}
