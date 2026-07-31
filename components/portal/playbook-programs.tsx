"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { PortalMotionListItem } from "@/components/portal/motion";
import { cn } from "@/lib/utils";

const ACCORDION_EASE = [0.16, 1, 0.3, 1] as const;

export interface PlaybookProgramView {
  id: string;
  familyName: string;
  count: number;
  points: number;
  inflowRatePerMonth: number;
  trailingWindowDays: number;
  riskContext: string;
  program: string[];
  workingWhen: string[];
  installments: string[];
  introduction: string;
  coachingLanguage: string;
}

function rateLabel(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function programToggleLabel(
  program: PlaybookProgramView,
  index: number,
  isOpen: boolean
): string {
  return `${isOpen ? "Collapse" : "Expand"} Focus ${index + 1}, ${
    program.familyName
  }: ${program.count.toLocaleString("en-US")} violations, ${program.points.toLocaleString(
    "en-US"
  )} points, ${rateLabel(program.inflowRatePerMonth)} new per month`;
}

function ProgramCard({
  program,
  index,
  isOpen,
  onToggle,
}: {
  program: PlaybookProgramView;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const titleId = `${program.id}-title`;
  const panelId = `${program.id}-details`;

  return (
    <PortalMotionListItem
      interactive
      className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm"
      delay={Math.min(index * 0.04, 0.2)}
    >
      <article className="scroll-mt-40" id={program.id}>
        <header className="group relative border-b border-sand bg-cream transition-colors duration-[var(--duration-fast)] hover:bg-warm-white focus-within:bg-warm-white motion-reduce:transition-none">
          <button
            aria-controls={panelId}
            aria-expanded={isOpen}
            aria-label={programToggleLabel(program, index, isOpen)}
            className="absolute inset-0 z-10 min-h-11 cursor-pointer rounded-t-xl outline-none transition-colors duration-[var(--duration-fast)] active:bg-amber/5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-inset motion-reduce:transition-none"
            onClick={onToggle}
            type="button"
          />
          <div className="pointer-events-none relative z-20 flex flex-col gap-5 p-5 xl:flex-row xl:items-center xl:justify-between sm:p-6">
            <div className="flex min-w-0 items-center gap-3">
              <motion.span
                animate={{ rotate: isOpen ? 180 : 0 }}
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber/25 bg-amber-subtle text-amber-dark"
                transition={{
                  duration: reduceMotion ? 0 : 0.25,
                  ease: ACCORDION_EASE,
                }}
              >
                <ChevronDown className="h-5 w-5" />
              </motion.span>
              <div className="min-w-0">
                <p className="mono-label text-amber-dark">Focus {index + 1}</p>
                <h3
                  className="mt-1 truncate font-heading text-2xl font-semibold tracking-tight text-warm-dark"
                  id={titleId}
                >
                  {program.familyName}
                </h3>
              </div>
            </div>
            <dl className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-lg border border-sand bg-warm-white px-3 py-3 text-center">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
                  Violations
                </dt>
                <dd className="mt-1 font-mono text-xl font-semibold text-warm-dark">
                  {program.count.toLocaleString("en-US")}
                </dd>
              </div>
              <div className="rounded-lg border border-sand bg-warm-white px-3 py-3 text-center">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
                  Points
                </dt>
                <dd className="mt-1 font-mono text-xl font-semibold text-warm-dark">
                  {program.points.toLocaleString("en-US")}
                </dd>
              </div>
              <div className="rounded-lg border border-sand bg-warm-white px-3 py-3 text-center">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
                  New / month
                </dt>
                <dd className="mt-1 font-mono text-xl font-semibold text-warm-dark">
                  {rateLabel(program.inflowRatePerMonth)}
                </dd>
              </div>
            </dl>
          </div>
        </header>

        <AnimatePresence initial={false}>
          {isOpen ? (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: reduceMotion ? 1 : 0 }}
              id={panelId}
              initial={
                reduceMotion
                  ? { height: "auto", opacity: 1 }
                  : { height: 0, opacity: 0 }
              }
              role="region"
              aria-labelledby={titleId}
              transition={{
                duration: reduceMotion ? 0 : 0.4,
                ease: ACCORDION_EASE,
              }}
            >
              <div className="border-t border-sand/70 p-5 sm:p-6">
                <p className="max-w-3xl text-sm leading-6 text-warm-mid">
                  {program.introduction}
                </p>
                <p className="mt-3 font-mono text-[10px] text-warm-gray">
                  New-violation rate uses the latest {program.trailingWindowDays}
                  -day window.
                </p>

                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-heading text-lg font-semibold text-warm-dark">
                        Why this matters
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-warm-mid">
                        {program.riskContext}
                      </p>
                    </div>
                    <div className="rounded-lg border border-amber/25 bg-amber-subtle p-4">
                      <h4 className="font-heading font-semibold text-warm-dark">
                        Coaching note
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-warm-mid">
                        {program.coachingLanguage}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-heading text-lg font-semibold text-warm-dark">
                        What to do
                      </h4>
                      <ul className="mt-3 space-y-2">
                        {program.program.map((step, stepIndex) => (
                          <li
                            className="flex min-h-10 gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-sm leading-6 text-warm-mid transition-colors duration-[var(--duration-fast)] hover:border-sand hover:bg-cream motion-reduce:transition-none"
                            key={`${stepIndex}-${step}`}
                          >
                            <ClipboardCheck
                              className="mt-1 h-4 w-4 shrink-0 text-amber-dark"
                              aria-hidden="true"
                            />
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="rounded-lg border border-success/20 bg-success-light p-4">
                      <div className="flex items-center gap-2 text-success">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <h4 className="font-heading font-semibold">
                          You&apos;ll know it&apos;s working when
                        </h4>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {program.workingWhen.map((signal, signalIndex) => (
                          <li
                            className="text-sm leading-6 text-warm-mid"
                            key={`${signalIndex}-${signal}`}
                          >
                            {signal}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-sand bg-cream p-4">
                      <div className="flex items-center gap-2 text-amber-dark">
                        <CalendarDays className="h-4 w-4" aria-hidden="true" />
                        <h4 className="font-heading font-semibold">
                          Included installments
                        </h4>
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {program.installments.map(
                          (installment, installmentIndex) => (
                            <li
                              className="min-h-10 rounded-lg border border-transparent px-3 py-2.5 text-sm leading-6 text-warm-mid transition-colors duration-[var(--duration-fast)] hover:border-sand hover:bg-warm-white motion-reduce:transition-none"
                              key={`${installmentIndex}-${installment}`}
                            >
                              {installment}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </article>
    </PortalMotionListItem>
  );
}

export function PlaybookPrograms({
  programs,
}: {
  programs: PlaybookProgramView[];
}) {
  const reduceMotion = useReducedMotion();
  const [activeProgramId, setActiveProgramId] = useState(
    programs[0]?.id ?? ""
  );
  const [openProgramIds, setOpenProgramIds] = useState<Set<string>>(
    () => new Set(programs[0] ? [programs[0].id] : [])
  );
  const visibleProgramsRef = useRef(new Map<string, number>());
  const programIds = programs.map((program) => program.id).join(",");

  useEffect(() => {
    const ids = programIds ? programIds.split(",") : [];
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const visiblePrograms = visibleProgramsRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visiblePrograms.set(
            entry.target.id,
            entry.isIntersecting ? entry.intersectionRatio : 0
          );
        }
        let nextId = "";
        let nextRatio = 0;
        for (const [id, ratio] of visiblePrograms) {
          if (ratio > nextRatio) {
            nextId = id;
            nextRatio = ratio;
          }
        }
        if (nextId) setActiveProgramId(nextId);
      },
      {
        rootMargin: "-22% 0px -58% 0px",
        threshold: [0, 0.15, 0.35, 0.6],
      }
    );

    for (const element of elements) observer.observe(element);
    return () => {
      observer.disconnect();
      visiblePrograms.clear();
    };
  }, [programIds]);

  function toggleProgram(programId: string) {
    setOpenProgramIds((current) => {
      const next = new Set(current);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
  }

  function jumpToProgram(
    event: MouseEvent<HTMLAnchorElement>,
    programId: string
  ) {
    event.preventDefault();
    setActiveProgramId(programId);
    setOpenProgramIds((current) => {
      if (current.has(programId)) return current;
      const next = new Set(current);
      next.add(programId);
      return next;
    });
    document.getElementById(programId)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <>
      <nav
        aria-label="Playbook program navigation"
        className="sticky top-20 z-20 mt-6 rounded-xl border border-sand bg-cream/95 p-2 shadow-sm backdrop-blur"
      >
        <ol className="flex gap-2 overflow-x-auto overscroll-x-contain">
          {programs.map((program, index) => {
            const isActive = activeProgramId === program.id;
            return (
              <li className="shrink-0" key={program.id}>
                <a
                  aria-current={isActive ? "location" : undefined}
                  className={cn(
                    "flex min-h-10 items-center rounded-lg border px-3 py-2 font-mono text-xs font-semibold transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
                    isActive
                      ? "border-amber/35 bg-amber-subtle text-amber-dark"
                      : "border-transparent text-warm-mid hover:border-sand hover:bg-warm-white hover:text-warm-dark"
                  )}
                  href={`#${program.id}`}
                  onClick={(event) => jumpToProgram(event, program.id)}
                >
                  Focus {index + 1}: {program.familyName}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <ol className="mt-6 space-y-6">
        {programs.map((program, index) => (
          <ProgramCard
            index={index}
            isOpen={openProgramIds.has(program.id)}
            key={program.id}
            onToggle={() => toggleProgram(program.id)}
            program={program}
          />
        ))}
      </ol>
    </>
  );
}
