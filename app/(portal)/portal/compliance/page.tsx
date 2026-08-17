import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CarFront,
  CheckCircle2,
  CircleHelp,
  FileClock,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import {
  PortalMotionListItem,
  PortalMotionSection,
  PortalReveal,
} from "@/components/portal/motion";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import {
  buildComplianceHealth,
  complianceStatusLabel,
  type ComplianceHealth,
  type ComplianceHealthStatus,
} from "@/lib/compliance/health";
import { getPortalPageAccess } from "@/lib/portal/access";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pacificDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Date not recorded";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function statusClasses(status: ComplianceHealthStatus): string {
  if (status === "on_file") return "bg-success-light text-success";
  if (status === "expiring") return "bg-amber-subtle text-amber-dark";
  if (status === "expired") return "bg-error-light text-error";
  return "bg-cream text-warm-mid";
}

function StatusPill({
  status,
  label = complianceStatusLabel(status),
}: {
  status: ComplianceHealthStatus;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide",
        statusClasses(status)
      )}
    >
      {label}
    </span>
  );
}

function CountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: ComplianceHealthStatus;
}) {
  return (
    <div className="rounded-lg border border-sand bg-cream/70 px-4 py-3">
      <p className="font-heading text-2xl font-semibold tabular-nums text-warm-dark">
        {value}
      </p>
      <p className="mt-1 text-xs font-medium text-warm-mid">{label}</p>
      <span className="sr-only">Status: {complianceStatusLabel(tone)}</span>
    </div>
  );
}

function HealthSection({
  kind,
  health,
}: {
  kind: "drivers" | "vehicles";
  health: ComplianceHealth["drivers"] | ComplianceHealth["vehicles"];
}) {
  const isDrivers = kind === "drivers";
  const Icon = isDrivers ? UsersRound : CarFront;
  const title = isDrivers
    ? "Drivers and qualification files"
    : "Vehicles and annual inspections";

  return (
    <PortalMotionSection
      interactive
      className="rounded-xl border border-sand bg-warm-white p-5 shadow-[var(--shadow-card)] sm:p-6"
      ariaLabelledBy={`${kind}-health-heading`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-subtle text-amber-dark">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2
            id={`${kind}-health-heading`}
            className="font-heading text-xl font-semibold text-warm-dark"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-warm-mid">
            {isDrivers
              ? "Current DQF records, credentials, and annual review dates."
              : "Active units and the annual DOT inspection dates on file."}
          </p>
        </div>
      </div>

      {health.total === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-sand bg-cream px-5 py-7">
          <p className="font-heading font-semibold text-warm-dark">
            {isDrivers
              ? "No driver roster is on file yet"
              : "No vehicle roster is on file yet"}
          </p>
          <p className="mt-1 text-sm leading-6 text-warm-mid">
            {isDrivers
              ? "GEIA will add each active driver first, then organize the qualification-file checklist and expiration dates."
              : "GEIA will add active units first, then track annual inspection dates and maintenance records."}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CountCard label="Compliant" value={health.compliant} tone="on_file" />
          <CountCard label="Expiring" value={health.expiring} tone="expiring" />
          <CountCard label="Expired" value={health.expired} tone="expired" />
          <CountCard label="Missing" value={health.missing} tone="missing" />
        </div>
      )}
    </PortalMotionSection>
  );
}

function UpcomingExpirations({ health }: { health: ComplianceHealth }) {
  return (
    <PortalMotionSection
      className="rounded-xl border border-sand bg-warm-white p-5 shadow-[var(--shadow-card)] sm:p-6"
      ariaLabelledBy="upcoming-compliance-heading"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-subtle text-amber-dark">
          <CalendarClock className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2
            id="upcoming-compliance-heading"
            className="font-heading text-xl font-semibold text-warm-dark"
          >
            Upcoming expirations
          </h2>
          <p className="mt-1 text-sm leading-6 text-warm-mid">
            Recorded dates due within 60 days, plus anything already expired.
          </p>
        </div>
      </div>

      {health.upcoming.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-sand bg-cream px-5 py-7">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <div>
              <p className="font-heading font-semibold text-warm-dark">
                No recorded expirations are due within 60 days
              </p>
              <p className="mt-1 text-sm leading-6 text-warm-mid">
                This covers dates currently on file. Missing roster or checklist records stay identified in the summaries above.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-sand" aria-label="Upcoming compliance expirations">
          {health.upcoming.map((item, index) => (
            <PortalMotionListItem
              interactive
              key={item.key}
              delay={Math.min(index * 0.04, 0.2)}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold text-warm-dark">{item.title}</p>
                <p className="mt-1 text-sm text-warm-mid">
                  {item.daysRemaining < 0
                    ? `${Math.abs(item.daysRemaining)} day${Math.abs(item.daysRemaining) === 1 ? "" : "s"} overdue`
                    : item.daysRemaining === 0
                      ? "Due today"
                      : `${item.daysRemaining} day${item.daysRemaining === 1 ? "" : "s"} remaining`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-xs text-warm-mid">
                  {formatDate(item.dueDate)}
                </span>
                <StatusPill status={item.status} />
              </div>
            </PortalMotionListItem>
          ))}
        </ul>
      )}
    </PortalMotionSection>
  );
}

export default async function PortalCompliancePage() {
  const access = await getPortalPageAccess("compliance_layer");
  if (!access.allowed) {
    return (
      <TierUpgradeNote
        feature="compliance_layer"
        currentTier={access.tier}
        title="The compliance layer is not included in your plan"
      />
    );
  }

  const [driversResult, documentsResult, vehiclesResult, clearinghouseResult, profileResult] =
    await Promise.all([
      access.supabase
        .from("drivers")
        .select("id, full_name, status, cdl_expiry, medical_cert_expiry, approved_at")
        .eq("client_id", access.clientId)
        .not("approved_at", "is", null),
      access.supabase
        .from("driver_documents")
        .select("id, driver_id, doc_type, status, completed_date, expiry_date, document_id")
        .eq("client_id", access.clientId),
      access.supabase
        .from("vehicles")
        .select("id, unit_number, status, annual_inspection_date")
        .eq("client_id", access.clientId),
      access.supabase
        .from("clearinghouse_records")
        .select("id, driver_id, query_date")
        .eq("client_id", access.clientId),
      access.supabase
        .from("client_compliance_profiles")
        .select("clearinghouse_registration_status, clearinghouse_registration_checked_at")
        .eq("client_id", access.clientId)
        .maybeSingle(),
    ]);

  const queryFailures = [
    ["driver roster", driversResult.error],
    ["driver qualification files", documentsResult.error],
    ["vehicle roster", vehiclesResult.error],
    ["Clearinghouse query history", clearinghouseResult.error],
    ["Clearinghouse registration", profileResult.error],
  ].filter((entry) => entry[1]);
  if (queryFailures.length > 0) {
    throw new Error(
      `Unable to load compliance health: ${queryFailures
        .map(([label, error]) => `${label}: ${(error as { message: string }).message}`)
        .join("; ")}`
    );
  }

  const health = buildComplianceHealth({
    asOfDate: pacificDateOnly(),
    drivers: driversResult.data ?? [],
    driverDocuments: documentsResult.data ?? [],
    vehicles: vehiclesResult.data ?? [],
    clearinghouseRecords: clearinghouseResult.data ?? [],
  });
  const registrationStatus =
    profileResult.data?.clearinghouse_registration_status ?? "unknown";
  const registrationLabel =
    registrationStatus === "registered"
      ? "Registered"
      : registrationStatus === "not_registered"
        ? "Not registered"
        : "Not confirmed";
  const registrationTone: ComplianceHealthStatus =
    registrationStatus === "registered"
      ? "on_file"
      : registrationStatus === "not_registered"
        ? "expired"
        : "missing";

  return (
    <div className="overflow-hidden">
      <PortalHeroBand
        eyebrow="Total Safety"
        title="Compliance health"
        description="A read-only view of the driver, vehicle, and Clearinghouse records GEIA is managing with you. Missing information is shown honestly until it is collected."
      >
        <div className="mt-7 flex flex-wrap gap-3">
          <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-warm-white/15 bg-warm-white/5 px-4 font-mono text-xs text-warm-white">
            <ShieldCheck className="h-4 w-4 text-gold-light" aria-hidden="true" />
            Reviewed as of {formatDate(health.asOfDate)}
          </span>
          <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-warm-white/15 bg-warm-white/5 px-4 font-mono text-xs text-warm-white">
            <FileClock className="h-4 w-4 text-gold-light" aria-hidden="true" />
            {health.upcoming.length} date{health.upcoming.length === 1 ? "" : "s"} need attention
          </span>
        </div>
      </PortalHeroBand>
      <PortalSectionDivider transition="navy-to-warm" />

      <PortalPageBody contentClassName="space-y-8 py-12 sm:py-14">
        <PortalReveal>
          <div className="grid gap-6 lg:grid-cols-2">
            <HealthSection kind="drivers" health={health.drivers} />
            <HealthSection kind="vehicles" health={health.vehicles} />
          </div>
        </PortalReveal>

        <UpcomingExpirations health={health} />

        <PortalMotionSection
          interactive
          className="rounded-xl border border-sand bg-warm-white p-5 shadow-[var(--shadow-card)] sm:p-6"
          ariaLabelledBy="clearinghouse-status-heading"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-subtle text-amber-dark">
                {registrationStatus === "registered" ? (
                  <BadgeCheck className="h-5 w-5" aria-hidden="true" />
                ) : registrationStatus === "not_registered" ? (
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <CircleHelp className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <div>
                <h2 id="clearinghouse-status-heading" className="font-heading text-xl font-semibold text-warm-dark">
                  Clearinghouse registration
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-warm-mid">
                  GEIA records registration status and annual query dates here; queries themselves are completed outside SafeScore.
                </p>
              </div>
            </div>
            <div className="shrink-0 sm:text-right">
              <StatusPill status={registrationTone} label={registrationLabel} />
              <p className="mt-2 text-xs text-warm-mid">
                {profileResult.data?.clearinghouse_registration_checked_at
                  ? `Checked ${new Date(profileResult.data.clearinghouse_registration_checked_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })}`
                  : "No verification date recorded"}
              </p>
            </div>
          </div>
        </PortalMotionSection>
      </PortalPageBody>

      <PortalSectionDivider transition="warm-to-navy" />
      <PortalFooterBand>
        <div>
          <p className="font-heading text-xl font-semibold tracking-tight text-warm-white">
            {access.clientName}
          </p>
          <p className="mt-1 text-xs text-warm-white/70">
            Compliance roster counts are operational records and do not change your service-plan billing.
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
      </PortalFooterBand>
    </div>
  );
}
