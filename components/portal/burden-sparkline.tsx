import { buildSparklinePoints } from "@/lib/portal/home";

export function BurdenSparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  const points = buildSparklinePoints(values);
  if (!points) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-sand bg-warm-white px-4 text-xs text-warm-gray">
        Trend begins with your first snapshot.
      </div>
    );
  }

  const pointList = points.split(" ");
  const latestPoint = pointList[pointList.length - 1]?.split(",") ?? [];
  const latestX = Number(latestPoint[0]);
  const latestY = Number(latestPoint[1]);

  return (
    <figure>
      <svg
        aria-label={label}
        className="h-20 w-full"
        role="img"
        viewBox="0 0 240 72"
      >
        <line
          stroke="var(--color-sand)"
          strokeDasharray="3 4"
          x1="8"
          x2="232"
          y1="64"
          y2="64"
        />
        <polyline
          fill="none"
          points={points}
          stroke="var(--color-amber)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {Number.isFinite(latestX) && Number.isFinite(latestY) ? (
          <circle
            cx={latestX}
            cy={latestY}
            fill="var(--color-warm-white)"
            r="4"
            stroke="var(--color-amber)"
            strokeWidth="3"
          />
        ) : null}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
