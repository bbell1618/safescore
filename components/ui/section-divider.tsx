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
 */
export function SectionDivider({
  fromColor = "#FEFCF8",
  toColor = "#1B2D4F",
  variant = "curve",
  flip = false,
  className,
}: SectionDividerProps) {
  const transform = flip ? "scaleY(-1)" : undefined;

  if (variant === "wave") {
    return (
      <div
        aria-hidden="true"
        className={cn("relative w-full overflow-hidden leading-none", className)}
        style={{ transform }}
      >
        <svg
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: "60px" }}
        >
          <rect width="1440" height="80" fill={fromColor} />
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
        className={cn("relative w-full overflow-hidden leading-none", className)}
        style={{ transform }}
      >
        <svg
          viewBox="0 0 1440 60"
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: "50px" }}
        >
          <rect width="1440" height="60" fill={fromColor} />
          <path d="M0,60 L1440,0 L1440,60 Z" fill={toColor} />
        </svg>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn("relative w-full overflow-hidden leading-none", className)}
      style={{ transform }}
    >
      <svg
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: "60px" }}
      >
        <rect width="1440" height="80" fill={fromColor} />
        <path
          d="M0,60 C360,100 1080,0 1440,60 L1440,80 L0,80 Z"
          fill={toColor}
        />
      </svg>
    </div>
  );
}
