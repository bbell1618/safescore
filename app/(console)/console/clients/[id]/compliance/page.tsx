import { AlertTriangle, CheckCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { ClearinghouseSection } from "@/components/console/compliance/clearinghouse-section";
import { DriverRosterSection } from "@/components/console/compliance/driver-roster-section";
import type {
  ComplianceClearinghouseRow,
  ComplianceDocumentOption,
  ComplianceDriverDocumentRow,
  ComplianceDriverRow,
  ComplianceMaintenanceRow,
  ComplianceProfileRow,
  ComplianceVehicleRow,
} from "@/components/console/compliance/types";
import { VehicleRosterSection } from "@/components/console/compliance/vehicle-roster-section";
import { Mcs150TruthUpSection } from "@/components/console/mcs150-truth-up-section";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { formatComplianceBasis, formatComplianceIssueStatus } from "@/lib/analysis/compliance-presentation";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
import { buildComplianceHealth } from "@/lib/compliance/health";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { createClient } from "@/lib/supabase/server";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";

export const dynamic = "force-dynamic";

function pacificDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function HealthCount({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "border-[#E5D9C8] bg-white text-[#1E1C1A]",
    good: "border-green-200 bg-green-50 text-green-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-red-200 bg-red-50 text-red-800",
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[11px] font-medium">{label}</p>
    </div>
  );
}

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("id, tier")
    .eq("id", id)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Unable to load compliance client: ${clientError.message}`);
  }
  if (!clientData) notFound();
  const clientTier = normalizeClientTier(clientData.tier);

  const [
    driversResult,
    driverDocumentsResult,
    vehiclesResult,
    maintenanceResult,
    clearinghouseResult,
    profileResult,
    documentsResult,
    canonicalScope,
  ] = await Promise.all([
    supabase
      .from("drivers")
      .select(
        "id, client_id, full_name, cdl_number, cdl_state, cdl_class, cdl_expiry, medical_cert_expiry, hired_date, status, created_at, updated_at"
      )
      .eq("client_id", id)
      .order("status")
      .order("full_name"),
    supabase
      .from("driver_documents")
      .select(
        "id, driver_id, client_id, document_id, doc_type, completed_date, expiry_date, status, notes, created_at, updated_at"
      )
      .eq("client_id", id)
      .order("doc_type"),
    supabase
      .from("vehicles")
      .select(
        "id, client_id, unit_number, vin, year, make, model, license_plate, plate_state, annual_inspection_date, status, created_at, updated_at"
      )
      .eq("client_id", id)
      .order("status")
      .order("unit_number"),
    supabase
      .from("vehicle_maintenance")
      .select(
        "id, vehicle_id, client_id, maintenance_type, scheduled_date, completed_date, notes, document_id, created_at, updated_at"
      )
      .eq("client_id", id)
      .order("completed_date", { ascending: false }),
    supabase
      .from("clearinghouse_records")
      .select(
        "id, client_id, driver_id, query_date, result_type, document_id, created_at"
      )
      .eq("client_id", id)
      .order("query_date", { ascending: false }),
    supabase
      .from("client_compliance_profiles")
      .select(
        "id, client_id, clearinghouse_registration_status, clearinghouse_registration_checked_at, created_at, updated_at"
      )
      .eq("client_id", id)
      .maybeSingle(),
    supabase
      .from("documents")
      .select("id, filename, category, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(250),
    getCanonicalInspectionScope(id, supabase),
  ]);

  const dataErrors = [
    ["driver roster", driversResult.error],
    ["driver qualification files", driverDocumentsResult.error],
    ["vehicle roster", vehiclesResult.error],
    ["maintenance history", maintenanceResult.error],
    ["Clearinghouse history", clearinghouseResult.error],
    ["compliance profile", profileResult.error],
    ["compliance documents", documentsResult.error],
  ] as const;
  const failedQuery = dataErrors.find(([, error]) => error);
  if (failedQuery?.[1]) {
    throw new Error(
      `Unable to load ${failedQuery[0]}: ${failedQuery[1].message}`
    );
  }

  const drivers = (driversResult.data ?? []) as unknown as ComplianceDriverRow[];
  const driverDocuments = (driverDocumentsResult.data ?? []) as unknown as ComplianceDriverDocumentRow[];
  const vehicles = (vehiclesResult.data ?? []) as unknown as ComplianceVehicleRow[];
  const maintenance = (maintenanceResult.data ?? []) as unknown as ComplianceMaintenanceRow[];
  const clearinghouseRecords = (clearinghouseResult.data ?? []) as unknown as ComplianceClearinghouseRow[];
  const complianceProfile = (profileResult.data ?? null) as ComplianceProfileRow | null;
  const documents = (documentsResult.data ?? []) as ComplianceDocumentOption[];
  const asOfDate = pacificDateOnly();
  const health = buildComplianceHealth({
    asOfDate,
    drivers,
    driverDocuments,
    vehicles,
    clearinghouseRecords,
  });

  const { inspectionIds } = canonicalScope;
  const { data: violationRows, error: violationsError } =
    inspectionIds.length > 0
      ? await supabase
          .from("violations")
          .select(
            "violation_code, basic_category, inspections(inspection_date)"
          )
          .eq("client_id", id)
          .in("inspection_id", inspectionIds)
      : { data: [], error: null };
  if (violationsError) {
    throw new Error(
      `Unable to load compliance violations: ${violationsError.message}`
    );
  }
  const violations = violationRows ?? [];
  type ComplianceViolation = (typeof violations)[number];
  const inspectionDateFor = (violation: ComplianceViolation) => {
    const inspection = Array.isArray(violation.inspections)
      ? violation.inspections[0]
      : violation.inspections;
    return inspection?.inspection_date ?? null;
  };
  const inWindowViolations = violations.filter(
    (violation) => timeWeightFor(inspectionDateFor(violation), new Date()) > 0
  );
  const activeDrivers = drivers.filter((driver) => driver.status === "active");
  const activeVehicles = vehicles.filter((vehicle) => vehicle.status === "active");
  const countWhere = (
    rows: ComplianceViolation[],
    predicate: (violation: ComplianceViolation) => boolean
  ) => rows.filter(predicate).length;
  const incompleteDrivers = activeDrivers.filter(
    (driver) =>
      !driver.cdl_number ||
      !driver.cdl_expiry ||
      !driver.medical_cert_expiry
  ).length;
  const auditAreaDefinitions: Array<{
    area: string;
    predicate: (violation: ComplianceViolation) => boolean;
    supplementalCount: number;
    inputMissing: boolean;
  }> = [
    {
      area: "Parts and Accessories",
      predicate: (violation) =>
        violation.basic_category === "vehicle_maintenance" &&
        violation.violation_code.startsWith("393"),
      supplementalCount: 0,
      inputMissing: activeVehicles.length === 0,
    },
    {
      area: "Driver Qualifications",
      predicate: (violation) =>
        violation.basic_category === "driver_fitness",
      supplementalCount: incompleteDrivers,
      inputMissing: activeDrivers.length === 0,
    },
    {
      area: "Operational Requirements",
      predicate: (violation) =>
        violation.basic_category === "unsafe_driving" ||
        violation.basic_category === "controlled_substance",
      supplementalCount: 0,
      inputMissing: false,
    },
    {
      area: "Hours of Service",
      predicate: (violation) =>
        violation.basic_category === "hos_compliance",
      supplementalCount: 0,
      inputMissing: false,
    },
    {
      area: "Vehicle Inspection, Repair, and Maintenance",
      predicate: (violation) =>
        violation.basic_category === "vehicle_maintenance" &&
        !violation.violation_code.startsWith("393"),
      supplementalCount: 0,
      inputMissing: activeVehicles.length === 0,
    },
    {
      area: "Hazardous Materials",
      predicate: (violation) =>
        violation.basic_category === "hazmat_compliance",
      supplementalCount: 0,
      inputMissing: false,
    },
  ];
  const auditAreas = auditAreaDefinitions.map((area) => {
    const count = countWhere(violations, area.predicate) + area.supplementalCount;
    const inWindowCount =
      countWhere(inWindowViolations, area.predicate) + area.supplementalCount;
    return {
      ...area,
      count,
      inWindowCount,
      status:
        count > 0
          ? "needs_review"
          : area.inputMissing || inspectionIds.length === 0
            ? "insufficient_data"
            : "no_violations",
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1E1C1A]">
            Compliance manager
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Operational driver, fleet, Clearinghouse, and audit-readiness records
          </p>
        </div>
        <ServiceTierChip tier={clientTier} feature="compliance_layer" />
      </div>

      {!tierHasFeature(clientTier, "compliance_layer") ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          Compliance is not included in this client&apos;s current service tier. GEIA
          staff can prepare and inspect these records for operator judgment, but the
          portal and automated compliance sweep remain locked.
        </div>
      ) : null}

      {tierHasFeature(clientTier, "compliance_layer") ? (
        <Mcs150TruthUpSection clientId={id} />
      ) : (
        <TierUpgradeNote
          feature="compliance_layer"
          currentTier={clientTier}
          title="MCS-150 truth-up is not included in this client’s plan"
        />
      )}

      <section className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#1E1C1A]">
              Compliance health as of {asOfDate}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
              Counts reflect active operational roster records only. They do not
              certify legal compliance and never change subscription billing.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HealthCount
              label="On file"
              value={health.drivers.compliant + health.vehicles.compliant}
              tone="good"
            />
            <HealthCount
              label="Expiring"
              value={health.drivers.expiring + health.vehicles.expiring}
              tone="warning"
            />
            <HealthCount
              label="Expired"
              value={health.drivers.expired + health.vehicles.expired}
              tone="danger"
            />
            <HealthCount
              label="Missing"
              value={health.drivers.missing + health.vehicles.missing}
            />
          </div>
        </div>
      </section>

      <DriverRosterSection
        clientId={id}
        drivers={drivers}
        driverDocuments={driverDocuments}
        documents={documents}
        health={health}
      />
      <VehicleRosterSection
        clientId={id}
        vehicles={vehicles}
        maintenance={maintenance}
        documents={documents}
        health={health}
      />
      <ClearinghouseSection
        clientId={id}
        profile={complianceProfile}
        drivers={drivers}
        records={clearinghouseRecords}
        documents={documents}
        health={health}
      />

      <section className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[#1E1C1A]">
          Computed compliance review - 6 FMCSA audit areas
        </h2>
        <p className="-mt-2 mb-4 text-xs text-gray-500">
          {formatComplianceBasis(violations.length, inWindowViolations.length)}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {auditAreas.map((area) => (
            <div
              key={area.area}
              className={`flex items-center gap-3 rounded-lg border p-3 ${
                area.status === "no_violations"
                  ? "border-green-200 bg-green-50"
                  : area.status === "needs_review"
                    ? "border-amber-200 bg-amber-50"
                    : "border-gray-200 bg-gray-50"
              }`}
            >
              {area.status === "no_violations" ? (
                <CheckCircle
                  className="h-4 w-4 shrink-0 text-green-500"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-[#DAA520]"
                  aria-hidden="true"
                />
              )}
              <div>
                <p className="text-sm font-medium text-[#1E1C1A]">{area.area}</p>
                <p className="text-xs text-gray-500">
                  {area.status === "needs_review"
                    ? formatComplianceIssueStatus(
                        area.count,
                        area.inWindowCount
                      )
                    : area.status === "no_violations"
                      ? "No issues on file"
                      : "Insufficient client data"}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Statuses are derived from the canonical violation layer and current
          operational rosters. &quot;No issues on file&quot; is not a certification
          of compliance.
        </p>
      </section>
    </div>
  );
}
