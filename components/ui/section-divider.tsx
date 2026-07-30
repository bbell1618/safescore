import { cn } from "@/lib/utils";

export interface SectionDividerProps {
  fromColor?: string;
  toColor?: string;
  variant?: "curve" | "wave" | "angle";
  flip?: boolean;
  className?: string;
}

/**
 * Ported from GEIA-Website/components/ui/SectionDivider.tsx.
 *
 * This remains presentational and decorative; colors are supplied by callers
 * so the same geometry can connect either direction of the portal surfaces.
 * Complementary paths keep a transparent side genuinely transparent instead
 * of painting it over a full-size rectangle.
 */
export function SectionDivider({
  fromColor = "transparent",
  toColor = "var(--color-navy)",
  variant = "curve",
  flip = false,
  className,
}: SectionDividerProps) {
  const transform = flip ? "scaleY(-1)" : undefined;

  if (variant === "wave") {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative w-full overflow-hidden leading-none",
          className
        )}
        style={{ transform }}
      >
        <svg
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: "60px" }}
        >
          <path
            d="M0,0 H1440 V40 C1200,0 960,80 720,40 C480,0 240,80 0,40 Z"
            fill={fromColor}
          />
          <path
            d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z"
            fill={toColor}
          />
        </svg>
      </div>
    );
  }

  if (variant === "angle") {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative w-full overflow-hidden leading-none",
          className
        )}
        style={{ transform }}
      >
        <svg
          viewBox="0 0 1440 60"
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: "50px" }}
        >
          <path d="M0,0 H1440 L0,60 Z" fill={fromColor} />
          <path d="M0,60 L1440,0 L1440,60 Z" fill={toColor} />
        </svg>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative w-full overflow-hidden leading-none",
        className
      )}
      style={{ transform }}
    >
      <svg
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: "60px" }}
      >
        <path
          d="M0,0 H1440 V60 C1080,0 360,100 0,60 Z"
          fill={fromColor}
        />
        <path
          d="M0,60 C360,100 1080,0 1440,60 L1440,80 L0,80 Z"
          fill={toColor}
        />
      </svg>
    </div>
  );
}
