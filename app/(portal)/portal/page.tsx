import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCarrier } from "@/lib/fmcsa/client";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import { formatViolationScopeFact } from "@/lib/analysis/violation-scope-presentation";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";
import { Badge } from "@/components/ui/badge";
import { formatDate, priorityVariant } from "@/lib/utils";
import {
  MapPin,
  Truck,
  Users2,
  CheckCircle2,
  FileSearch,
  ShieldAlert,
  Info,
  AlertTriangle,
  Activity,
} from "lucide-react";

export const dynamic = "force-dynamic";


type ActionItem = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  type: string;
};

const actionItemTypeLabel: Record<string, string> = {
  dataq: "DataQ",
  cpdp: "CPDP",
  mcs150: "MCS-150",
  compliance: "Compliance",
  monitoring: "Monitoring",
};

export default async function PortalDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch user record to get client_id
  const { data: userRecord } = await supabase
    .from("users")
    .select("client_id")
    .eq("id", user.id)
    .single();

  // No client linked yet
  if (!userRecord?.client_id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[#FEFCF8] flex items-center justify-center">
          <Info className="w-6 h-6 text-gray-400" />
        </div>
        <div>
          <h2
            className="text-lg font-bold text-[#1E1C1A]"
          >
            Your account is being set up
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md">
            Your GEIA account manager is linking your company profile. You will have access to your
            dashboard within 24 hours.
          </p>
        </div>
      </div>
    );
  }

  const clientId = userRecord.client_id;
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();
  if (clientError) throw new Error(`Unable to load portal client: ${clientError.message}`);
  if (!client) redirect("/portal");

  const clientTier = normalizeClientTier(client.tier);
  const canSeeCases = tierHasFeature(clientTier, "case_visibility");
  const canSeePlaybook = tierHasFeature(clientTier, "playbook_coach");
  const { inspectionIds: canonicalInspectionIds } =
    await getCanonicalInspectionScope(clientId, supabase);
  const violationCountQuery = supabase
    .from("violations")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId);

  // Fetch all dashboard data in parallel
  const [
    { data: dataqCases },
    { data: cpdpCases },
    { data: actionItems },
    { count: completedActionCount },
    { count: violationCount },
    { count: crashCount },
  ] = await Promise.all([
    canSeeCases
      ? supabase
          .from("dataq_cases")
          .select("id, status")
          .eq("client_id", clientId)
          .not("status", "in", '("approved","denied","closed")')
      : Promise.resolve({ data: [], error: null }),
    canSeeCases
      ? supabase
          .from("cpdp_cases")
          .select("id, status")
          .eq("client_id", clientId)
          .not("status", "in", '("determination_made","closed")')
      : Promise.resolve({ data: [], error: null }),
    canSeePlaybook
      ? supabase
          .from("action_items")
          .select("*")
          .eq("client_id", clientId)
          .in("status", ["pending", "in_progress"])
          .order("priority", { ascending: true })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    canSeePlaybook
      ? supabase
          .from("action_items")
          .select("*", { count: "exact", head: true })
          .eq("client_id", clientId)
          .eq("status", "completed")
      : Promise.resolve({ count: 0, data: null, error: null }),
    canonicalInspectionIds.length > 0
      ? violationCountQuery.in("inspection_id", canonicalInspectionIds)
      : violationCountQuery.in("inspection_id", []),
    supabase
      .from("crashes")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);

  const burden = await getClientBurden(clientId);

  // Fetch FMCSA carrier data/ (non-blocking — fail gracefully)
  let carrier = null;
  try {
    carrier = await getCarrier(client.dot_number);
  } catch {
    // carrier stays null — display fallback
  }


  const activeDataqCount = dataqCases?.length ?? 0;
  const activeCpdpCount = cpdpCases?.length ?? 0;
  const openCaseCount = activeDataqCount + activeCpdpCount;
  const inWindowViolationCount = burden.perBasic.reduce(
    (total, basic) => total + basic.violationCount,
    0
  );
  const violationScopeFact = formatViolationScopeFact(
    inWindowViolationCount,
    violationCount ?? 0
  );

  return (
    <div className="space-y-6">

      {/* Welcome header */}
      <div>
        <h1
          className="text-xl font-bold text-[#1E1C1A]"
        >
          Welcome back, {client.name}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Your SafeScore dashboard — DOT {client.dot_number}
        </p>
      </div>

      {/* Quick stats row */}
      <div className={`grid gap-4 ${canSeeCases ? "grid-cols-3" : "grid-cols-2"}`}>
        {[
          {
            label: `Violations in 24-month scoring window (${violationCount ?? 0} on file)`,
            value: inWindowViolationCount,
            icon: AlertTriangle,
            iconBg: "bg-[#FDF4E7]",
            iconColor: "text-[#C67A1E]",
          },
          {
            label: "Crashes on file",
            value: crashCount ?? 0,
            icon: Activity,
            iconBg: "bg-orange-50",
            iconColor: "text-orange-600",
          },
          ...(canSeeCases
            ? [{
                label: "Open cases",
                value: openCaseCount,
                icon: FileSearch,
                iconBg: "bg-[#FDF4E7]",
                iconColor: "text-[#C67A1E]",
              }]
            : []),
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center gap-3"
          >
            <div className={`w-9 h-9 rounded-lg ${stat.iconBg} flex items-center justify-center shrink-0`}>
              <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
            </div>
            <div>
              <p
                className="text-2xl font-bold text-[#1E1C1A]"
              >
                {stat.value}
              </p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Carrier info card (FMCSA data) */}
      {carrier && (
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2
            className="font-semibold text-[#1E1C1A] text-sm mb-4"
          >
            Carrier profile
          </h2>
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

      {/* Your safety burden section */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold text-[#1E1C1A] text-sm">Where you stand</h2>
            <p className="text-xs text-gray-500 mt-1">
              {violationScopeFact} FMCSA does not publish percentile rankings for low-volume carriers; this is the weighted violation burden that drives the BASIC measures.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-[#1E1C1A]">{burden.totalPoints}</p>
            <p className="text-xs text-gray-500">weighted points</p>
          </div>
        </div>

        {burden.perBasic.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {burden.perBasic.slice(0, 3).map((b) => (
              <div key={b.basicCategory} className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] p-4">
                <p className="text-xs font-medium text-[#1E1C1A]">{b.label}</p>
                <p className="text-xl font-bold text-[#C67A1E] mt-1">{b.weightedPoints}</p>
                <p className="text-xs text-gray-500 mt-0.5">{b.violationCount} violation{b.violationCount === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] px-6 py-8 text-center">
            <p className="text-sm font-medium text-[#1E1C1A]">No scored violations in the 24-month window.</p>
            <p className="text-xs text-gray-500 mt-1">
              {tierHasFeature(clientTier, "monitoring_alerts")
                ? "We will keep monitoring as new FMCSA data is refreshed."
                : "This assessment reflects the FMCSA data currently available."}
            </p>
          </div>
        )}
      </div>

      {/* Cases summary + Action items */}
      {canSeeCases && canSeePlaybook && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cases summary */}
        <div className="space-y-3">
          <h2
            className="font-semibold text-[#1E1C1A] text-sm"
          >
            GEIA work summary
          </h2>

          <div className="grid grid-cols-1 gap-3">
            {/* DataQs */}
            <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-[#F5EDDB] flex items-center justify-center shrink-0">
                <FileSearch className="w-4 h-4 text-[#8E7340]" />
              </div>
              <div>
                <p
                  className="text-2xl font-bold text-[#1E1C1A]"
                >
                  {activeDataqCount}
                </p>
                <p className="text-xs text-gray-500">Active DataQ challenges</p>
              </div>
            </div>

            {/* CPDP */}
            <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p
                  className="text-2xl font-bold text-[#1E1C1A]"
                >
                  {activeCpdpCount}
                </p>
                <p className="text-xs text-gray-500">Active CPDP filings</p>
              </div>
            </div>

            {/* Completed action items */}
            <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p
                  className="text-2xl font-bold text-[#1E1C1A]"
                >
                  {completedActionCount ?? 0}
                </p>
                <p className="text-xs text-gray-500">Completed action items</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action items */}
        <div className="lg:col-span-2 bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F0E8DA]">
            <h2
              className="font-semibold text-[#1E1C1A] text-sm"
            >
              Open action items
            </h2>
          </div>

          {actionItems && actionItems.length > 0 ? (
            <div className="divide-y divide-[#F0E8DA]">
              {(actionItems as ActionItem[]).map((item) => (
                <div key={item.id} className="px-5 py-3.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1E1C1A]">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    {item.due_date && (
                      <p className="text-xs text-gray-400 mt-1">
                        Due {formatDate(item.due_date)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge variant={priorityVariant(item.priority)}>
                      {item.priority}
                    </Badge>
                    <Badge variant="default">
                      {actionItemTypeLabel[item.type] ?? item.type}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No open action items</p>
            </div>
          )}
        </div>
        </div>
      )}

      {/* GEIA team info banner */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#C67A1E]/10 flex items-center justify-center shrink-0">
          <Info className="w-4 h-4 text-[#C67A1E]" />
        </div>
        <p className="text-sm text-gray-600">
          Your GEIA team is actively working on your account. Questions?{" "}
          <span className="font-medium text-[#1E1C1A]">
            Contact your account manager directly.
          </span>
        </p>
      </div>
    </div>
  );
}
