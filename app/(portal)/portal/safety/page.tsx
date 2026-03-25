import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCarrier } from "@/lib/fmcsa/client";
import { formatDate } from "@/lib/utils";
import {
  Building2,
  MapPin,
  Truck,
  Users2,
  AlertTriangle,
  ChevronDown,
  Shield,
} from "lucide-react";

export const dynamic = "force-dynamic";

const basicLabels: Record<string, string> = {
  unsafe_driving: "Unsafe driving",
  hos_compliance: "HOS compliance",
  driver_fitness: "Driver fitness",
  controlled_substance: "Controlled substances",
  vehicle_maintenance: "Vehicle maintenance",
  hazmat_compliance: "HM compliance",
  crash_indicator: "Crash indicator",
};

function PercentileBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-400">—</span>;
  const color =
    value >= 80
      ? "bg-[#DC362E]"
      : value >= 65
      ? "bg-[#C5A059]"
      : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span
        className={`text-xs font-semibold w-10 text-right ${
          value >= 80
            ? "text-[#DC362E]"
            : value >= 65
            ? "text-[#C5A059]"
            : "text-green-600"
        }`}
      >
        {value}th
      </span>
    </div>
  );
}

export default async function SafetyProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  if (!userRecord?.client_id) redirect("/portal");

  const clientId = userRecord.client_id;

  const [
    { data: client },
    { data: snapshot },
    { data: inspections },
    { data: crashes },
    { data: violations },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).single(),
    supabase
      .from("score_snapshots")
      .select("*")
      .eq("client_id", clientId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("inspections")
      .select("*, violations(id, violation_code, violation_description, basic_category, severity_weight, oos_violation)")
      .eq("client_id", clientId)
      .order("inspection_date", { ascending: false }),
    supabase
      .from("crashes")
      .select("*")
      .eq("client_id", clientId)
      .order("crash_date", { ascending: false }),
    supabase
      .from("violations")
      .select("id, basic_category, severity_weight, time_weight, oos_violation")
      .eq("client_id", clientId),
  ]);

  if (!client) redirect("/portal");

  let carrier = null;
  try {
    carrier = await getCarrier(client.dot_number);
  } catch {
    // fail gracefully
  }

  // Group violations by BASIC category
  const violationsByBasic: Record<string, typeof violations> = {};
  for (const v of violations ?? []) {
    const cat = v.basic_category ?? "other";
    if (!violationsByBasic[cat]) violationsByBasic[cat] = [];
    violationsByBasic[cat]!.push(v);
  }

  const basicsArray = snapshot
    ? [
        { key: "unsafe_driving", measure: snapshot.unsafe_driving_measure, percentile: snapshot.unsafe_driving_pct },
        { key: "hos_compliance", measure: snapshot.hos_compliance_measure, percentile: snapshot.hos_compliance_pct },
        { key: "driver_fitness", measure: snapshot.driver_fitness_measure, percentile: snapshot.driver_fitness_pct },
        { key: "controlled_substance", measure: snapshot.controlled_substance_measure, percentile: snapshot.controlled_substance_pct },
        { key: "vehicle_maintenance", measure: snapshot.vehicle_maint_measure, percentile: snapshot.vehicle_maint_pct },
        { key: "hazmat_compliance", measure: snapshot.hm_compliance_measure, percentile: snapshot.hm_compliance_pct },
        { key: "crash_indicator", measure: snapshot.crash_indicator_measure, percentile: snapshot.crash_indicator_pct },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1A1A1A]">Safety profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Carrier details, inspection history, and BASIC breakdown for DOT {client.dot_number}
        </p>
      </div>

      {/* Carrier info card */}
      {carrier && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-[#1A1A1A] text-sm">Carrier information</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Legal name</p>
              <p className="text-sm font-medium text-[#1A1A1A]">{carrier.legalName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">DOT number</p>
              <p className="text-sm font-medium text-[#1A1A1A]">{carrier.dotNumber}</p>
            </div>
            {carrier.mcNumber && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">MC number</p>
                <p className="text-sm font-medium text-[#1A1A1A]">{carrier.mcNumber}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Operating status</p>
              <span
                className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                  carrier.usdotStatus === "ACTIVE" || carrier.statusCode === "A"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {carrier.usdotStatus ?? carrier.statusCode ?? "Unknown"}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Power units</p>
              <p className="text-sm font-medium text-[#1A1A1A] flex items-center gap-1">
                <Truck className="w-3.5 h-3.5 text-gray-400" />
                {carrier.totalPowerUnits}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Drivers</p>
              <p className="text-sm font-medium text-[#1A1A1A] flex items-center gap-1">
                <Users2 className="w-3.5 h-3.5 text-gray-400" />
                {carrier.totalDrivers}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Safety rating</p>
              <p className="text-sm font-medium text-[#1A1A1A]">
                {carrier.safetyRating ?? "Not rated"}
              </p>
            </div>
            {(carrier.phyCity || carrier.phyState) && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Location</p>
                <p className="text-sm font-medium text-[#1A1A1A] flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  {[carrier.phyCity, carrier.phyState].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BASICs breakdown */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-[#1A1A1A] text-sm">BASICs breakdown</h2>
          {snapshot && (
            <span className="text-xs text-gray-400 ml-auto">
              As of {formatDate(snapshot.snapshot_date)}
            </span>
          )}
        </div>

        {basicsArray.length > 0 ? (
          <div className="divide-y divide-[#E5E5E5]">
            {basicsArray.map((b) => {
              const categoryViolations = violationsByBasic[b.key] ?? [];
              const alerting = (b.percentile ?? 0) >= 80;
              return (
                <div key={b.key} className="py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1A1A1A]">
                          {basicLabels[b.key]}
                        </span>
                        {alerting && (
                          <AlertTriangle className="w-3.5 h-3.5 text-[#DC362E] shrink-0" />
                        )}
                        <span className="text-xs text-gray-400 ml-auto">
                          Measure: {b.measure?.toFixed(1) ?? "—"}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <PercentileBar value={b.percentile ?? null} />
                      </div>
                    </div>
                  </div>
                  {categoryViolations.length > 0 && (
                    <div className="mt-2 pl-2 border-l-2 border-[#E5E5E5] space-y-1">
                      {categoryViolations.slice(0, 5).map((v) => (
                        <div key={v.id} className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-mono font-medium text-[#1A1A1A]">
                            {v.violation_code}
                          </span>
                          {v.oos_violation && (
                            <span className="text-[#DC362E] font-medium">OOS</span>
                          )}
                          <span className="text-gray-400">
                            Severity: {v.severity_weight ?? "—"} · Time weight: {v.time_weight ?? "—"}
                          </span>
                        </div>
                      ))}
                      {categoryViolations.length > 5 && (
                        <p className="text-xs text-gray-400">
                          +{categoryViolations.length - 5} more violations
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-[#E5E5E5] bg-[#F4F4F4] px-6 py-10 text-center">
            <Shield className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-[#1A1A1A]">No score data yet</p>
            <p className="text-xs text-gray-500 mt-1">
              Your first safety assessment is being prepared.
            </p>
          </div>
        )}
      </div>

      {/* Inspection history */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Inspection history</h2>
          <span className="text-xs text-gray-400">{inspections?.length ?? 0} inspections</span>
        </div>

        {inspections && inspections.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-[#F4F4F4] border-b border-[#E5E5E5]">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">State</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Level</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Facility</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Violations</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">OOS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {inspections.map((insp) => (
                <tr key={insp.id} className="hover:bg-[#F4F4F4] transition-colors">
                  <td className="px-5 py-3 text-xs text-[#1A1A1A] whitespace-nowrap">
                    {formatDate(insp.inspection_date)}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{insp.state ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{insp.level ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-gray-500 max-w-xs truncate">
                    {insp.facility_name ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        insp.total_violations > 0 ? "text-[#DC362E]" : "text-gray-400"
                      }`}
                    >
                      {insp.total_violations}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        insp.oos_violations > 0 ? "text-[#DC362E]" : "text-gray-400"
                      }`}
                    >
                      {insp.oos_violations}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-5 py-10 text-center">
            <ChevronDown className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No inspection records on file</p>
          </div>
        )}
      </div>

      {/* Crash history */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="font-semibold text-[#1A1A1A] text-sm">Crash history</h2>
          <span className="text-xs text-gray-400">{crashes?.length ?? 0} crashes</span>
        </div>

        {crashes && crashes.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-[#F4F4F4] border-b border-[#E5E5E5]">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Location</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Fatalities</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Injuries</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Tow-away</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">CPDP eligible</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {crashes.map((crash) => (
                <tr key={crash.id} className="hover:bg-[#F4F4F4] transition-colors">
                  <td className="px-5 py-3 text-xs text-[#1A1A1A] whitespace-nowrap">
                    {formatDate(crash.crash_date)}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {[crash.city, crash.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        crash.fatalities > 0 ? "text-[#DC362E]" : "text-gray-400"
                      }`}
                    >
                      {crash.fatalities}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        crash.injuries > 0 ? "text-[#C5A059]" : "text-gray-400"
                      }`}
                    >
                      {crash.injuries}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {crash.tow_away ? "Yes" : "No"}
                  </td>
                  <td className="px-5 py-3">
                    {crash.cpdp_eligible ? (
                      <span className="text-xs font-medium text-[#C5A059]">Eligible</span>
                    ) : crash.cpdp_eligible === false ? (
                      <span className="text-xs text-gray-400">Not eligible</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-gray-500">No crash records on file</p>
          </div>
        )}
      </div>
    </div>
  );
}
