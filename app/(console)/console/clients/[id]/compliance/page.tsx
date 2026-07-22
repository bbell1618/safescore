import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatDate, daysUntil } from "@/lib/utils";
import { User, Truck, AlertTriangle, CheckCircle } from "lucide-react";
import { AddDriverButton, AddVehicleButton, RequestClientDocumentsButton } from "@/components/console/compliance-add-forms";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { normalizeClientTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: clientData } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  const client = clientData;
  if (!client) notFound();
  const clientTier = normalizeClientTier(client.tier);

  const { data: drivers } = await supabase
    .from("drivers")
    .select("*")
    .eq("client_id", id)
    .eq("status", "active")
    .order("full_name");

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("*")
    .eq("client_id", id)
    .eq("status", "active")
    .order("unit_number");

  const { inspectionIds } = await getCanonicalInspectionScope(id, supabase);
  const { data: violationRows } = inspectionIds.length > 0
    ? await supabase
        .from("violations")
        .select("violation_code, basic_category")
        .eq("client_id", id)
        .in("inspection_id", inspectionIds)
    : { data: [] };
  const violations = violationRows ?? [];
  const countWhere = (predicate: (violation: (typeof violations)[number]) => boolean) =>
    violations.filter(predicate).length;
  const incompleteDrivers = (drivers ?? []).filter(
    (driver) => !driver.cdl_number || !driver.cdl_expiry || !driver.medical_cert_expiry
  ).length;
  const auditAreas = [
    { area: "Parts and Accessories", count: countWhere((v) => v.basic_category === "vehicle_maintenance" && v.violation_code.startsWith("393")), inputMissing: (vehicles?.length ?? 0) === 0 },
    { area: "Driver Qualifications", count: countWhere((v) => v.basic_category === "driver_fitness") + incompleteDrivers, inputMissing: (drivers?.length ?? 0) === 0 },
    { area: "Operational Requirements", count: countWhere((v) => v.basic_category === "unsafe_driving" || v.basic_category === "controlled_substance"), inputMissing: false },
    { area: "Hours of Service", count: countWhere((v) => v.basic_category === "hos_compliance"), inputMissing: false },
    { area: "Vehicle Inspection, Repair, and Maintenance", count: countWhere((v) => v.basic_category === "vehicle_maintenance" && !v.violation_code.startsWith("393")), inputMissing: (vehicles?.length ?? 0) === 0 },
    { area: "Hazardous Materials", count: countWhere((v) => v.basic_category === "hazmat_compliance"), inputMissing: false },
  ].map((area) => ({
    ...area,
    status: area.count > 0 ? "needs_review" : area.inputMissing || inspectionIds.length === 0 ? "insufficient_data" : "no_violations",
  }));

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
                    ? `Needs review - ${area.count} live issue${area.count === 1 ? "" : "s"}`
                    : area.status === "no_violations"
                      ? "No in-window violations found"
                      : "Insufficient client data"}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">
          Statuses are derived from the canonical in-window violation layer and the current driver and vehicle rosters. &quot;No violations found&quot; is not a certification of compliance.
        </p>
      </div>
    </div>
  );
}
