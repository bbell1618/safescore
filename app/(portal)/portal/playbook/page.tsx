import { Suspense } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Sparkles,
} from "lucide-react";
import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import {
  PortalAnimatedNumber,
  PortalMotionArticle,
  PortalMotionListItem,
  PortalMotionSection,
  PortalReveal,
} from "@/components/portal/motion";
import { GoldenEraTruckLoader } from "@/components/portal/truck-loader";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { getPortalPageAccess } from "@/lib/portal/access";
import {
  loadLatestPortalPlaybook,
  type PortalPlaybook,
} from "@/lib/portal/playbook-server";

export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  const parsed = new Date(
    value.includes("T") ? value : `${value}T00:00:00Z`
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: value.includes("T") ? "America/Los_Angeles" : "UTC",
  });
}

function rateLabel(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function EmptyPlaybook() {
  return (
    <PortalMotionSection className="rounded-xl border border-sand bg-warm-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-subtle text-amber-dark">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-heading text-xl font-semibold tracking-tight text-warm-dark">
        Your coaching playbook is being prepared
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-warm-mid">
        GEIA will turn the patterns in your safety record into short operating
        habits and a practical month-by-month plan.
      </p>
    </PortalMotionSection>
  );
}

function PlaybookBodyFallback() {
  return (
    <div
      aria-label="Loading coaching playbook"
      className="space-y-8"
      role="status"
    >
      <GoldenEraTruckLoader compact className="mx-auto" />
      <section className="space-y-4 rounded-xl border border-sand bg-warm-white p-6 shadow-sm motion-safe:animate-pulse">
        <div className="h-5 w-48 rounded-md bg-sand" />
        <div className="h-4 w-full max-w-3xl rounded-md bg-sand" />
        <div className="h-4 w-4/5 max-w-2xl rounded-md bg-sand" />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <section
            className="space-y-4 rounded-xl border border-sand bg-warm-white p-6 shadow-sm motion-safe:animate-pulse"
            key={index}
          >
            <div className="h-6 w-44 rounded-md bg-sand" />
            <div className="grid grid-cols-3 gap-3">
              <div className="h-14 rounded-lg bg-cream" />
              <div className="h-14 rounded-lg bg-cream" />
              <div className="h-14 rounded-lg bg-cream" />
            </div>
            <div className="h-4 w-full rounded-md bg-sand" />
            <div className="h-4 w-5/6 rounded-md bg-sand" />
          </section>
        ))}
      </div>
      <span className="sr-only">Loading coaching playbook…</span>
    </div>
  );
}

function FamilyProgramCard({
  program,
  index,
}: {
  program: PortalPlaybook["family_programs"][number];
  index: number;
}) {
  return (
    <PortalMotionListItem
      interactive
      className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm"
      delay={Math.min(index * 0.04, 0.2)}
    >
      <article>
        <header className="border-b border-sand bg-cream p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="mono-label text-amber-dark">Focus {index + 1}</p>
              <h3 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
                {program.familyName}
              </h3>
              <p className="mt-2 text-sm leading-6 text-warm-mid">
                {program.introduction}
              </p>
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
          <p className="mt-3 font-mono text-[10px] text-warm-gray">
            New-violation rate uses the latest {program.trailingWindowDays}-day
            window.
          </p>
        </header>

        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
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
              <ul className="mt-3 space-y-2.5">
                {program.program.map((step) => (
                  <li
                    className="flex gap-2.5 text-sm leading-6 text-warm-mid"
                    key={step}
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
                {program.workingWhen.map((signal) => (
                  <li
                    className="text-sm leading-6 text-warm-mid"
                    key={signal}
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
              <ul className="mt-3 space-y-2">
                {program.installments.map((installment) => (
                  <li
                    className="text-sm leading-6 text-warm-mid"
                    key={installment}
                  >
                    {installment}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </article>
    </PortalMotionListItem>
  );
}

function InstallmentCalendar({
  playbook,
}: {
  playbook: PortalPlaybook;
}) {
  return (
    <PortalMotionSection>
      <div>
        <p className="mono-label text-amber">One step at a time</p>
        <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
          Your 12-month installment plan
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-warm-mid">
          Work the plan in order. Each month adds one manageable operating
          habit and reinforces what came before.
        </p>
      </div>
      <ol className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {playbook.installment_calendar.map((installment, index) => (
          <PortalMotionListItem
            interactive
            className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm"
            delay={Math.min(index * 0.035, 0.18)}
            key={installment.month}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-subtle font-mono text-sm font-semibold text-amber-dark">
                {installment.month}
              </span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
                  Month {installment.month}
                </p>
                <h3 className="mt-1 font-heading font-semibold text-warm-dark">
                  {installment.title}
                </h3>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-warm-mid">
              {installment.objective}
            </p>
            <ul className="mt-4 space-y-2 border-t border-sand pt-4">
              {installment.deliverables.map((deliverable) => (
                <li
                  className="flex gap-2 text-xs leading-5 text-warm-mid"
                  key={deliverable}
                >
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>{deliverable}</span>
                </li>
              ))}
            </ul>
          </PortalMotionListItem>
        ))}
      </ol>
    </PortalMotionSection>
  );
}

function OwnerCurriculum({ playbook }: { playbook: PortalPlaybook }) {
  return (
    <PortalMotionSection>
      <div>
        <p className="mono-label text-amber">Owner curriculum</p>
        <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
          Four habits that support every program
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-warm-mid">
          These short modules give you the management rhythm behind the
          day-to-day coaching work.
        </p>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {playbook.owner_curriculum.map((module, index) => (
          <PortalMotionArticle
            interactive
            className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6"
            delay={Math.min(index * 0.06, 0.18)}
            key={module.key}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="rounded-full bg-info-light px-2.5 py-1 font-mono text-[10px] font-semibold text-info">
                  {module.key}
                </span>
                <h3 className="mt-3 font-heading text-xl font-semibold tracking-tight text-warm-dark">
                  {module.title}
                </h3>
              </div>
              <span className="rounded-full border border-sand bg-cream px-3 py-1 font-mono text-[10px] text-warm-mid">
                {module.installment}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-warm-mid">
              {module.content}
            </p>
            <ul className="mt-5 space-y-2 border-t border-sand pt-4">
              {module.deliverables.map((deliverable) => (
                <li
                  className="flex gap-2 text-xs leading-5 text-warm-mid"
                  key={deliverable}
                >
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>{deliverable}</span>
                </li>
              ))}
            </ul>
          </PortalMotionArticle>
        ))}
      </div>
    </PortalMotionSection>
  );
}

async function PlaybookContent({
  promise,
}: {
  promise: Promise<PortalPlaybook | null>;
}) {
  const playbook = await promise;
  if (!playbook) return <EmptyPlaybook />;

  return (
    <>
      <PortalMotionSection
        interactive
        className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-amber-dark">
              <Gauge className="h-4 w-4" aria-hidden="true" />
              <p className="mono-label">Current coaching plan</p>
            </div>
            <p className="mt-3 text-sm leading-6 text-warm-mid">
              Your playbook turns the patterns in your safety record into
              focused routines. Take one installment at a time, record what
              gets done, and watch the rate of new violations.
            </p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-3">
            <div className="rounded-lg border border-sand bg-cream px-4 py-3">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
                Programs
              </dt>
              <dd className="mt-1 font-mono text-2xl font-semibold text-warm-dark">
                {playbook.family_programs.length}
              </dd>
            </div>
            <div className="rounded-lg border border-sand bg-cream px-4 py-3">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-warm-gray">
                Record as of
              </dt>
              <dd className="mt-1 font-mono text-xs font-semibold text-warm-dark">
                {formatDate(playbook.source_as_of)}
              </dd>
            </div>
          </dl>
        </div>
        <p className="mt-4 border-t border-sand pt-4 font-mono text-[10px] text-warm-gray">
          Updated {formatDate(playbook.generated_at)}
        </p>
      </PortalMotionSection>

      <PortalMotionSection>
        <div>
          <p className="mono-label text-amber">Your focus areas</p>
          <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-warm-dark">
            Coaching programs
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-warm-mid">
            The strongest recurring patterns come first. Each program connects
            the live record to a short set of operating changes.
          </p>
        </div>
        {playbook.family_programs.length > 0 ? (
          <ol className="mt-6 space-y-6">
            {playbook.family_programs.map((program, index) => (
              <FamilyProgramCard
                index={index}
                key={program.familyKey}
                program={program}
              />
            ))}
          </ol>
        ) : (
          <PortalReveal>
            <div className="mt-6 rounded-xl border border-sand bg-warm-white p-8 text-center shadow-sm">
              <p className="font-heading text-lg font-semibold text-warm-dark">
                No recurring coaching program is needed right now
              </p>
              <p className="mt-1 text-sm text-warm-mid">
                GEIA will add a focused program if a new operating pattern
                appears.
              </p>
            </div>
          </PortalReveal>
        )}
      </PortalMotionSection>

      <InstallmentCalendar playbook={playbook} />
      <OwnerCurriculum playbook={playbook} />
    </>
  );
}

async function PlaybookHeroMetric({
  promise,
}: {
  promise: Promise<PortalPlaybook | null>;
}) {
  const playbook = await promise;
  if (!playbook) return null;

  return (
    <dl className="mt-7 inline-flex items-end gap-3 rounded-xl border border-gold/20 bg-warm-white/5 px-5 py-4">
      <div>
        <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-warm-white/70">
          Programs
        </dt>
        <dd className="mt-1 font-mono text-4xl font-semibold text-amber-light">
          <PortalAnimatedNumber value={playbook.family_programs.length} />
        </dd>
      </div>
    </dl>
  );
}

export default async function PortalPlaybookPage() {
  const access = await getPortalPageAccess("playbook_coach");
  if (!access.allowed) {
    return (
      <div className="overflow-hidden">
        <PortalHeroBand
          eyebrow="Coaching system"
          title="Your safety playbook"
          description="Bite-size operating changes, built from your current safety record and arranged in the order that matters most."
        />
        <PortalSectionDivider transition="navy-to-warm" />
        <PortalPageBody>
          <PortalReveal>
            <TierUpgradeNote
              currentTier={access.tier}
              feature="playbook_coach"
              headingLevel="h2"
              title="The coaching playbook is not included in your plan"
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

  const playbookPromise = loadLatestPortalPlaybook(access.clientId);

  return (
    <div className="overflow-hidden">
      <PortalHeroBand
        eyebrow="Coaching system"
        title="Your safety playbook"
        description="Bite-size operating changes, built from your current safety record and arranged in the order that matters most."
      >
        <Suspense
          fallback={
            <div
              aria-label="Loading playbook summary"
              className="mt-7 flex h-20 w-28 items-center justify-center rounded-xl border border-gold/15 bg-warm-white/5"
              role="status"
            >
              <GoldenEraTruckLoader compact />
            </div>
          }
        >
          <PlaybookHeroMetric promise={playbookPromise} />
        </Suspense>
      </PortalHeroBand>
      <PortalSectionDivider transition="navy-to-warm" />

      <PortalPageBody contentClassName="py-12 sm:py-16 lg:py-16">
        <Suspense fallback={<PlaybookBodyFallback />}>
          <div className="space-y-12">
            <PlaybookContent promise={playbookPromise} />
          </div>
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
