"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BASIC_LABELS,
} from "@/lib/analysis/basic-measure";
import {
  pressureLevel,
  pressureWidth,
  type PortalHomeBasic,
  type PressureLevel,
} from "@/lib/portal/home";
import type { PortalHomePressureDetail } from "@/lib/portal/home-pressure";
import { cn } from "@/lib/utils";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${
    count === 1 ? singular : pluralForm
  }`;
}

function pressureClasses(level: PressureLevel) {
  if (level === "MAJOR") {
    return {
      chip: "bg-error-light text-error",
      bar: "bg-error",
    };
  }
  if (level === "MODERATE") {
    return {
      chip: "bg-amber-subtle text-amber-dark",
      bar: "bg-amber",
    };
  }
  return {
    chip: "bg-info-light text-info",
    bar: "bg-info",
  };
}

function burdenShare(points: number, totalPoints: number): string {
  const share = totalPoints > 0 ? (points / totalPoints) * 100 : 0;
  return share.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function shortDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function BasicPressureList({
  basics,
  details,
  totalPoints,
}: {
  basics: PortalHomeBasic[];
  details: PortalHomePressureDetail[];
  totalPoints: number;
}) {
  const reduceMotion = useReducedMotion();
  const [expandedBasic, setExpandedBasic] = useState<string | null>(null);
  const [tooltipBasic, setTooltipBasic] = useState<string | null>(null);
  const detailByBasic = useMemo(
    () => new Map(details.map((detail) => [detail.basicCategory, detail])),
    [details]
  );

  useEffect(() => {
    if (!tooltipBasic) return;

    function dismissTooltip(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        setTooltipBasic(null);
        return;
      }
      const pressureRow = target.closest<HTMLElement>("[data-pressure-basic]");
      if (pressureRow?.dataset.pressureBasic !== tooltipBasic) {
        setTooltipBasic(null);
      }
    }

    document.addEventListener("pointerdown", dismissTooltip);
    return () => document.removeEventListener("pointerdown", dismissTooltip);
  }, [tooltipBasic]);

  return (
    <ul className="mt-7 space-y-3">
      {basics.map((basic, index) => {
        const label =
          BASIC_LABELS[basic.basic_category] ??
          basic.basic_category.replaceAll("_", " ");
        const level = pressureLevel(basic.weighted_points, totalPoints);
        const classes = pressureClasses(level);
        const width = pressureWidth(basic.weighted_points, totalPoints);
        const share = burdenShare(basic.weighted_points, totalPoints);
        const detail = detailByBasic.get(basic.basic_category);
        const expanded = expandedBasic === basic.basic_category;
        const tooltipVisible = tooltipBasic === basic.basic_category;
        const controlId = `basic-pressure-${basic.basic_category}`;
        const headingId = `${controlId}-heading`;
        const tooltipId = `${controlId}-tooltip`;

        return (
          <li
            className="rounded-lg border border-transparent px-2 py-1 transition-colors hover:border-sand hover:bg-cream/60 focus-within:border-amber/35 focus-within:bg-cream/60 motion-reduce:transition-none"
            data-pressure-basic={basic.basic_category}
            key={basic.basic_category}
          >
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(12rem,1.6fr)_auto] sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className="font-heading font-semibold text-warm-dark"
                  id={headingId}
                >
                  {label}
                </h3>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold",
                    classes.chip
                  )}
                >
                  {level}
                </span>
              </div>

              <div className="relative">
                <button
                  aria-controls={controlId}
                  aria-describedby={tooltipVisible ? tooltipId : undefined}
                  aria-expanded={expanded}
                  aria-label={`${label}: ${plural(
                    basic.weighted_points,
                    "weighted point"
                  )}, ${plural(
                    basic.violation_count,
                    "violation"
                  )}, ${share}% of total burden. ${
                    expanded ? "Collapse" : "Expand"
                  } top violations.`}
                  className="group flex min-h-10 w-full touch-manipulation items-center gap-3 rounded-lg px-2 transition-colors hover:bg-warm-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 active:scale-[0.995] active:bg-sand/70 motion-reduce:transform-none motion-reduce:transition-none"
                  onBlur={() => setTooltipBasic(null)}
                  onClick={() => {
                    setExpandedBasic((current) =>
                      current === basic.basic_category
                        ? null
                        : basic.basic_category
                    );
                    setTooltipBasic(basic.basic_category);
                  }}
                  onFocus={() => setTooltipBasic(basic.basic_category)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setTooltipBasic(null);
                    }
                  }}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch") {
                      setTooltipBasic(basic.basic_category);
                    }
                  }}
                  onPointerLeave={(event) => {
                    if (
                      event.pointerType !== "touch" &&
                      document.activeElement !== event.currentTarget
                    ) {
                      setTooltipBasic(null);
                    }
                  }}
                  type="button"
                >
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sand">
                    <motion.span
                      aria-hidden="true"
                      className={cn(
                        "portal-motion-pressure-bar block h-full origin-left rounded-full",
                        classes.bar
                      )}
                      initial={reduceMotion ? false : { scaleX: 0 }}
                      style={{ width: `${width}%` }}
                      transition={{
                        delay: reduceMotion ? 0 : Math.min(index * 0.06, 0.3),
                        duration: reduceMotion ? 0 : 0.75,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      viewport={{ once: true, margin: "-40px" }}
                      whileInView={{ scaleX: 1 }}
                    />
                  </span>
                  <motion.span
                    animate={{ rotate: expanded ? 180 : 0 }}
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-warm-mid transition-colors group-hover:bg-cream group-hover:text-warm-dark motion-reduce:transition-none"
                    transition={{ duration: reduceMotion ? 0 : 0.2 }}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </motion.span>
                </button>

                <AnimatePresence>
                  {tooltipVisible ? (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-max max-w-[min(19rem,calc(100vw-3rem))] -translate-x-1/2 rounded-lg border border-gold/35 bg-navy px-3 py-2 text-center text-xs leading-5 text-warm-white shadow-[var(--shadow-md)]"
                      exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                      id={tooltipId}
                      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                      role="tooltip"
                      transition={{ duration: reduceMotion ? 0 : 0.15 }}
                    >
                      <span className="font-mono font-semibold">
                        {basic.weighted_points.toLocaleString("en-US")} pts
                      </span>{" "}
                      · {plural(basic.violation_count, "violation")} · {share}%
                      of total burden
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <p className="font-mono text-xs text-warm-mid sm:text-right">
                {basic.weighted_points.toLocaleString("en-US")} pts ·{" "}
                {plural(basic.violation_count, "violation")}
              </p>
            </div>

            <AnimatePresence initial={false}>
              {expanded ? (
                <motion.div
                  animate={{ height: "auto", opacity: 1 }}
                  className="overflow-hidden"
                  exit={{ height: 0, opacity: 0 }}
                  id={controlId}
                  role="region"
                  aria-labelledby={headingId}
                  initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.28,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <div className="mt-3 border-t border-sand pb-2 pt-4">
                    <p className="font-heading text-sm font-semibold text-warm-dark">
                      Highest-point violations in this BASIC
                    </p>
                    {detail?.topViolations.length ? (
                      <ol className="mt-3 grid gap-2">
                        {detail.topViolations.map((violation) => (
                          <li
                            className="grid gap-1 rounded-lg border border-sand bg-cream px-4 py-3 transition-colors hover:bg-warm-white motion-reduce:transition-none sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4"
                            key={violation.id}
                          >
                            <span className="font-mono text-xs font-semibold text-warm-dark">
                              {violation.code}
                            </span>
                            <span className="text-sm leading-5 text-warm-mid">
                              {violation.description}
                            </span>
                            <span className="flex items-center justify-between gap-4 font-mono text-[11px] text-warm-gray sm:block sm:text-right">
                              <span>{shortDate(violation.inspectionDate)}</span>
                              <span className="ml-3 font-semibold text-warm-dark">
                                {violation.weightedPoints.toLocaleString(
                                  "en-US"
                                )} pts
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-2 text-sm text-warm-mid">
                        No scored violation details are available for this
                        snapshot.
                      </p>
                    )}

                    {detail?.hasCoachingPlan ? (
                      <Link
                        className="btn-secondary mt-4 inline-flex min-h-10 items-center gap-2"
                        href="/portal/playbook"
                      >
                        See your coaching plan
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
