import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatDate, daysUntil } from "@/lib/utils";
import { User, Truck, AlertTriangle, CheckCircle } from "lucide-react";
import { AddDriverButton, AddVehicleButton, RequestClientDocumentsButton } from "@/components/console/compliance-add-forms";
import { Mcs150TruthUpSection } from "@/components/console/mcs150-truth-up-section";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
import {
  formatComplianceBasis,
  formatComplianceIssueStatus,
} from "@/lib/analysis/compliance-presentation";

export const dynamic = "force-dynamic";

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Unable to load compliance client: ${clientError.message}`);
  }
  const client = clientData;
  if (!client) notFound();
  const clientTier = normalizeClientTier(client.tier);

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("*")
    .eq("client_id", id)
    .eq("status", "active")
    .order("full_name");

  if (driversError) {
    throw new Error(`Unable to load driver roster: ${driversError.message}`);
  }

  const { data: vehicles, error: vehiclesError } = await supabase
    .from("vehicles")
    .select("*")
    .eq("client_id", id)
    .eq("status", "active")
    .order("unit_number");
  if (vehiclesError) {
    throw new Error(`Unable to load vehicle roster: ${vehiclesError.message}`);
  }

  const { inspectionIds } = await getCanonicalInspectionScope(id, supabase);
  const { data: violationRows, error: violationsError } = inspectionIds.length > 0
    ? await supabase
        .from("violations")
        .select("violation_code, basic_category, inspections(inspection_date)")
        .eq("client_id", id)
        .in("inspection_id", inspectionIds)
    : { data: [], error: null };
  if (violationsError) {
    throw new Error(`Unable to load compliance violations: ${violationsError.message}`);
  }
  const violations = violationRows ?? [];
  type ComplianceViolation = (typeof violations)[number];
  const inspectionDateFor = (violation: ComplianceViolation) => {
    const inspection = Array.isArray(violation.inspections)
      ? violation.inspections[0]
      : violation.inspections;
    return inspection?.inspection_date ?? null;
  };
  const asOf = new Date();
  const inWindowViolations = violations.filter(
    (violation) => timeWeightFor(inspectionDateFor(violation), asOf) > 0
  );
  const countWhere = (
    rows: ComplianceViolation[],
    predicate: (violation: ComplianceViolation) => boolean
  ) => rows.filter(predicate).length;
  const incompleteDrivers = (drivers ?? []).filter(
    (driver) => !driver.cdl_number || !driver.cdl_expiry || !driver.medical_cert_expiry
  ).length;
  const auditAreaDefinitions: Array<{
    area: string;
    predicate: (violation: ComplianceViolation) => boolean;
    supplementalCount: number;
    inputMissing: boolean;
  }> = [
    { area: "Parts and Accessories", predicate: (v) => v.basic_category === "vehicle_maintenance" && v.violation_code.startsWith("393"), supplementalCount: 0, inputMissing: (vehicles?.length ?? 0) === 0 },
    { area: "Driver Qualifications", predicate: (v) => v.basic_category === "driver_fitness", supplementalCount: incompleteDrivers, inputMissing: (drivers?.length ?? 0) === 0 },
    { area: "Operational Requirements", predicate: (v) => v.basic_category === "unsafe_driving" || v.basic_category === "controlled_substance", supplementalCount: 0, inputMissing: false },
    { area: "Hours of Service", predicate: (v) => v.basic_category === "hos_compliance", supplementalCount: 0, inputMissing: false },
    { area: "Vehicle Inspection, Repair, and Maintenance", predicate: (v) => v.basic_category === "vehicle_maintenance" && !v.violation_code.startsWith("393"), supplementalCount: 0, inputMissing: (vehicles?.length ?? 0) === 0 },
    { area: "Hazardous Materials", predicate: (v) => v.basic_category === "hazmat_compliance", supplementalCount: 0, inputMissing: false },
  ];
  const auditAreas = auditAreaDefinitions.map((area) => {
    const count = countWhere(violations, area.predicate) + area.supplementalCount;
    const inWindowCount = countWhere(inWindowViolations, area.predicate) + area.supplementalCount;
    return {
      ...area,
      count,
      inWindowCount,
      status: count > 0 ? "needs_review" : area.inputMissing || inspectionIds.length === 0 ? "insufficient_data" : "no_violations",
    };
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold text-[#1E1C1A]"
          >
            Compliance manager
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tier 3 - driver qualifications, fleet maintenance, and compliance audit framework
          </p>
        </div>
        <ServiceTierChip tier={clientTier} feature="compliance_layer" />
      </div>

      {tierHasFeature(clientTier, "compliance_layer") ? (
        <Mcs150TruthUpSection clientId={id} />
      ) : (
        <TierUpgradeNote
          feature="compliance_layer"
          currentTier={clientTier}
          title="MCS-150 truth-up is not included in this client’s plan"
        />
      )}

      <div className="grid grid-cols-2 gap-5">
        {/* Driver roster */}
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0E8DA] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-400" />
              <h2
                className="font-semibold text-[#1E1C1A] text-sm"
              >
                Driver roster ({drivers?.length ?? 0})
              </h2>
            </div>
            <AddDriverButton clientId={id} />
          </div>
          {drivers && drivers.length > 0 ? (
            <div className="divide-y divide-[#F0E8DA]">
              {drivers.map((d) => {
                const cdlDays = daysUntil(d.cdl_expiry);
                const medDays = daysUntil(d.medical_cert_expiry);
                const hasExpiring = (cdlDays !== null && cdlDays <= 60) || (medDays !== null && medDays <= 60);
                return (
                  <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#1E1C1A]">{d.full_name}</p>
                      <p className="text-xs text-gray-400">
                        CDL exp: {formatDate(d.cdl_expiry)}{"\u00B7"} Med cert: {formatDate(d.medical_cert_expiry)}
                      </p>
                    </div>
                    {hasExpiring ? (
                      <AlertTriangle className="w-4 h-4 text-[#DAA520]" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No drivers added</p>
              <p className="text-xs text-gray-400 mt-1">No driver qualification roster has been provided.</p>
              <RequestClientDocumentsButton clientId={id} />
            </div>
          )}
        </div>

        {/* Vehicle fleet */}
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0E8DA] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-gray-400" />
              <h2
                className="font-semibold text-[#1E1C1A] text-sm"
              >
                Vehicle fleet ({vehicles?.length ?? 0})
              </h2>
            </div>
            <AddVehicleButton clientId={id} />
          </div>
          {vehicles && vehicles.length > 0 ? (
            <div className="divide-y divide-[#F0E8DA]">
              {vehicles.map((v) => (
                <div key={v.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#1E1C1A]">
                      Unit {v.unit_number ?? "\u2014"}{"\u00B7"} {v.year} {v.make} {v.model}
                    </p>
                    <p className="text-xs text-gray-400">
                      VIN: {v.vin ?? "\u2014"}{"\u00B7"} {v.license_plate} {v.plate_state}
                    </p>
                  </div>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No vehicles added</p>
            </div>
          )}
        </div>
      </div>

      {/* Computed audit checklist */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <h2
          className="font-semibold text-[#1E1C1A] text-sm mb-4"
        >
          Computed compliance review - 6 FMCSA audit areas
        </h2>
        <p className="text-xs text-gray-500 -mt-2 mb-4">
          {formatComplianceBasis(violations.length, inWindowViolations.length)}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {auditAreas.map((area) => (
            <div
              key={area.area}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                area.status === "no_violations"
                  ? "border-green-200 bg-green-50"
                  : area.status === "needs_review" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"
              }`}
            >
              {area.status === "no_violations" ? (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#DAA520] shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-[#1E1C1A]">{area.area}</p>
                <p className="text-xs text-gray-500">
                  {area.status === "needs_review"
                    ? formatComplianceIssueStatus(area.count, area.inWindowCount)
                    : area.status === "no_violations"
                      ? "No issues on file"
                      : "Insufficient client data"}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">
          Statuses are derived from the canonical violation layer and the current driver and vehicle rosters. &quot;No issues on file&quot; is not a certification of compliance.
        </p>
      </div>
    </div>
  );
}
