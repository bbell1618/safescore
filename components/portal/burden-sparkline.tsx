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
      <div className="flex h-20 items-center justify-center rounded-lg border border-warm-white/15 bg-warm-white/5 px-4 text-xs text-warm-white/70">
        Trend begins with your first snapshot.
      </div>
    );
  }

  const pointList = points.split(" ");
  const latestPoint = pointList[pointList.length - 1]?.split(",") ?? [];
  const latestX = Number(latestPoint[0]);
  const latestY = Number(latestPoint[1]);
  const areaPoints = `8,64 ${points} 232,64`;

  return (
    <figure>
      <svg
        aria-label={label}
        className="h-20 w-full"
        role="img"
        viewBox="0 0 240 72"
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
              stopOpacity="0.34"
            />
            <stop
              offset="100%"
              stopColor="var(--color-amber)"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>
        {[16, 40, 64].map((y) => (
          <line
            key={y}
            opacity="0.24"
            stroke="var(--color-gold)"
            strokeDasharray="3 5"
            x1="8"
            x2="232"
            y1={y}
            y2={y}
          />
        ))}
        <polygon fill="url(#portal-home-burden-fill)" points={areaPoints} />
        <polyline
          fill="none"
          points={points}
          stroke="var(--color-amber-light)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {Number.isFinite(latestX) && Number.isFinite(latestY) ? (
          <circle
            cx={latestX}
            cy={latestY}
            fill="var(--color-navy)"
            r="4"
            stroke="var(--color-amber-light)"
            strokeWidth="3"
          />
        ) : null}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
