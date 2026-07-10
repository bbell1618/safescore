import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCarrier } from "@/lib/fmcsa/client";
import { formatDate } from "@/lib/utils";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import {
  Building2,
  MapPin,
  Truck,
  Users2,
  ChevronDown,
  Shield,
} from "lucide-react";

export const dynamic = "force-dynamic";


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
  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(clientId, supabase);
  const inspectionsQuery = supabase
    .from("inspections")
    .select("*, violations(id, violation_code, violation_description, basic_category, severity_weight, oos_violation)")
    .eq("client_id", clientId)
    .order("inspection_date", { ascending: false });

  const [
    { data: client },
    { data: inspections },
    { data: crashes },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).single(),
    canonicalInspectionIds.length > 0
      ? inspectionsQuery.in("id", canonicalInspectionIds)
      : inspectionsQuery.in("id", []),
    supabase
      .from("crashes")
      .select("*")
      .eq("client_id", clientId)
      .order("crash_date", { ascending: false }),
  ]);
  const burden = await getClientBurden(clientId);

  if (!client) redirect("/portal");

  let carrier = null;
  try {
    carrier = await getCarrier(client.dot_number);
  } catch {
    // fail gracefully
  }


  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1E1C1A]">Safety profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Carrier details, inspection history, and BASIC breakdown for DOT {client.dot_number}
        </p>
      </div>

      {/* Carrier info card */}
      {carrier && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-[#1E1C1A] text-sm">Carrier information</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Legal name</p>
              <p className="text-sm font-medium text-[#1E1C1A]">{carrier.legalName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">DOT number</p>
              <p className="text-sm font-medium text-[#1E1C1A]">{carrier.dotNumber}</p>
            </div>
            {carrier.mcNumber && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">MC number</p>
                <p className="text-sm font-medium text-[#1E1C1A]">{carrier.mcNumber}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Operating status</p>
              <span
                className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                  carrier.usdotStatus === "ACTIVE" || carrier.statusCode === "A"
                    ? "bg-[#E8F3EC] text-[#3D7A52]"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {carrier.usdotStatus ?? carrier.statusCode ?? "Unknown"}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Power units</p>
              <p className="text-sm font-medium text-[#1E1C1A] flex items-center gap-1">
                <Truck className="w-3.5 h-3.5 text-gray-400" />
                {carrier.totalPowerUnits}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Drivers</p>
              <p className="text-sm font-medium text-[#1E1C1A] flex items-center gap-1">
                <Users2 className="w-3.5 h-3.5 text-gray-400" />
                {carrier.totalDrivers}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Safety rating</p>
              <p className="text-sm font-medium text-[#1E1C1A]">
                {carrier.safetyRating ?? "Not rated"}
              </p>
            </div>
            {(carrier.phyCity || carrier.phyState) && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Location</p>
                <p className="text-sm font-medium text-[#1E1C1A] flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  {[carrier.phyCity, carrier.phyState].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSA burden */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA]">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-[#1E1C1A] text-sm">
              Where your safety-score pressure comes from
            </h2>
            <span className="text-xs text-gray-400 ml-auto">As of {formatDate(burden.asOf)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            FMCSA does not publish percentile rankings for low-volume carriers; this is the weighted violation burden that drives the BASIC measures.
          </p>
        </div>

        {burden.perBasic.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead className="bg-[#FEFCF8] border-b border-[#F0E8DA]">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">BASIC</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Weighted points</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">24-mo violations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0E8DA]">
                {burden.perBasic.map((b) => (
                  <tr key={b.basicCategory}>
                    <td className="px-5 py-3 text-xs font-medium text-[#1E1C1A]">{b.label}</td>
                    <td className="px-5 py-3 text-right text-xs font-semibold text-[#C67A1E]">{b.weightedPoints}</td>
                    <td className="px-5 py-3 text-right text-xs text-gray-500">{b.violationCount}</td>
                  </tr>
                ))}
                <tr className="bg-[#FEFCF8]">
                  <td className="px-5 py-3 text-xs font-semibold text-[#1E1C1A]">Total</td>
                  <td className="px-5 py-3 text-right text-xs font-bold text-[#1E1C1A]">{burden.totalPoints}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">
                    {burden.perBasic.reduce((sum, b) => sum + b.violationCount, 0)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="px-5 py-4 border-t border-[#F0E8DA]">
              <h3 className="font-semibold text-[#1E1C1A] text-sm mb-3">
                Top violations by score impact
              </h3>
              <div className="bg-white rounded-lg border border-[#F0E8DA] divide-y divide-[#F0E8DA]">
                {burden.topViolations.map((v) => (
                  <div key={v.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-[#1E1C1A]">
                          {v.violationCode || "--"}
                        </span>
                        <span className="text-[10px] text-gray-500 bg-[#F0E8DA] rounded px-1.5 py-0.5">
                          {BASIC_LABELS[v.basicCategory ?? ""] ?? v.basicCategory ?? "Unknown"}
                        </span>
                        {v.oosViolation && (
                          <span className="text-[10px] font-medium text-[#C67A1E] bg-[#FDF4E7] border border-amber-200 rounded px-1.5 py-0.5">
                            OOS
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5 truncate">
                        {v.violationDescription ?? ""}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {v.inspectionDate ? formatDate(v.inspectionDate) : "--"} · Severity {v.severityWeight ?? "--"} · Time weight {v.timeWeight}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-[#1E1C1A] shrink-0">
                      {v.points} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-400">No scored violations in the 24-month window.</p>
          </div>
        )}
      </div>

      {/* Inspection history */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA] flex items-center justify-between">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Inspection history</h2>
          <span className="text-xs text-gray-400">{inspections?.length ?? 0} inspections</span>
        </div>

        {inspections && inspections.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-[#FEFCF8] border-b border-[#F0E8DA]">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">State</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Level</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Facility</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Violations</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">OOS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E8DA]">
              {inspections.map((insp) => (
                <tr key={insp.id} className="hover:bg-[#FBF7F0] transition-colors">
                  <td className="px-5 py-3 text-xs text-[#1E1C1A] whitespace-nowrap">
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
                        insp.total_violations > 0 ? "text-[#C67A1E]" : "text-gray-400"
                      }`}
                    >
                      {insp.total_violations}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        insp.oos_violations > 0 ? "text-[#C67A1E]" : "text-gray-400"
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
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#F0E8DA] flex items-center justify-between">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Crash history</h2>
          <span className="text-xs text-gray-400">{crashes?.length ?? 0} crashes</span>
        </div>

        {crashes && crashes.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-[#FEFCF8] border-b border-[#F0E8DA]">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Location</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Fatalities</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">Injuries</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Tow-away</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">CPDP eligible</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E8DA]">
              {crashes.map((crash) => (
                <tr key={crash.id} className="hover:bg-[#FBF7F0] transition-colors">
                  <td className="px-5 py-3 text-xs text-[#1E1C1A] whitespace-nowrap">
                    {formatDate(crash.crash_date)}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {[crash.city, crash.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        crash.fatalities > 0 ? "text-[#C67A1E]" : "text-gray-400"
                      }`}
                    >
                      {crash.fatalities}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        crash.injuries > 0 ? "text-[#DAA520]" : "text-gray-400"
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
                      <span className="text-xs font-medium text-[#DAA520]">Eligible</span>
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
