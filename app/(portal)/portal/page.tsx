import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileClock,
  Minus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { BurdenSparkline } from "@/components/portal/burden-sparkline";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import {
  buildChangeNarrative,
  inWindowViolationCount,
  portalCaseStatus,
  pressureLevel,
  pressureWidth,
  snapshotDeltaLabel,
  type PortalHomeAuthority,
  type PortalHomeCase,
  type PortalHomeRequest,
  type PortalHomeSnapshot,
} from "@/lib/portal/home";
import {
  loadPortalHomeAuthority,
  loadPortalHomeHandling,
  loadPortalHomeRequests,
  loadPortalHomeSnapshots,
} from "@/lib/portal/home-server";
import { loadPortalContext } from "@/lib/portal/access";
import { tierHasFeature } from "@/lib/tiers";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "Date pending";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${
    count === 1 ? singular : pluralForm
  }`;
}

function pressureClasses(level: ReturnType<typeof pressureLevel>) {
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

function deltaClasses(
  latest: PortalHomeSnapshot,
  previous: PortalHomeSnapshot | null
) {
  if (!previous || latest.total_points === previous.total_points) {
    return {
      className: "bg-info-light text-info",
      Icon: Minus,
    };
  }
  if (latest.total_points < previous.total_points) {
    return {
      className: "bg-success-light text-success",
      Icon: TrendingDown,
    };
  }
  return {
    className: "bg-amber-subtle text-amber-dark",
    Icon: TrendingUp,
  };
}

function UnlinkedPortalHome() {
  return (
    <section className="mx-auto flex min-h-96 max-w-xl flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-subtle text-amber">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
        Your account is being set up
      </h1>
      <p className="mt-2 text-sm leading-6 text-warm-mid">
        Your GEIA account manager is linking your company profile. Your Home
        page will appear here as soon as that connection is complete.
      </p>
    </section>
  );
}

function SectionFallback({ label }: { label: string }) {
  return (
    <section
      aria-label={`Loading ${label}`}
      className="space-y-4 rounded-xl border border-sand bg-warm-white p-6 shadow-sm motion-safe:animate-pulse"
      role="status"
    >
      <div className="h-6 w-52 rounded-md bg-sand" />
      <div className="h-16 rounded-lg bg-cream" />
      <div className="h-16 rounded-lg bg-cream" />
      <span className="sr-only">Loading {label}…</span>
    </section>
  );
}

function CaseCard({ caseRow }: { caseRow: PortalHomeCase }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sand bg-cream p-4">
      <div>
        <p className="font-heading text-base font-semibold text-warm-dark">
          {caseRow.caseType}{" "}
          <span className="font-mono text-sm">
            {caseRow.caseNumber ?? "number pending"}
          </span>
        </p>
        <p className="mt-1 text-xs text-warm-gray">
          {caseRow.filedDate
            ? `Filed ${formatDate(caseRow.filedDate)}`
            : "GEIA is preparing the next step"}
        </p>
      </div>
      <span className="rounded-full bg-info-light px-3 py-1 font-mono text-[11px] font-semibold text-info">
        {portalCaseStatus(caseRow.status)}
      </span>
    </li>
  );
}

async function HandlingSection({
  promise,
  canSeeCases,
}: {
  promise: ReturnType<typeof loadPortalHomeHandling>;
  canSeeCases: boolean;
}) {
  const handling = await promise;
  return (
    <section className="rounded-xl border border-sand bg-warm-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono-label text-amber">Active service</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-warm-dark">
            What GEIA is handling
          </h2>
        </div>
        {canSeeCases && handling.cases.length > 0 ? (
          <Link
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-amber-dark transition-colors hover:bg-amber-subtle hover:text-amber-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            href="/portal/activity#cases"
          >
            View case activity
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>

      {canSeeCases ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <div>
            <h3 className="font-heading text-base font-semibold text-warm-dark">
              Open filings
            </h3>
            {handling.cases.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {handling.cases.map((caseRow) => (
                  <CaseCard caseRow={caseRow} key={caseRow.id} />
                ))}
              </ul>
            ) : (
              <div className="mt-3 rounded-lg border border-sand bg-cream p-5">
                <p className="font-heading text-base font-semibold text-warm-dark">
                  No filing is waiting on FMCSA
                </p>
                <p className="mt-1 text-sm text-warm-mid">
                  We will open a case only when the record supports a genuine
                  data-error or crash-preventability challenge.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-amber/25 bg-amber-subtle p-5">
            <div className="flex items-center gap-2 text-amber-dark">
              <FileClock className="h-4 w-4" />
              <h3 className="font-heading font-semibold">
                Evidence investigation
              </h3>
            </div>
            <p className="mt-4 font-mono text-3xl font-semibold text-warm-dark">
              {handling.investigateQueue.weightedPoints.toLocaleString("en-US")}
              <span className="ml-2 text-sm font-medium text-warm-mid">
                pts
              </span>
            </p>
            <p className="mt-1 text-sm text-warm-mid">
              Across{" "}
              {plural(
                handling.investigateQueue.violationCount,
                "violation"
              )}{" "}
              while evidence is pending.
            </p>
            <p className="mt-4 border-t border-amber/20 pt-4 text-xs leading-5 text-warm-mid">
              Only genuine data errors and crash-preventability are
              challengeable. Under investigation means evidence is still
              needed; it does not mean a violation is removable.
            </p>
          </div>
        </div>
      ) : null}

      <div className={cn("mt-6", canSeeCases && "border-t border-sand pt-6")}>
        <h3 className="font-heading text-base font-semibold text-warm-dark">
          Latest work notes
        </h3>
        {handling.workNotes.length > 0 ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-3">
            {handling.workNotes.map((note) => (
              <li
                className="rounded-lg border border-sand bg-cream p-4"
                key={note.id}
              >
                <p className="text-sm leading-6 text-warm-mid">{note.text}</p>
                <p className="mt-3 font-mono text-[11px] text-warm-gray">
                  {formatDate(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-warm-mid">
            Your first service update will appear after GEIA completes account
            work.
          </p>
        )}
      </div>
    </section>
  );
}

async function RequestsSection({
  promise,
}: {
  promise: ReturnType<typeof loadPortalHomeRequests>;
}) {
  const requests = await promise;
  if (requests.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber/25 bg-amber-subtle p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warm-white text-amber-dark">
          <ClipboardList className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="mono-label text-amber-dark">Action requested</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-warm-dark">
            Needed from you
          </h2>
          <ul className="mt-4 space-y-3">
            {requests.map((request: PortalHomeRequest) => (
              <li
                className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-amber/20 bg-warm-white p-4"
                key={request.id}
              >
                <div className="max-w-2xl">
                  <p className="font-heading font-semibold text-warm-dark">
                    {request.title}
                  </p>
                  {request.description ? (
                    <p className="mt-1 text-sm leading-6 text-warm-mid">
                      {request.description}
                    </p>
                  ) : null}
                  {request.dueAt ? (
                    <p className="mt-2 font-mono text-[11px] text-warm-gray">
                      Due {formatDate(request.dueAt)}
                    </p>
                  ) : null}
                </div>
                <Link
                  className="inline-flex items-center gap-2 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-warm-white transition-colors hover:bg-amber-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
                  href="/portal/documents#needed-from-you"
                >
                  Review request
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

async function CarrierIdentityFooter({
  promise,
  clientName,
  dotNumber,
  mcNumber,
}: {
  promise: Promise<PortalHomeAuthority | null>;
  clientName: string;
  dotNumber: string;
  mcNumber: string | null;
}) {
  const authority = await promise;
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sand bg-warm-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="font-heading font-semibold text-warm-dark">{clientName}</p>
        <p className="font-mono text-xs text-warm-mid">USDOT {dotNumber}</p>
        <p className="font-mono text-xs text-warm-mid">
          {mcNumber ? `MC ${mcNumber.replace(/^MC-?/i, "")}` : "MC not recorded"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "rounded-full px-3 py-1 font-mono text-[11px] font-semibold",
            authority?.active
              ? "bg-success-light text-success"
              : "bg-amber-subtle text-amber-dark"
          )}
        >
          {authority?.label ?? "Authority status unavailable"}
        </span>
        {authority ? (
          <span className="text-xs text-warm-gray">
            {authority.sourceLabel} · checked {formatDate(authority.fetchedAt)}
          </span>
        ) : null}
      </div>
    </footer>
  );
}

export default async function PortalHomePage() {
  const context = await loadPortalContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status === "forbidden") return null;
  if (context.status === "unlinked") return <UnlinkedPortalHome />;

  const canSeeTrend = tierHasFeature(context.tier, "trend_history");
  const canSeeServiceActivity = tierHasFeature(
    context.tier,
    "monitoring_alerts"
  );
  const snapshotPromise = loadPortalHomeSnapshots({
    clientId: context.clientId,
    includeHistory: canSeeTrend,
  });
  const handlingPromise = canSeeServiceActivity
    ? loadPortalHomeHandling({
        clientId: context.clientId,
        tier: context.tier,
        snapshotPromise,
      })
    : null;
  const requestsPromise = loadPortalHomeRequests({
    clientId: context.clientId,
    tier: context.tier,
  });
  const authorityPromise = loadPortalHomeAuthority(context.clientId);

  const snapshots = await snapshotPromise;
  const latest = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;
  const delta = latest ? deltaClasses(latest, previous) : null;
  const trendValues = [...snapshots]
    .reverse()
    .map((snapshot) => snapshot.total_points);
  const pressureBasics = latest?.per_basic ?? [];
  const inWindowCount = latest ? inWindowViolationCount(latest) : 0;
  const changeNarrative = canSeeTrend
    ? buildChangeNarrative(latest, previous)
    : [];
  const canSeeCases = tierHasFeature(context.tier, "case_visibility");

  return (
    <div className="space-y-12 pb-8">
      <section className="grid overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm lg:grid-cols-[1.05fr_0.95fr]">
        <div className="p-6 sm:p-8 lg:p-10">
          <p className="mono-label text-amber">Where you stand</p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <h1 className="font-heading text-7xl font-semibold tracking-tight text-warm-dark sm:text-8xl">
              <span className="sr-only">Current weighted burden: </span>
              {latest?.total_points.toLocaleString("en-US") ?? "—"}
            </h1>
            <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-warm-gray">
              weighted points
            </p>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canSeeTrend && latest && delta ? (
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-xs font-semibold",
                  delta.className
                )}
              >
                <delta.Icon className="h-3.5 w-3.5" />
                {snapshotDeltaLabel(latest, previous)}
              </span>
            ) : canSeeTrend ? (
              <span className="rounded-full bg-info-light px-3 py-1.5 font-mono text-xs font-semibold text-info">
                First snapshot pending
              </span>
            ) : (
              <span className="rounded-full bg-info-light px-3 py-1.5 font-mono text-xs font-semibold text-info">
                Current diagnostic
              </span>
            )}
            <span className="inline-flex items-center gap-2 text-xs text-warm-gray">
              <CalendarClock className="h-3.5 w-3.5" />
              {latest
                ? `As of ${formatDate(latest.snapshot_date)}`
                : "As-of date pending"}
            </span>
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-warm-mid">
            FMCSA publishes no percentiles for low-volume carriers; this is the
            weighted burden driving the BASIC measures.
          </p>
        </div>

        <div className="flex flex-col justify-center border-t border-sand bg-cream p-6 sm:p-8 lg:border-l lg:border-t-0">
          {canSeeTrend ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <p className="font-heading font-semibold text-warm-dark">
                  Burden trend
                </p>
                <p className="font-mono text-[11px] text-warm-gray">
                  {plural(snapshots.length, "snapshot")}
                </p>
              </div>
              <div className="mt-4">
                <BurdenSparkline
                  label={`Weighted burden across ${plural(
                    snapshots.length,
                    "snapshot"
                  )}`}
                  values={trendValues}
                />
              </div>
              {snapshots.length > 1 ? (
                <div className="mt-2 flex justify-between font-mono text-[10px] text-warm-gray">
                  <span>
                    {formatDate(
                      snapshots[snapshots.length - 1]!.snapshot_date
                    )}
                  </span>
                  <span>{formatDate(snapshots[0]!.snapshot_date)}</span>
                </div>
              ) : null}
            </>
          ) : (
            <div>
              <p className="mono-label text-info">Assessment view</p>
              <h2 className="mt-2 font-heading text-xl font-semibold text-warm-dark">
                Current diagnostic snapshot
              </h2>
              <p className="mt-3 text-sm leading-6 text-warm-mid">
                This one-time assessment shows the current 24-month record.
                Ongoing change history begins with Monitor.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-sand bg-warm-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono-label text-amber">24-month scoring window</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-warm-dark">
              BASIC pressure
            </h2>
          </div>
          {latest ? (
            <p className="text-sm text-warm-mid">
              {plural(inWindowCount, "violation")} in the 24-month scoring
              window · {latest.violation_count.toLocaleString("en-US")} on file
            </p>
          ) : null}
        </div>

        {latest && pressureBasics.length > 0 ? (
          <div className="mt-7 space-y-5">
            {pressureBasics.map((basic) => {
              const level = pressureLevel(
                basic.weighted_points,
                latest.total_points
              );
              const classes = pressureClasses(level);
              return (
                <div key={basic.basic_category}>
                  <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(12rem,1.6fr)_auto] sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading font-semibold text-warm-dark">
                        {BASIC_LABELS[basic.basic_category] ??
                          basic.basic_category.replaceAll("_", " ")}
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
                    <div className="h-2.5 overflow-hidden rounded-full bg-sand">
                      <div
                        aria-label={`${pressureWidth(
                          basic.weighted_points,
                          latest.total_points
                        )}% of current weighted burden`}
                        className={cn("h-full rounded-full", classes.bar)}
                        style={{
                          width: `${pressureWidth(
                            basic.weighted_points,
                            latest.total_points
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="font-mono text-xs text-warm-mid sm:text-right">
                      {basic.weighted_points.toLocaleString("en-US")} pts ·{" "}
                      {plural(basic.violation_count, "violation")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-sand bg-cream px-6 py-10 text-center">
            <p className="font-heading text-lg font-semibold text-warm-dark">
              Your first BASIC snapshot is being prepared
            </p>
            <p className="mt-1 text-sm text-warm-mid">
              GEIA will show each active pressure area once the first monitoring
              snapshot is available.
            </p>
          </div>
        )}
      </section>

      {canSeeServiceActivity && handlingPromise ? (
        <Suspense fallback={<SectionFallback label="GEIA work" />}>
          <HandlingSection
            canSeeCases={canSeeCases}
            promise={handlingPromise}
          />
        </Suspense>
      ) : null}

      <Suspense fallback={<SectionFallback label="requests" />}>
        <RequestsSection promise={requestsPromise} />
      </Suspense>

      {canSeeTrend ? (
        <section className="rounded-xl border border-sand bg-warm-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-light text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="mono-label text-success">Latest snapshot</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-warm-dark">
                What&apos;s changed
              </h2>
            </div>
          </div>
          <div className="mt-5 max-w-4xl space-y-3 text-sm leading-7 text-warm-mid">
            {changeNarrative.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        </section>
      ) : null}

      <Suspense fallback={<SectionFallback label="carrier identity" />}>
        <CarrierIdentityFooter
          clientName={context.clientName}
          dotNumber={context.dotNumber}
          mcNumber={context.mcNumber}
          promise={authorityPromise}
        />
      </Suspense>
    </div>
  );
}
