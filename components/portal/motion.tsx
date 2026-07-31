"use client";

import { cn } from "@/lib/utils";
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  type AriaRole,
  type ReactNode,
} from "react";

const REVEAL_EASE = [0.16, 1, 0.3, 1] as const;
const REVEAL_MARGIN = "-80px";

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: REVEAL_EASE },
  },
};

const cardHover = {
  y: -3,
  boxShadow: "var(--shadow-card-hover)",
  transition: { duration: 0.2, ease: REVEAL_EASE },
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  interactive?: boolean;
}

interface SemanticRevealProps extends RevealProps {
  id?: string;
  role?: AriaRole;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const isInView = useInView(ref, { once: true, margin: REVEAL_MARGIN });
  const reduceMotion = useReducedMotion();
  return { ref, isInView, reduceMotion };
}

function revealTransition(delay: number) {
  return delay > 0 ? { delay } : undefined;
}

export function PortalReveal({
  children,
  className,
  delay = 0,
}: RevealProps) {
  const { ref, isInView, reduceMotion } = useReveal<HTMLDivElement>();

  return (
    <motion.div
      ref={ref}
      className={cn("portal-motion-reveal", className)}
      variants={revealVariants}
      initial={reduceMotion ? false : "hidden"}
      animate={reduceMotion || isInView ? "visible" : "hidden"}
      transition={revealTransition(delay)}
    >
      {children}
    </motion.div>
  );
}

export function PortalMotionSection({
  children,
  className,
  delay = 0,
  interactive = false,
  id,
  role,
  ariaLabel,
  ariaLabelledBy,
}: SemanticRevealProps) {
  const { ref, isInView, reduceMotion } = useReveal<HTMLElement>();

  return (
    <motion.section
      ref={ref}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn("portal-motion-reveal", className)}
      variants={revealVariants}
      initial={reduceMotion ? false : "hidden"}
      animate={reduceMotion || isInView ? "visible" : "hidden"}
      transition={revealTransition(delay)}
      whileHover={!reduceMotion && interactive ? cardHover : undefined}
    >
      {children}
    </motion.section>
  );
}

export function PortalMotionArticle({
  children,
  className,
  delay = 0,
  interactive = false,
  id,
  role,
  ariaLabel,
  ariaLabelledBy,
}: SemanticRevealProps) {
  const { ref, isInView, reduceMotion } = useReveal<HTMLElement>();

  return (
    <motion.article
      ref={ref}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn("portal-motion-reveal", className)}
      variants={revealVariants}
      initial={reduceMotion ? false : "hidden"}
      animate={reduceMotion || isInView ? "visible" : "hidden"}
      transition={revealTransition(delay)}
      whileHover={!reduceMotion && interactive ? cardHover : undefined}
    >
      {children}
    </motion.article>
  );
}

export function PortalMotionListItem({
  children,
  className,
  delay = 0,
  interactive = false,
}: RevealProps) {
  const { ref, isInView, reduceMotion } = useReveal<HTMLLIElement>();

  return (
    <motion.li
      ref={ref}
      className={cn("portal-motion-reveal", className)}
      variants={revealVariants}
      initial={reduceMotion ? false : "hidden"}
      animate={reduceMotion || isInView ? "visible" : "hidden"}
      transition={revealTransition(delay)}
      whileHover={!reduceMotion && interactive ? cardHover : undefined}
    >
      {children}
    </motion.li>
  );
}

export function PortalAnimatedNumber({
  value,
  className,
  duration = 1.5,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  const currentValue = useRef(0);
  const [animatedValue, setAnimatedValue] = useState(0);
  const formatted = value.toLocaleString("en-US");

  useEffect(() => {
    if (!ref.current || (!isInView && !reduceMotion)) return;

    if (reduceMotion) {
      currentValue.current = value;
      return;
    }

    const controls = animate(currentValue.current, value, {
      duration,
      ease: REVEAL_EASE,
      onUpdate: (latest) => {
        currentValue.current = latest;
        setAnimatedValue(latest);
      },
    });
    return () => {
      controls.stop();
      currentValue.current = value;
    };
  }, [duration, isInView, reduceMotion, value]);

  const visibleValue = reduceMotion || !isInView ? value : animatedValue;

  return (
    <span className={cn("tabular-nums", className)}>
      <span ref={ref} aria-hidden="true">
        {Math.round(visibleValue).toLocaleString("en-US")}
      </span>
      <span className="sr-only">{formatted}</span>
    </span>
  );
}

export function PortalAnimatedPressureBar({
  percentage,
  className,
  ariaLabel,
  delay = 0,
}: {
  percentage: number;
  className?: string;
  ariaLabel: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      aria-label={ariaLabel}
      className={cn(
        "portal-motion-pressure-bar h-full origin-left rounded-full",
        className
      )}
      style={{ width: `${percentage}%` }}
      initial={reduceMotion ? false : { scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{
        delay: reduceMotion ? 0 : delay,
        duration: reduceMotion ? 0 : 0.75,
        ease: REVEAL_EASE,
      }}
    />
  );
}

export function PortalAnimatedActivitySeries({
  areaPoints,
  linePoints,
}: {
  areaPoints: string;
  linePoints: string;
}) {
  const reduceMotion = useReducedMotion();
  const fillVariants: Variants = reduceMotion
    ? { visible: { opacity: 1, transition: { duration: 0 } } }
    : {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { delay: 0.25, duration: 0.8, ease: REVEAL_EASE },
        },
      };
  const lineVariants: Variants = reduceMotion
    ? {
        visible: {
          opacity: 1,
          pathLength: 1,
          transition: { duration: 0 },
        },
      }
    : {
        hidden: { opacity: 0.25, pathLength: 0 },
        visible: {
          opacity: 1,
          pathLength: 1,
          transition: { duration: 1.25, ease: "easeInOut" },
        },
      };

  return (
    <motion.g
      initial={reduceMotion ? false : "hidden"}
      animate={reduceMotion ? "visible" : undefined}
      whileInView={reduceMotion ? undefined : "visible"}
      viewport={{ once: true, margin: "-60px" }}
    >
      <motion.polygon
        className="portal-motion-chart-fill"
        fill="url(#portal-activity-burden-fill)"
        points={areaPoints}
        variants={fillVariants}
      />
      <motion.polyline
        className="portal-motion-chart-line"
        fill="none"
        pathLength={1}
        points={linePoints}
        stroke="var(--color-amber)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        variants={lineVariants}
      />
    </motion.g>
  );
}
