import { cn } from "@/lib/utils";

/**
 * QF-225 (Brandon, 11/23/2026: the old loader was "C- at best"). A semi rolling down the road:
 * lane marks stream past, wheels turn, the cab rides a little, exhaust puffs drift back.
 * Brand v3.1 colors. The road takes the surrounding text color, so it reads on navy and on cream.
 * Motion stops for people who ask for reduced motion (see the ge-* rules in globals.css).
 */
export function GoldenEraTruckLoader({ className, compact = false }: { className?: string; compact?: boolean }) {
  const wheels = [64, 84, 168, 188, 206];
  return (
    <div aria-hidden="true" className={cn("ge-truck relative isolate overflow-hidden", compact ? "h-12 w-32" : "h-24 w-64", className)}>
      <svg viewBox="0 0 240 90" className="block h-full w-full" fill="none">
        {/* road */}
        <line x1="0" y1="82" x2="240" y2="82" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
        <g className="ge-road">
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={i * 24} y="86" width="12" height="2" rx="1" fill="currentColor" fillOpacity="0.32" />
          ))}
        </g>
        {/* speed lines */}
        <g className="ge-speed" stroke="#E69634" strokeLinecap="round" strokeWidth="2">
          <line x1="8" y1="34" x2="30" y2="34" strokeOpacity="0.55" />
          <line x1="2" y1="48" x2="20" y2="48" strokeOpacity="0.35" />
          <line x1="12" y1="62" x2="32" y2="62" strokeOpacity="0.45" />
        </g>
        {/* exhaust */}
        <g fill="currentColor">
          <circle className="ge-puff" cx="186" cy="10" r="3" fillOpacity="0.25" />
          <circle className="ge-puff ge-puff-2" cx="186" cy="10" r="2.5" fillOpacity="0.2" />
        </g>
        <g className="ge-body">
          {/* trailer */}
          <rect x="40" y="18" width="124" height="52" rx="4" fill="#FFFDF8" stroke="#1B2D4F" strokeWidth="2.5" />
          <rect x="40" y="56" width="124" height="6" fill="#E69634" />
          <line x1="72" y1="22" x2="72" y2="52" stroke="#E4DCCB" strokeWidth="1.5" />
          <line x1="104" y1="22" x2="104" y2="52" stroke="#E4DCCB" strokeWidth="1.5" />
          <line x1="136" y1="22" x2="136" y2="52" stroke="#E4DCCB" strokeWidth="1.5" />
          <rect x="52" y="70" width="40" height="4" rx="1" fill="#1B2D4F" />
          {/* coupling */}
          <rect x="164" y="64" width="10" height="5" fill="#0F1B2D" />
          {/* cab */}
          <path d="M172 30 h22 l16 18 v22 h-38 z" fill="#1B2D4F" stroke="#0F1B2D" strokeWidth="2" strokeLinejoin="round" />
          <path d="M178 35 h14 l11 12 h-25 z" fill="#E8ECF2" />
          <rect x="204" y="58" width="9" height="6" rx="1.5" fill="#E69634" />
          <rect x="172" y="64" width="42" height="6" rx="2" fill="#0F1B2D" />
          {/* stack */}
          <rect x="184" y="14" width="4" height="18" rx="1.5" fill="#0F1B2D" />
        </g>
        {/* wheels */}
        {wheels.map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="76" r="8" fill="#0F1B2D" />
            <g className="ge-wheel">
              <circle cx={cx} cy="76" r="4" fill="#E4DCCB" />
              <rect x={cx - 0.75} y="72" width="1.5" height="8" fill="#0F1B2D" />
              <rect x={cx - 4} y="75.25" width="8" height="1.5" fill="#0F1B2D" />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
