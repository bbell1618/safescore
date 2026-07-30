"use client";

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

export function GoldenEraTruckLoader({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative isolate overflow-hidden",
        compact ? "h-11 w-24" : "h-16 w-36",
        className
      )}
    >
      <div className="absolute left-0 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
        {[0, 1, 2].map((dash) => (
          <motion.span
            className="block h-0.5 rounded-full bg-gold/65"
            key={dash}
            style={{ width: `${18 - dash * 4}px` }}
            animate={
              reduceMotion
                ? { opacity: 0.55 }
                : { opacity: [0.15, 0.8, 0.15], x: [-5, 4, -5] }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: 1.15,
                    delay: dash * 0.12,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }
            }
          />
        ))}
      </div>

      <motion.div
        className="absolute bottom-0 right-0 w-[82%]"
        animate={reduceMotion ? { y: 0 } : { y: [0, -2, 0] }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                duration: 1.35,
                ease: "easeInOut",
                repeat: Number.POSITIVE_INFINITY,
              }
        }
      >
        <svg
          className="block h-auto w-full"
          viewBox="0 0 132 58"
        >
          <path
            d="M18 13h64v30H18z"
            fill="var(--color-amber)"
          />
          <path
            d="M82 23h22l13 13v7H82z"
            fill="var(--color-amber-light)"
          />
          <path
            d="M89 27h12l8 8H89z"
            fill="var(--color-navy)"
            opacity="0.88"
          />
          <path
            d="M12 39h110v7H12z"
            fill="var(--color-gold)"
          />
          <path
            d="M26 20h43v3H26zM26 27h30v3H26z"
            fill="var(--color-warm-white)"
            opacity="0.72"
          />
          {[34, 96].map((cx) => (
            <g key={cx}>
              <circle
                cx={cx}
                cy="46"
                fill="var(--color-warm-dark)"
                r="9"
                stroke="var(--color-gold-light)"
                strokeWidth="2"
              />
              <circle
                cx={cx}
                cy="46"
                fill="var(--color-warm-white)"
                r="3"
              />
            </g>
          ))}
        </svg>
      </motion.div>
    </div>
  );
}
