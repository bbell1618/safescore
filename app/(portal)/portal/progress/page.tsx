import { portalCopy } from "@/lib/portal/copy";
import { Suspense } from "react";
import {
  Bell,
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
} from "lucide-react";
import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import { BurdenHistoryChart } from "@/components/portal/burden-history-chart";
import {
  PortalAnimatedNumber,
  PortalMotionListItem,
  PortalMotionSection,
  PortalReveal,
} from "@/components/portal/motion";
import { GoldenEraTruckLoader } from "@/components/portal/truck-loader";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { loadPortalProgressCases, type PortalProgressCase } from "@/lib/portal/progress-server";
import {
  loadPortalActivityAlerts,
  loadPortalActivitySnapshots,
  type PortalActivityAlert,
  type PortalActivitySnapshot,
} from "@/lib/portal/activity-server";
import { getPortalPageAccess } from "@/lib/portal/access";
import {
  minimumTierForFeature,
  tierHasFeature,
  TIER_LABELS,
} from "@/lib/tiers";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SemanticTone = "info" | "warning" | "success" | "danger";

function formatDate(value: string | null): string {
  if (!value) return "Date pending";
  const parsed = new Date(
    value.includes("T") ? value : `${value}T00:00:00Z`
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: value.includes("T") ? "America/Los_Angeles" : "UTC",
  });
}

function toneClasses(tone: SemanticTone): string {
  if (tone === "success") return "bg-success-light text-success";
  if (tone === "warning") return "bg-amber-subtle text-amber-dark";
  if (tone === "danger") return "bg-error-light text-error";
  return "bg-info-light text-info";
}

function caseStatus(caseRow: PortalProgressCase): {
  label: string;
  tone: SemanticTone;
} {
  if (
    ["filed", "pending", "pending_state", "pending_fmcsa"].includes(
      caseRow.status
    )
  ) {
    return { label: "Filed / Pending FMCSA", tone: "info" };
  }
  if (caseRow.status === "draft") {
    return { label: "GEIA is preparing", tone: "info" };
  }
  if (caseRow.status === "investigating") {
    return { label: "Under review", tone: "warning" };
  }
  if (caseRow.status === "reconsidering") {
    return { label: "Under reconsideration", tone: "warning" };
  }
  if (
    ["approved", "determination_made", "closed"].includes(caseRow.status)
  ) {
    return {
      label: caseRow.status === "closed" ? "Closed" : "Decision received",
      tone: caseRow.outcome === "not_preventable" || caseRow.outcome === "approved" || caseRow.status === "approved" ? "success" : "info",
    };
  }
  if (caseRow.status === "denied") {
    return { label: "Decision received", tone: "danger" };
  }
  return { label: "In progress", tone: "warning" };
}

function outcomePresentation(value: string | null): {
  label: string;
  tone: SemanticTone;
} | null {
  if (!value || value === "undecided") return null;
  if (value === "approved") {
    return { label: "Approved", tone: "success" };
  }
  if (value === "not_preventable") {
    return { label: "Not preventable", tone: "success" };
  }
  if (value === "denied") {
    return { label: "Denied", tone: "danger" };
  }
  if (value === "preventable") {
    return { label: "Preventable", tone: "danger" };
  }
  if (value === "dismissed") {
    return { label: "Dismissed", tone: "warning" };
  }
  if (value === "withdrawn") {
    return { label: "Withdrawn", tone: "warning" };
  }
  return null;
}

function alertPresentation(alert: PortalActivityAlert): {
  label: string;
  tone: SemanticTone;
} {
  if (alert.severity === "critical") {
    return { label: "Critical", tone: "danger" };
  }
  if (alert.severity === "warning") {
    return { label: "Needs attention", tone: "warning" };
  }
  return { label: "Update", tone: "info" };
}

function SectionFallback({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <section
      aria-label={`Loading ${label}`}
      className="space-y-4 rounded-xl border border-sand bg-warm-white p-6 shadow-sm"
      role="status"
    >
      <GoldenEraTruckLoader compact className="mx-auto" />
      <div className="h-6 w-44 rounded-md bg-sand motion-safe:animate-pulse" />
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="h-16 rounded-lg border border-sand bg-cream motion-safe:animate-pulse"
          key={index}
        />
      ))}
      <span className="sr-only">Loading {label}…</span>
    </section>
  );
}

async function TrendSection({
  promise,
}: {
  promise: Promise<PortalActivitySnapshot[]>;
}) {
  const snapshots = await promise;
  const latest = snapshots[snapshots.length - 1] ?? null;

  return (
    <PortalMotionSection
      interactive
      className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label text-amber">Complete history</p>
          <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
            Violation burden trend
          </h2>
          <p className="mt-2 text-sm leading-6 text-warm-mid">
            Every stored check stays in the record, including temporary spikes.
          </p>
        </div>
        {latest ? (
          <dl className="text-right">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
              Latest violation burden
            </dt>
            <dd className="mt-1 font-mono text-3xl font-semibold text-warm-dark">
              {latest.totalPoints.toLocaleString("en-US")}
            </dd>
            <dd className="font-mono text-[10px] text-warm-gray">
              {formatDate(latest.capturedAt)}
            </dd>
          </dl>
        ) : null}
      </div>
      <div className="mt-6">
        <BurdenHistoryChart snapshots={snapshots} />
      </div>
    </PortalMotionSection>
  );
}

async function AlertsSection({
  promise,
}: {
  promise: Promise<PortalActivityAlert[]>;
}) {
  const alerts = await promise;
  return (
    <PortalMotionSection
      interactive
      className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm"
    >
      <header className="flex items-center gap-2 border-b border-sand px-5 py-4 sm:px-6">
        <Bell className="h-4 w-4 text-amber-dark" aria-hidden="true" />
        <h2 className="font-heading text-xl font-semibold text-warm-dark">
          Alerts history
        </h2>
      </header>
      {alerts.length > 0 ? (
        <ul className="divide-y divide-sand">
          {alerts.map((alert) => {
            const presentation = alertPresentation(alert);
            return (
              <li className="p-5 sm:p-6" key={alert.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold",
                          toneClasses(presentation.tone)
                        )}
                      >
                        {presentation.label}
                      </span>
                      {!alert.readAt ? (
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-dark">
                          New
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-3 font-heading text-lg font-semibold text-warm-dark">
                      {portalCopy(alert.title)}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-warm-mid">
                      {portalCopy(alert.message)}
                    </p>
                  </div>
                  <time
                    className="shrink-0 font-mono text-[10px] text-warm-gray"
                    dateTime={alert.createdAt}
                  >
                    {formatDate(alert.createdAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-6 py-12 text-center">
          <CheckCircle2
            className="mx-auto h-8 w-8 text-success"
            aria-hidden="true"
          />
          <h3 className="mt-3 font-heading text-lg font-semibold text-warm-dark">
            No active alerts
          </h3>
          <p className="mt-1 text-sm text-warm-mid">
            GEIA will flag a meaningful FMCSA change here when one appears.
          </p>
        </div>
      )}
    </PortalMotionSection>
  );
}

function CaseTimeline({ caseRow }: { caseRow: PortalProgressCase }) {
  if (caseRow.filedDate && !caseRow.decisionDate && ["filed", "pending", "pending_state", "pending_fmcsa"].includes(caseRow.status)) {
    if (caseRow.caseType === "cpdp") return <>Filed {formatDate(caseRow.filedDate)} · FMCSA currently reports about 90 days on average for review; this is not a deadline.</>;
    return <>Filed {formatDate(caseRow.filedDate)} · {caseRow.responseDeadline ? `Recorded response deadline ${formatDate(caseRow.responseDeadline)}` : "Determination date not recorded"}</>;
  }
  if (caseRow.decisionDate) {
    return <>Decision {formatDate(caseRow.decisionDate)}</>;
  }
  if (caseRow.filedDate) {
    return <>Filed {formatDate(caseRow.filedDate)}</>;
  }
  return <>{isWin(caseRow) ? "Decision date not recorded" : "GEIA is preparing the next step"}</>;
}

function isWin(row: PortalProgressCase) { return row.outcome === "not_preventable" || row.outcome === "approved" || row.status === "approved"; }
function isFiled(row: PortalProgressCase) { return !!row.filedDate && !row.decisionDate && ["filed", "pending", "pending_state", "pending_fmcsa", "reconsidering"].includes(row.status); }

async function CasesSection({ promise, group }: { promise: Promise<PortalProgressCase[]>; group: "wins" | "progress" | "other" }) {
  const allCases = await promise;
  const cases = allCases.filter(row => group === "wins" ? isWin(row) : group === "progress" ? !isWin(row) && isFiled(row) : !isWin(row) && !isFiled(row));
  const title = group === "wins" ? "Wins" : group === "progress" ? "In progress" : "Preparation and other decisions";
  return (
    <PortalMotionSection
      interactive
      id={group === "progress" ? "cases" : group}
      className="scroll-mt-28 overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm"
    >
      <header className="border-b border-sand px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-amber-dark" aria-hidden="true" />
          <h2 className="font-heading text-xl font-semibold text-warm-dark">
            {title}
          </h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-warm-mid">
          DataQ record reviews and crash-preventability filings GEIA is
          handling for you.
        </p>
        <p className="mt-2 text-xs leading-5 text-warm-gray">
          Only genuine data errors and crash-preventability are challengeable.
        </p>
      </header>
      {cases.length > 0 ? (
        <ul className="divide-y divide-sand">
          {cases.map((caseRow, index) => {
            const status = caseStatus(caseRow);
            const outcome = outcomePresentation(caseRow.outcome);
            return (
              <PortalMotionListItem
                interactive
                className="p-5 sm:p-6"
                delay={Math.min(index * 0.05, 0.2)}
                key={`${caseRow.caseType}-${caseRow.id}`}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-info-light px-2.5 py-1 font-mono text-[10px] font-semibold text-info">
                        {caseRow.caseType === "dataq"
                          ? "DataQ record review"
                          : "Crash Preventability"}
                      </span>
                      {caseRow.caseNumber ? (
                        <span className="font-mono text-[10px] text-warm-gray">
                          Case {caseRow.caseNumber}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-3 font-heading text-lg font-semibold text-warm-dark">
                      {portalCopy(caseRow.title)}
                    </h3>
                    {caseRow.detail ? (
                      <p className="mt-1 text-xs text-warm-gray">
                        {portalCopy(caseRow.detail)}
                      </p>
                    ) : null}
                    {group === "wins" && <p className="mt-3 text-sm leading-6 text-warm-mid">{caseRow.outcome === "not_preventable" ? <>FMCSA excludes crashes with this determination from Crash Indicator scoring; the crash remains visible on the public record. <a className="inline-flex min-h-11 items-center underline" href="https://www.fmcsa.dot.gov/safety/crash-preventability-determination-program-faqs" target="_blank" rel="noreferrer">How this determination works</a></> : "The record review was approved. The exact correction and points removed are not recorded in this view."}</p>}
                    <p className="mt-3 font-mono text-[11px] text-warm-mid">
                      <CaseTimeline caseRow={caseRow} />
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 md:max-w-52 md:justify-end">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold",
                        toneClasses(status.tone)
                      )}
                    >
                      {status.label}
                    </span>
                    {outcome ? (
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold",
                          toneClasses(outcome.tone)
                        )}
                      >
                        {outcome.label}
                      </span>
                    ) : null}
                  </div>
                </div>
              </PortalMotionListItem>
            );
          })}
        </ul>
      ) : (
        <div className="px-6 py-12 text-center">
          <CheckCircle2
            className="mx-auto h-8 w-8 text-success"
            aria-hidden="true"
          />
          <h3 className="mt-3 font-heading text-lg font-semibold text-warm-dark">
            {group === "wins" ? "No favorable determinations recorded yet" : group === "progress" ? "No filed cases awaiting a decision" : "No other case activity on file"}
          </h3>
          <p className="mt-1 text-sm text-warm-mid">
            GEIA opens a filing only for a genuine data error or an eligible
            crash-preventability review.
          </p>
        </div>
      )}
      {group === "progress" && allCases.some(row => !isWin(row) && !isFiled(row)) && <details className="border-t border-sand p-5"><summary className="min-h-11 cursor-pointer font-heading text-warm-dark">Preparation and other decisions</summary><CasesSection promise={promise} group="other" /></details>}
    </PortalMotionSection>
  );
}

function CasesUpgradeNote() {
  const minimumTier = minimumTierForFeature("case_visibility");
  return (
    <PortalMotionSection className="rounded-xl border border-sand bg-warm-white p-6 text-center shadow-sm">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-subtle text-amber-dark">
        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
      </div>
      <h2 className="mt-3 font-heading text-lg font-semibold text-warm-dark">
        Case activity is not included in your plan
      </h2>
      <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-warm-mid">
        Case status and filing progress are included with{" "}
        {TIER_LABELS[minimumTier]} and higher plans.
      </p>
    </PortalMotionSection>
  );
}

async function ActivityHeroMetric({
  promise,
}: {
  promise: Promise<PortalActivitySnapshot[]>;
}) {
  const snapshots = await promise;
  const latest = snapshots[snapshots.length - 1] ?? null;
  if (!latest) return null;

  return (
    <dl className="mt-7 inline-flex items-end gap-3 rounded-xl border border-gold/20 bg-warm-white/5 px-5 py-4">
      <div>
        <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-warm-white/70">
          Latest
        </dt>
        <dd className="mt-1 font-mono text-4xl font-semibold text-amber-light">
          <PortalAnimatedNumber value={latest.totalPoints} />
        </dd>
      </div>
    </dl>
  );
}

export default async function PortalActivityPage() {
  const access = await getPortalPageAccess("trend_history");
  if (!access.allowed) {
    return (
      <div className="overflow-hidden">
        <PortalHeroBand
          eyebrow="Monitoring record"
          title="What we've done for you"
          description="Follow your violation burden, recorded results, and the work GEIA is doing for you."
        />
        <PortalSectionDivider transition="navy-to-warm" />
        <PortalPageBody>
          <PortalReveal>
            <TierUpgradeNote
              currentTier={access.tier}
              feature="trend_history"
              headingLevel="h2"
              title="Progress history is not included in your plan"
            />
          </PortalReveal>
        </PortalPageBody>
        <PortalSectionDivider transition="warm-to-navy" />
        <PortalFooterBand>
          <p className="font-heading text-xl font-semibold tracking-tight text-warm-white">
            {access.clientName}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-warm-white/75">
            <span>USDOT {access.dotNumber}</span>
            <span>
              {access.mcNumber
                ? `MC ${access.mcNumber.replace(/^MC-?/i, "")}`
                : "MC not recorded"}
            </span>
          </div>
        </PortalFooterBand>
      </div>
    );
  }

  const snapshotsPromise = loadPortalActivitySnapshots(access.clientId);
  const alertsPromise = loadPortalActivityAlerts(access.clientId);
  const canSeeCases = tierHasFeature(access.tier, "case_visibility");
  const casesPromise = canSeeCases
    ? loadPortalProgressCases(access.clientId)
    : null;

  return (
    <div className="overflow-hidden">
      <PortalHeroBand
        eyebrow="Monitoring record"
        title="What we've done for you"
        description="Follow your violation burden, recorded results, and the work GEIA is doing for you."
      >
        <Suspense
          fallback={
            <div
              aria-label="Loading latest violation burden"
              className="mt-7 flex h-20 w-32 items-center justify-center rounded-xl border border-gold/15 bg-warm-white/5"
              role="status"
            >
              <GoldenEraTruckLoader compact />
            </div>
          }
        >
          <ActivityHeroMetric promise={snapshotsPromise} />
        </Suspense>
      </PortalHeroBand>
      <PortalSectionDivider transition="navy-to-warm" />

      <PortalPageBody contentClassName="space-y-12 py-12 sm:py-16 lg:py-16">
        <Suspense fallback={<SectionFallback label="violation burden trend" rows={4} />}>
          <TrendSection promise={snapshotsPromise} />
        </Suspense>



        {casesPromise ? (
          <Suspense
            fallback={<SectionFallback label="case activity" rows={4} />}
          >
            <CasesSection promise={casesPromise} group="wins" />
            <CasesSection promise={casesPromise} group="progress" />
          </Suspense>
        ) : (
          <CasesUpgradeNote />
        )}
        <Suspense fallback={<SectionFallback label="alerts" />}>
          <AlertsSection promise={alertsPromise} />
        </Suspense>
      </PortalPageBody>

      <PortalSectionDivider transition="warm-to-navy" />
      <PortalFooterBand>
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-heading text-xl font-semibold tracking-tight text-warm-white">
              {access.clientName}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-warm-white/75">
            <span>USDOT {access.dotNumber}</span>
            <span>
              {access.mcNumber
                ? `MC ${access.mcNumber.replace(/^MC-?/i, "")}`
                : "MC not recorded"}
            </span>
          </div>
        </div>
      </PortalFooterBand>
    </div>
  );
}
