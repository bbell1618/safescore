import { Suspense } from "react";
import {
  Bell,
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
} from "lucide-react";
import { BurdenHistoryChart } from "@/components/portal/burden-history-chart";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { cpdpFiledTimelineLabel } from "@/lib/cases/presentation";
import {
  loadPortalActivityAlerts,
  loadPortalActivityCases,
  loadPortalActivitySnapshots,
  type PortalActivityAlert,
  type PortalActivityCase,
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

function caseStatus(caseRow: PortalActivityCase): {
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
      tone: "success",
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
      className="space-y-4 rounded-xl border border-sand bg-warm-white p-6 shadow-sm motion-safe:animate-pulse"
      role="status"
    >
      <div className="h-6 w-44 rounded-md bg-sand" />
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="h-16 rounded-lg border border-sand bg-cream"
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
    <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label text-amber">Complete history</p>
          <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
            Burden trend
          </h2>
          <p className="mt-2 text-sm leading-6 text-warm-mid">
            Every stored check stays in the record, including temporary spikes.
          </p>
        </div>
        {latest ? (
          <dl className="text-right">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
              Latest
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
    </section>
  );
}

async function AlertsSection({
  promise,
}: {
  promise: Promise<PortalActivityAlert[]>;
}) {
  const alerts = await promise;
  return (
    <section className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-sand px-5 py-4 sm:px-6">
        <Bell className="h-4 w-4 text-amber-dark" aria-hidden="true" />
        <h2 className="font-heading text-xl font-semibold text-warm-dark">
          Alerts
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
                      {alert.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-warm-mid">
                      {alert.message}
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
    </section>
  );
}

function CaseTimeline({ caseRow }: { caseRow: PortalActivityCase }) {
  if (
    caseRow.caseType === "cpdp" &&
    ["filed", "pending"].includes(caseRow.status)
  ) {
    const label = cpdpFiledTimelineLabel(caseRow.filedDate);
    if (label) return <>{label}</>;
  }
  if (caseRow.decisionDate) {
    return <>Decision {formatDate(caseRow.decisionDate)}</>;
  }
  if (caseRow.filedDate) {
    return <>Filed {formatDate(caseRow.filedDate)}</>;
  }
  return <>GEIA is preparing the next step</>;
}

async function CasesSection({
  promise,
}: {
  promise: Promise<PortalActivityCase[]>;
}) {
  const cases = await promise;
  return (
    <section
      id="cases"
      className="scroll-mt-28 overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm"
    >
      <header className="border-b border-sand px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-amber-dark" aria-hidden="true" />
          <h2 className="font-heading text-xl font-semibold text-warm-dark">
            Case activity
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
          {cases.map((caseRow) => {
            const status = caseStatus(caseRow);
            const outcome = outcomePresentation(caseRow.outcome);
            return (
              <li className="p-5 sm:p-6" key={`${caseRow.caseType}-${caseRow.id}`}>
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
                      {caseRow.title}
                    </h3>
                    {caseRow.detail ? (
                      <p className="mt-1 text-xs text-warm-gray">
                        {caseRow.detail}
                      </p>
                    ) : null}
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
            No case activity on file
          </h3>
          <p className="mt-1 text-sm text-warm-mid">
            GEIA opens a filing only for a genuine data error or an eligible
            crash-preventability review.
          </p>
        </div>
      )}
    </section>
  );
}

function CasesUpgradeNote() {
  const minimumTier = minimumTierForFeature("case_visibility");
  return (
    <section className="rounded-xl border border-sand bg-warm-white p-6 text-center shadow-sm">
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
    </section>
  );
}

export default async function PortalActivityPage() {
  const access = await getPortalPageAccess("trend_history");
  if (!access.allowed) {
    return (
      <TierUpgradeNote
        currentTier={access.tier}
        feature="trend_history"
        title="Activity history is not included in your plan"
      />
    );
  }

  const snapshotsPromise = loadPortalActivitySnapshots(access.clientId);
  const alertsPromise = loadPortalActivityAlerts(access.clientId);
  const canSeeCases = tierHasFeature(access.tier, "case_visibility");
  const casesPromise = canSeeCases
    ? loadPortalActivityCases(access.clientId)
    : null;

  return (
    <div className="space-y-12 pb-8">
      <header>
        <p className="mono-label text-amber">Monitoring record</p>
        <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight text-warm-dark sm:text-5xl">
          Activity
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-warm-mid">
          See how your weighted burden has moved, what changed, and where each
          filing stands.
        </p>
      </header>

      <Suspense fallback={<SectionFallback label="burden trend" rows={4} />}>
        <TrendSection promise={snapshotsPromise} />
      </Suspense>

      <div className="space-y-12">
        <Suspense fallback={<SectionFallback label="alerts" />}>
          <AlertsSection promise={alertsPromise} />
        </Suspense>

        {casesPromise ? (
          <Suspense fallback={<SectionFallback label="case activity" rows={4} />}>
            <CasesSection promise={casesPromise} />
          </Suspense>
        ) : (
          <CasesUpgradeNote />
        )}
      </div>
    </div>
  );
}
