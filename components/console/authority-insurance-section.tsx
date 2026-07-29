"use client";

import {
  AlertTriangle,
  Building2,
  ExternalLink,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  computeMcs150BiennialClock,
  type Mcs150BiennialClock,
} from "@/lib/mcs150/biennial";

export type CarrierProfileEnrichmentRow = {
  id: string;
  client_id: string;
  source: string;
  source_url: string;
  source_as_of: string | null;
  fetched_at: string;
  currentness: string;
  data: Record<string, unknown>;
  parser_version: string;
  created_at: string;
  updated_at: string;
};

type SourceResult = {
  source?: unknown;
  status?: unknown;
  reason?: unknown;
};

type RefreshResponse = {
  refreshId?: unknown;
  rows?: unknown;
  sources?: unknown;
  error?: unknown;
};

type SourceObject = Record<string, unknown>;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function asObject(value: unknown): SourceObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceObject)
    : {};
}

function asObjects(value: unknown): SourceObject[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is SourceObject =>
            item !== null && typeof item === "object" && !Array.isArray(item)
        )
    : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : raw;
}

function formatTimestamp(value: unknown): string {
  const raw = text(value);
  if (!raw) return "Not recorded";
  const date = new Date(raw);
  return Number.isFinite(date.getTime())
    ? timestampFormatter.format(date)
    : raw;
}

function formatNumber(value: unknown): string | null {
  const number = numeric(value);
  return number === null ? null : number.toLocaleString("en-US");
}

function formatMoney(value: unknown): string | null {
  const amount = numeric(value);
  return amount === null
    ? text(value)
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(amount);
}

function formatPercent(value: unknown): string | null {
  const rate = numeric(value);
  return rate === null ? null : `${rate.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function mcs150Clock(
  dotNumber: unknown,
  lastFiledDate: unknown,
  asOf: string,
): Mcs150BiennialClock | null {
  const dot = text(dotNumber);
  if (!dot) return null;
  try {
    return computeMcs150BiennialClock({
      dotNumber: dot,
      lastFiledDate: text(lastFiledDate),
      asOf,
    });
  } catch {
    return null;
  }
}

function isEnrichmentRow(value: unknown): value is CarrierProfileEnrichmentRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as SourceObject;
  return (
    typeof row.id === "string" &&
    typeof row.client_id === "string" &&
    typeof row.source === "string" &&
    typeof row.source_url === "string" &&
    typeof row.fetched_at === "string" &&
    typeof row.currentness === "string" &&
    row.data !== null &&
    typeof row.data === "object" &&
    !Array.isArray(row.data)
  );
}

export function AuthorityInsuranceSection({
  clientId,
  billingDriverCount,
  rows: initialRows,
}: {
  clientId: string;
  billingDriverCount: number | null;
  rows: CarrierProfileEnrichmentRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshResult(null);

    try {
      const response = await fetch(
        `/api/clients/${clientId}/authority-insurance`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | RefreshResponse
        | null;
      const refreshedRows = Array.isArray(payload?.rows)
        ? payload.rows.filter(isEnrichmentRow)
        : [];

      if (!response.ok) {
        if (refreshedRows.length > 0) {
          setRows(refreshedRows);
          router.refresh();
        }
        const error = text(payload?.error);
        throw new Error(
          error ?? `Authority and insurance refresh failed (${response.status})`
        );
      }

      if (refreshedRows.length === 0) {
        throw new Error(
          "FMCSA refresh completed without returning any stored source rows."
        );
      }
      setRows(refreshedRows);

      const sourceResults = Array.isArray(payload?.sources)
        ? (payload.sources as SourceResult[])
        : [];
      const failures = sourceResults.filter(
        (source) => source.status === "failed"
      );
      if (failures.length > 0) {
        setRefreshError(
          failures
            .map((failure) => {
              const source = text(failure.source) ?? "FMCSA source";
              const reason = text(failure.reason) ?? "unknown failure";
              return `${source}: ${reason}`;
            })
            .join(" | ")
        );
      } else {
        const refreshId = text(payload?.refreshId);
        setRefreshResult(
          refreshId
            ? `FMCSA sources refreshed. Run ${refreshId}.`
            : "FMCSA sources refreshed."
        );
      }
      router.refresh();
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Unknown authority and insurance refresh failure"
      );
    } finally {
      setRefreshing(false);
    }
  }

  const safer = rows.find((row) => row.source === "safer_company_snapshot");
  const motus = rows.find((row) => row.source === "fmcsa_motus");
  const sms = rows.find((row) => row.source === "fmcsa_sms_inspections");

  return (
    <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-[#1E1C1A] text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#C67A1E]" aria-hidden="true" />
            Authority &amp; insurance
          </h2>
          <p className="mt-1 text-xs text-gray-500 max-w-2xl">
            Public FMCSA carrier, operating-authority, and insurance-filing
            records. Each source is dated separately so stale or historical
            records are never presented as current.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#E4D6C1] bg-white px-3 py-2 text-xs font-medium text-[#1E1C1A] transition-colors hover:border-[#C67A1E] hover:text-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {refreshing ? "Refreshing FMCSA sources" : "Refresh FMCSA sources"}
        </button>
      </div>

      {refreshError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <span className="font-semibold">Refresh issue:</span>{" "}
          {refreshError}
        </div>
      )}
      {refreshResult && (
        <p
          aria-live="polite"
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        >
          {refreshResult}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-[#E4D6C1] bg-white/60 px-5 py-8 text-center">
          <Building2
            className="mx-auto h-7 w-7 text-gray-300"
            aria-hidden="true"
          />
          <p className="mt-2 text-sm font-medium text-[#1E1C1A]">
            No authoritative enrichment has been fetched
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Refresh FMCSA sources to load SAFER and licensing and insurance
            records.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {safer ? (
            <SaferCard
              row={safer}
              billingDriverCount={billingDriverCount}
            />
          ) : (
            <MissingSource
              title="SAFER Company Snapshot"
              body="No SAFER source row is stored. Existing carrier-profile values were not used as a silent fallback."
            />
          )}
          {motus ? (
            <MotusCard row={motus} />
          ) : (
            <MissingSource
              title="FMCSA Motus / Licensing & Insurance"
              body="No Motus source row is stored. This does not prove that the carrier lacks authority or insurance."
            />
          )}
          {sms && <SmsInspectionCard row={sms} />}
        </div>
      )}
    </section>
  );
}

function SourceHeader({
  row,
  title,
  icon,
}: {
  row: CarrierProfileEnrichmentRow;
  title: string;
  icon: React.ReactNode;
}) {
  const status = sourceStatus(row.currentness);

  return (
    <div className="flex flex-col gap-2 border-b border-[#F0E8DA] pb-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[#1E1C1A]">
          {icon}
          {title}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
          <a
            href={row.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[#A86417] hover:underline"
          >
            FMCSA source
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <span>
            Source as of{" "}
            {row.source_as_of
              ? formatDate(row.source_as_of)
              : "not stated by source"}
          </span>
          <span>Fetched {formatTimestamp(row.fetched_at)}</span>
          <span>Parser {row.parser_version}</span>
        </div>
      </div>
      <span
        className={`inline-flex w-fit rounded-full px-2 py-1 text-[10px] font-semibold ${status.className}`}
      >
        {status.label}
      </span>
    </div>
  );
}

function sourceStatus(currentness: string) {
  if (currentness === "current") {
    return {
      label: "Current source result",
      className: "bg-emerald-50 text-emerald-700",
    };
  }
  if (currentness === "historical_only") {
    return {
      label: "Historical source only",
      className: "bg-amber-50 text-amber-800",
    };
  }
  if (currentness === "no_data") {
    return {
      label: "No data returned",
      className: "bg-gray-100 text-gray-600",
    };
  }
  return {
    label: currentness || "Source status unknown",
    className: "bg-gray-100 text-gray-600",
  };
}

function SaferCard({
  row,
  billingDriverCount,
}: {
  row: CarrierProfileEnrichmentRow;
  billingDriverCount: number | null;
}) {
  const data = asObject(row.data);
  const operationClassifications = asStrings(data.operationClassifications);
  const carrierOperations = asStrings(data.carrierOperations);
  const docketNumbers = asStrings(data.docketNumbers);
  const cargoTypes = asStrings(data.cargoTypes);
  const inspections = asObject(data.inspections);

  const mileage = formatNumber(data.mcs150Mileage);
  const mileageYear = formatNumber(data.mcs150MileageYear);
  const filingClock = mcs150Clock(
    data.dotNumber,
    data.mcs150Date,
    row.fetched_at,
  );
  const fmcsaDriverCount = numeric(data.drivers);
  const driverCountDelta =
    fmcsaDriverCount !== null && billingDriverCount !== null
      ? fmcsaDriverCount - billingDriverCount
      : null;

  return (
    <article className="rounded-lg border border-[#F0E8DA] bg-white p-4">
      <SourceHeader
        row={row}
        title="SAFER Company Snapshot"
        icon={<Building2 className="h-4 w-4 text-gray-400" aria-hidden="true" />}
      />

      {row.currentness === "historical_only" && (
        <SourceWarning>
          SAFER marked this stored source as historical. Verify live FMCSA data
          before relying on it.
        </SourceWarning>
      )}
      {row.currentness === "no_data" ? (
        <SourceEmpty>
          SAFER returned no carrier snapshot. No status was inferred.
        </SourceEmpty>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Legal name" value={text(data.legalName)} />
            <Fact label="USDOT status" value={text(data.operatingStatus)} />
            <Fact
              label="Carrier operation"
              value={carrierOperations.join(", ")}
            />
            <Fact
              label="Operation classification"
              value={operationClassifications.join(", ")}
            />
            <Fact
              label="Operating authority"
              value={text(data.operatingAuthority)}
            />
            <Fact
              label="Docket number(s)"
              value={docketNumbers.join(", ")}
            />
            <Fact
              label="Power units / drivers"
              value={
                formatNumber(data.powerUnits) || formatNumber(data.drivers)
                  ? `${formatNumber(data.powerUnits) ?? "\u2014"} / ${
                      formatNumber(data.drivers) ?? "\u2014"
                    }`
                  : null
              }
            />
            <Fact
              label="MCS-150 filed"
              value={formatDate(data.mcs150Date)}
              detail={
                [
                  mileage
                    ? `${mileage} miles${
                        mileageYear ? ` (${mileageYear})` : ""
                      }`
                    : null,
                  filingClock
                    ? filingClock.isOverdue
                      ? `Overdue since ${formatDate(
                          filingClock.nextDueDate,
                        )}`
                      : `Next due ${formatDate(filingClock.nextDueDate)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null
              }
            />
            <Fact
              label="Safety rating"
              value={text(data.safetyRating)}
              detail={
                formatDate(data.safetyRatingDate) ??
                (text(data.reviewType)
                  ? `${text(data.reviewType)} review${
                      formatDate(data.reviewDate)
                        ? ` \u00B7 ${formatDate(data.reviewDate)}`
                        : ""
                    }`
                  : null)
              }
            />
          </div>

          {cargoTypes.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Cargo carried
              </p>
              <p className="mt-1 text-xs text-gray-600">
                {cargoTypes.join(", ")}
              </p>
            </div>
          )}

          <InspectionSummary inspections={inspections} />

          {filingClock?.isOverdue && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              MCS-150 filing appears stale under FMCSA&apos;s biennial USDOT
              digit rule. The calculated due date was{" "}
              <strong>{formatDate(filingClock.nextDueDate)}</strong>.
            </div>
          )}

          {driverCountDelta !== null && driverCountDelta !== 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              FMCSA&apos;s MCS-150 lists{" "}
              <strong>{fmcsaDriverCount?.toLocaleString("en-US")}</strong>{" "}
              drivers; the client-stated billing count is{" "}
              <strong>{billingDriverCount?.toLocaleString("en-US")}</strong>{" "}
              ({Math.abs(driverCountDelta).toLocaleString("en-US")}{" "}
              {driverCountDelta > 0 ? "higher on FMCSA" : "lower on FMCSA"}).
              Billing remains based on the operator-managed client count; review
              the mismatch rather than overwriting either source.
            </div>
          )}
        </>
      )}
    </article>
  );
}

function InspectionSummary({
  inspections,
}: {
  inspections: SourceObject;
}) {
  const categories = [
    { key: "vehicle", label: "Vehicle" },
    { key: "driver", label: "Driver" },
    { key: "hazmat", label: "Hazmat" },
  ] as const;
  const hasAny = categories.some((category) => {
    const data = asObject(inspections[category.key]);
    return Object.keys(data).length > 0;
  });

  if (!hasAny && numeric(inspections.total) === null) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-[#F0E8DA]">
      <div className="flex items-center justify-between bg-[#FEFCF8] px-3 py-2">
        <p className="text-xs font-semibold text-[#1E1C1A]">
          24-month inspections and out-of-service rates
        </p>
        {numeric(inspections.total) !== null && (
          <span className="text-[11px] text-gray-500">
            {formatNumber(inspections.total)} total
          </span>
        )}
      </div>
      <div className="grid divide-y divide-[#F0E8DA] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {categories.map(({ key, label }) => {
          const category = asObject(inspections[key]);
          return (
            <div key={key} className="px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {label}
              </p>
              <p className="mt-1 text-sm font-semibold text-[#1E1C1A]">
                {formatNumber(category.inspections) ?? "\u2014"} inspections
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {formatNumber(category.outOfService) ?? "\u2014"} out of service
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Carrier {formatPercent(category.oosRate) ?? "\u2014"} · national{" "}
                {formatPercent(category.nationalRate) ?? "\u2014"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MotusCard({ row }: { row: CarrierProfileEnrichmentRow }) {
  const data = asObject(row.data);
  const authorities = asObjects(data.authorities);
  const filings = asObjects(data.insuranceFilings);
  const pendingActions = asStrings(data.pendingActions);
  const authorityHistory = asObjects(data.authorityHistory);
  const docketNumbers = asStrings(data.docketNumbers);
  const legacyIsHistorical =
    data.legacyLiStatus === "historical_only_since_2026-05-14";

  return (
    <article className="rounded-lg border border-[#F0E8DA] bg-white p-4">
      <SourceHeader
        row={row}
        title="FMCSA Motus / Licensing & Insurance"
        icon={<FileCheck2 className="h-4 w-4 text-gray-400" aria-hidden="true" />}
      />

      {(row.currentness === "historical_only" || legacyIsHistorical) && (
        <SourceWarning>
          Legacy Licensing &amp; Insurance history is historical-only after May
          14, 2026. Do not treat legacy records as proof of current authority or
          coverage; current Motus results are shown separately when returned.
        </SourceWarning>
      )}
      {row.currentness === "no_data" ? (
        <SourceEmpty>
          FMCSA returned no Motus records for this carrier. That absence does not
          prove the carrier is uninsured or unauthorized.
        </SourceEmpty>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Legal name" value={text(data.legalName)} />
            <Fact label="USDOT status" value={text(data.usdotStatus)} />
            <Fact
              label="Out-of-service flag"
              value={
                typeof data.outOfService === "boolean"
                  ? data.outOfService
                    ? "Yes"
                    : "No"
                  : text(data.outOfService)
              }
            />
            <Fact
              label="Docket number(s)"
              value={docketNumbers.join(", ")}
            />
          </div>

          <div className="mt-5">
            <h4 className="text-xs font-semibold text-[#1E1C1A]">
              Operating authorities
            </h4>
            {authorities.length > 0 ? (
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {authorities.map((authority, index) => {
                  const actions = asStrings(authority.pendingActions);
                  return (
                    <div
                      key={`${text(authority.registrationId) ?? "authority"}-${index}`}
                      className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-[#1E1C1A]">
                          {text(authority.type) ?? "Authority type not returned"}
                        </p>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                          {text(authority.status) ?? "Status not returned"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        Docket {text(authority.docketNumber) ?? "\u2014"}
                        {formatMoney(authority.minimumBipdCoverage)
                          ? ` \u00B7 minimum BIPD ${formatMoney(
                              authority.minimumBipdCoverage
                            )}`
                          : ""}
                        {formatMoney(authority.filedBipdCoverage)
                          ? ` \u00B7 filed BIPD ${formatMoney(
                              authority.filedBipdCoverage
                            )}`
                          : ""}
                      </p>
                      {formatTimestamp(authority.sourceUpdatedAt) !==
                        "Not recorded" && (
                        <p className="mt-1 text-[11px] text-gray-500">
                          Source updated{" "}
                          {formatTimestamp(authority.sourceUpdatedAt)}
                        </p>
                      )}
                      {actions.length > 0 && (
                        <p className="mt-2 text-[11px] text-amber-800">
                          Pending: {actions.join("; ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <SourceEmpty>
                No authority rows were returned. No status was inferred.
              </SourceEmpty>
            )}
          </div>

          <div className="mt-5">
            <h4 className="text-xs font-semibold text-[#1E1C1A]">
              Insurance filings
            </h4>
            {filings.length > 0 ? (
              <div className="mt-2 space-y-2">
                {filings.map((filing, index) => (
                  <div
                    key={`${text(filing.policyNumber) ?? text(filing.formType) ?? "filing"}-${index}`}
                    className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] p-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold text-[#1E1C1A]">
                          {text(filing.formType) ??
                            "Filing form not returned"}
                          {text(filing.formDescription)
                            ? ` \u00B7 ${text(filing.formDescription)}`
                            : ""}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {text(filing.insuranceCompanyName) ??
                            "Insurance company not returned"}
                          {text(filing.policyNumber)
                            ? ` \u00B7 policy ${text(filing.policyNumber)}`
                            : ""}
                        </p>
                      </div>
                      <span className="w-fit rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                        {text(filing.status) ?? "Status not returned"}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-[11px] text-gray-500 sm:grid-cols-2 lg:grid-cols-4">
                      <span>
                        Authority: {text(filing.authorityType) ?? "\u2014"}
                      </span>
                      <span>
                        Amount: {formatMoney(filing.filedAmount) ?? "\u2014"}
                      </span>
                      <span>
                        Effective: {formatDate(filing.effectiveDate) ?? "\u2014"}
                      </span>
                      <span>
                        Received: {formatDate(filing.receivedDate) ?? "\u2014"}
                      </span>
                      <span>
                        Class: {text(filing.insuranceClass) ?? "\u2014"}
                      </span>
                      <span>
                        Cancellation:{" "}
                        {formatDate(filing.cancellationDate) ?? "None returned"}
                      </span>
                    </div>
                    {text(filing.statusReason) && (
                      <p className="mt-2 text-[11px] text-gray-500">
                        Status reason: {text(filing.statusReason)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <SourceEmpty>
                No insurance filing rows were returned. This is not proof of no
                insurance coverage.
              </SourceEmpty>
            )}
          </div>

          <div className="mt-5">
            <h4 className="text-xs font-semibold text-[#1E1C1A]">
              Pending actions
            </h4>
            {pendingActions.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {pendingActions.map((action) => (
                  <li
                    key={action}
                    className="flex gap-2 text-xs text-amber-900"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                No pending actions were returned by this source.
              </p>
            )}
          </div>

          <div className="mt-5">
            <h4 className="text-xs font-semibold text-[#1E1C1A]">
              Authority history
            </h4>
            {authorityHistory.length > 0 ? (
              <div className="mt-2 space-y-2">
                {authorityHistory.map((event, index) => (
                  <div
                    key={`${text(event.id) ?? text(event.docketNumber) ?? "history"}-${index}`}
                    className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] p-3 text-xs text-gray-600"
                  >
                    <strong className="text-[#1E1C1A]">
                      {text(event.type) ?? "Authority event"}
                    </strong>
                    {text(event.status) ? ` \u00B7 ${text(event.status)}` : ""}
                    {formatDate(event.effectiveDate)
                      ? ` \u00B7 ${formatDate(event.effectiveDate)}`
                      : ""}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                No separate authority-history events were returned by Motus.
                Current authority status is shown above without inference.
              </p>
            )}
          </div>
        </>
      )}
    </article>
  );
}

function SmsInspectionCard({
  row,
}: {
  row: CarrierProfileEnrichmentRow;
}) {
  const data = asObject(row.data);
  const levels = asObjects(data.levels);

  return (
    <article className="rounded-lg border border-[#F0E8DA] bg-white p-4">
      <SourceHeader
        row={row}
        title="FMCSA SMS inspection levels"
        icon={<FileCheck2 className="h-4 w-4 text-gray-400" aria-hidden="true" />}
      />
      {row.currentness === "no_data" ? (
        <SourceEmpty>
          The SMS source returned no inspection-level summary.
        </SourceEmpty>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] px-3 py-2 text-xs text-gray-600">
            <strong className="text-[#1E1C1A]">
              {formatNumber(data.total) ?? "\u2014"}
            </strong>{" "}
            total
          </span>
          {levels.map((level, index) => (
            <span
              key={`${text(level.level) ?? "level"}-${index}`}
              className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] px-3 py-2 text-xs text-gray-600"
            >
              Level {text(level.level) ?? "\u2014"}:{" "}
              <strong className="text-[#1E1C1A]">
                {formatNumber(level.count) ?? "\u2014"}
              </strong>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | null;
  detail?: string | null;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-xs font-semibold text-[#1E1C1A]">
        {value || "Not returned by source"}
      </p>
      {detail && <p className="mt-0.5 text-[11px] text-gray-500">{detail}</p>}
    </div>
  );
}

function SourceWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      />
      <span>{children}</span>
    </div>
  );
}

function SourceEmpty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs text-gray-500">{children}</p>;
}

function MissingSource({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#E4D6C1] bg-white/60 px-4 py-4">
      <p className="text-xs font-semibold text-[#1E1C1A]">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{body}</p>
    </div>
  );
}
