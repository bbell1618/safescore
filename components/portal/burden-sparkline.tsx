"use client";

import {
  snapshotCaptureLabel,
  snapshotDeltaDescription,
  snapshotInteractionLabel,
  snapshotSourceLabel,
  type PortalSnapshotInteractionPoint,
} from "@/components/portal/snapshot-interaction";
import { buildSparklinePoints } from "@/lib/portal/home";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export type BurdenSparklineSnapshot = PortalSnapshotInteractionPoint;

type SparklinePoint = BurdenSparklineSnapshot & {
  x: number;
  y: number;
  delta: number | null;
};

const MINIMUM_WIDTH = 240;
const HEIGHT = 72;
const POINT_TARGET_RADIUS = 20;
const HORIZONTAL_PADDING = POINT_TARGET_RADIUS;
const MINIMUM_POINT_SPACING = POINT_TARGET_RADIUS * 2;

export function BurdenSparkline({
  snapshots,
  label,
}: {
  snapshots: BurdenSparklineSnapshot[];
  label: string;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const tooltipId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const activeIndex = pinnedIndex ?? focusedIndex ?? hoveredIndex;

  const ordered = snapshots;
  const width = Math.max(
    MINIMUM_WIDTH,
    Math.max(0, ordered.length - 1) * MINIMUM_POINT_SPACING +
      HORIZONTAL_PADDING * 2
  );
  const points = buildSparklinePoints(
    ordered.map((snapshot) => snapshot.totalPoints),
    width,
    HEIGHT,
    HORIZONTAL_PADDING
  );

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

  if (!points) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-warm-white/15 bg-warm-white/5 px-4 text-xs text-warm-white/70">
        Trend begins with your first snapshot.
      </div>
    );
  }

  const coordinates = points.split(" ").map((point) => {
    const [x, y] = point.split(",").map(Number);
    return { x: x ?? 0, y: y ?? 0 };
  });
  const interactivePoints: SparklinePoint[] = ordered.map((snapshot, index) => ({
    ...snapshot,
    x: coordinates[index]?.x ?? 0,
    y: coordinates[index]?.y ?? HEIGHT / 2,
    delta:
      index === 0
        ? null
        : snapshot.totalPoints - ordered[index - 1]!.totalPoints,
  }));
  const activePoint =
    activeIndex === null ? null : interactivePoints[activeIndex] ?? null;
  const areaPoints = `${HORIZONTAL_PADDING},64 ${points} ${
    width - HORIZONTAL_PADDING
  },64`;

  function pinPoint(index: number) {
    setPinnedIndex((current) => (current === index ? null : index));
  }

  function handlePointer(event: PointerEvent<SVGGElement>, index: number) {
    if (event.pointerType === "mouse") setHoveredIndex(index);
  }

  function handleKeyDown(
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
  const tooltipAlignment = activePoint
    ? activePoint.x < width * 0.32
      ? "translateX(0)"
      : activePoint.x > width * 0.68
        ? "translateX(-100%)"
        : "translateX(-50%)"
    : "translateX(-50%)";

  return (
    <figure
      ref={containerRef}
      className="relative"
      style={{ width: `${width}px`, minWidth: "100%" }}
      onPointerLeave={() => setHoveredIndex(null)}
      onPointerDown={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("[data-sparkline-point]")
        ) {
          setPinnedIndex(null);
          setFocusedIndex(null);
          setHoveredIndex(null);
        }
      }}
    >
      <svg
        aria-label={label}
        className="h-20 w-full overflow-visible"
        preserveAspectRatio="none"
        role="group"
        viewBox={`0 0 ${width} ${HEIGHT}`}
      >
        <defs>
          <linearGradient
            id="portal-home-burden-fill"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="var(--color-amber-light)"
              stopOpacity="0.18"
            />
            <stop
              offset="100%"
              stopColor="var(--color-amber)"
              stopOpacity="0.01"
            />
          </linearGradient>
        </defs>
        <polygon fill="url(#portal-home-burden-fill)" points={areaPoints} />
        <polyline
          fill="none"
          points={points}
          stroke="var(--color-amber-light)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />

        {activePoint ? (
          <g aria-hidden="true" className="pointer-events-none">
            <line
              stroke="var(--color-gold-light)"
              strokeDasharray="2 3"
              strokeWidth="1"
              x1={activePoint.x}
              x2={activePoint.x}
              y1="7"
              y2="65"
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              fill="var(--color-navy)"
              r="7"
              stroke="var(--color-amber-light)"
              strokeWidth="2"
            />
          </g>
        ) : null}

        {interactivePoints.map((point, index) => {
          const active = activeIndex === index;
          const pointLabel = snapshotInteractionLabel(point, point.delta);
          return (
            <g
              key={point.id}
              aria-describedby={active ? tooltipId : undefined}
              aria-label={pointLabel}
              aria-pressed={pinnedIndex === index}
              className="cursor-crosshair focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
              data-sparkline-point={point.id}
              role="button"
              tabIndex={0}
              onBlur={() => setFocusedIndex(null)}
              onClick={() => pinPoint(index)}
              onFocus={() => setFocusedIndex(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onPointerEnter={(event) => handlePointer(event, index)}
              onPointerMove={(event) => handlePointer(event, index)}
            >
              <title>{pointLabel}</title>
              <circle
                cx={point.x}
                cy={point.y}
                fill="transparent"
                r={POINT_TARGET_RADIUS}
              />
              {active || index === interactivePoints.length - 1 ? (
                <circle
                  cx={point.x}
                  cy={point.y}
                  data-sparkline-marker={active ? "active" : "endpoint"}
                  fill="var(--color-navy)"
                  pointerEvents="none"
                  r="4"
                  stroke="var(--color-amber-light)"
                  strokeWidth={active ? 3 : 2}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {activePoint ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute top-1 z-20 w-48 rounded-lg border border-gold/35 bg-navy px-3 py-2 text-left shadow-[var(--shadow-md)]"
          style={{
            left: `${(activePoint.x / width) * 100}%`,
            transform: tooltipAlignment,
          }}
        >
          <p className="font-mono text-[10px] text-cream/75">
            {snapshotCaptureLabel(
              activePoint.capturedAt,
              activePoint.snapshotDate
            )}
          </p>
          <p className="mt-1 text-xs font-semibold text-warm-white">
            {activePoint.totalPoints.toLocaleString("en-US")} weighted points
          </p>
          <p className="mt-0.5 text-[11px] text-cream/85">
            {snapshotDeltaDescription(activePoint.delta)}
          </p>
          {tooltipSource ? (
            <p className="mt-0.5 text-[11px] text-cream/75">
              {tooltipSource}
            </p>
          ) : null}
        </div>
      ) : null}

      <figcaption className="sr-only">
        {label}. Hover, tap, or focus a point for its captured time, change, and
        source.
      </figcaption>
    </figure>
  );
}
