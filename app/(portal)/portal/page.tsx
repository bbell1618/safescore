import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCarrier } from "@/lib/fmcsa/client";
import { ScoreCard } from "@/components/ui/score-card";
import { Badge } from "@/components/ui/badge";
import { OnboardingBanner } from "@/components/portal/onboarding-banner";
import { formatDate, priorityVariant, caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import {
  Building2,
  MapPin,
  Truck,
  Users2,
  CheckCircle2,
  FileSearch,
  ShieldAlert,
  Info,
  ShieldCheck,
  AlertTriangle,
  Activity,
} from "lucide-react";

export const dynamic = "force-dynamic";

const tierLabel: Record<string, string> = {
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
};

const tierVariant = (tier: string | null): "default" | "info" | "gold" => {
  if (tier === "total_safety") return "gold";
  if (tier === "remediate") return "info";
  return "default";
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
        <div className="w-12 h-12 rounded-full bg-[#F4F4F4] flex items-center justify-center">
          <Info className="w-6 h-6 text-gray-400" />
        </div>
        <div>
          <h2
            className="text-lg font-bold text-[#222222]"
            style={{ fontFamily: "var(--font-montserrat)" }}
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

  // Fetch all dashboard data in parallel
  const [
    { data: client },
    { data: snapshot },
    { data: dataqCases },
    { data: cpdpCases },
    { data: actionItems },
    { count: completedActionCount },
    { count: violationCount },
    { count: crashCount },
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
      .from("dataq_cases")
      .select("id, status")
      .eq("client_id", clientId)
      .not("status", "in", '("approved","denied","closed")'),
    supabase
      .from("cpdp_cases")
      .select("id, status")
      .eq("client_id", clientId)
      .not("status", "in", '("determination_made","closed")'),
    supabase
      .from("action_items")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["pending", "in_progress"])
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("action_items")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "completed"),
    supabase
      .from("violations")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabase
      .from("crashes")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);

  if (!client) redirect("/portal");

  // Fetch FMCSA carrier data (non-blocking — fail gracefully)
  let carrier = null;
  try {
    carrier = await getCarrier(client.dot_number);
  } catch {
    // carrier stays null — display fallback
  }

  const basicsArray = snapshot
    ? [
        {
          key: "unsafeDriving",
          label: "Unsafe driving",
          measure: snapshot.unsafe_driving_measure,
          percentile: snapshot.unsafe_driving_pct,
        },
        {
          key: "hosCompliance",
          label: "HOS compliance",
          measure: snapshot.hos_compliance_measure,
          percentile: snapshot.hos_compliance_pct,
        },
        {
          key: "driverFitness",
          label: "Driver fitness",
          measure: snapshot.driver_fitness_measure,
          percentile: snapshot.driver_fitness_pct,
        },
        {
          key: "controlledSubstance",
          label: "Controlled substances",
          measure: snapshot.controlled_substance_measure,
          percentile: snapshot.controlled_substance_pct,
        },
        {
          key: "vehicleMaint",
          label: "Vehicle maintenance",
          measure: snapshot.vehicle_maint_measure,
          percentile: snapshot.vehicle_maint_pct,
        },
        {
          key: "hmCompliance",
          label: "HM compliance",
          measure: snapshot.hm_compliance_measure,
          percentile: snapshot.hm_compliance_pct,
        },
        {
          key: "crashIndicator",
          label: "Crash indicator",
          measure: snapshot.crash_indicator_measure,
          percentile: snapshot.crash_indicator_pct,
        },
      ]
    : [];

  const activeDataqCount = dataqCases?.length ?? 0;
  const activeCpdpCount = cpdpCases?.length ?? 0;
  const openCaseCount = activeDataqCount + activeCpdpCount;

  return (
    <div className="space-y-6">
      {/* Onboarding banner (shown when no snapshot) */}
      {!snapshot && <OnboardingBanner />}

      {/* Welcome header */}
      <div>
        <h1
          className="text-xl font-bold text-[#222222]"
          style={{ fontFamily: "var(--font-montserrat)" }}
        >
          Welcome back, {client.name}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Your SafeScore dashboard — DOT {client.dot_number}
        </p>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: "Violations on file",
            value: violationCount ?? 0,
            icon: AlertTriangle,
            iconBg: "bg-red-50",
            iconColor: "text-[#DC362E]",
          },
          {
            label: "Crashes on file",
            value: crashCount ?? 0,
            icon: Activity,
            iconBg: "bg-orange-50",
            iconColor: "text-orange-600",
          },
          {
            label: "Open cases",
            value: openCaseCount,
            icon: FileSearch,
            iconBg: "bg-blue-50",
            iconColor: "text-blue-600",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center gap-3"
          >
            <div className={`w-9 h-9 rounded-lg ${stat.iconBg} flex items-center justify-center shrink-0`}>
              <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
            </div>
            <div>
              <p
                className="text-2xl font-bold text-[#222222]"
                style={{ fontFamily: "var(--font-montserrat)" }}
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
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
          <h2
            className="font-semibold text-[#222222] text-sm mb-4"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            Carrier profile
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Legal name</p>
              <p className="text-sm font-medium text-[#222222]">{carrier.legalName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">DOT number</p>
              <p className="text-sm font-medium text-[#222222]">{carrier.dotNumber}</p>
            </div>
            {carrier.mcNumber && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">MC number</p>
                <p className="text-sm font-medium text-[#222222]">{carrier.mcNumber}</p>
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
              <p className="text-sm font-medium text-[#222222] flex items-center gap-1">
                <Truck className="w-3.5 h-3.5 text-gray-400" />
                {carrier.totalPowerUnits}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Drivers</p>
              <p className="text-sm font-medium text-[#222222] flex items-center gap-1">
                <Users2 className="w-3.5 h-3.5 text-gray-400" />
                {carrier.totalDrivers}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Safety rating</p>
              <p className="text-sm font-medium text-[#222222]">
                {carrier.safetyRating ?? "Not rated"}
              </p>
            </div>
            {(carrier.phyCity || carrier.phyState) && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Location</p>
                <p className="text-sm font-medium text-[#222222] flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  {[carrier.phyCity, carrier.phyState].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Your Safety Score section */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              className="font-semibold text-[#222222] text-sm"
              style={{ fontFamily: "var(--font-montserrat)" }}
            >
              Your safety score
            </h2>
            {snapshot && (
              <p className="text-xs text-gray-400 mt-0.5">
                BASIC measures as of {formatDate(snapshot.snapshot_date)}
              </p>
            )}
          </div>
          {snapshot && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <ShieldCheck className="w-4 h-4" />
              Assessment complete
            </div>
          )}
        </div>

        {basicsArray.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {basicsArray.map((b) => (
              <ScoreCard
                key={b.key}
                label={b.label}
                measure={b.measure as number | null}
                percentile={b.percentile as number | null}
                alert={
                  (b.percentile as number | null) !== null &&
                  (b.percentile as number) >= 80
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[#E5E5E5] bg-[#F4F4F4] px-6 py-10 text-center">
            <ShieldCheck className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-[#222222]">
              Your first safety assessment is being prepared.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              You&apos;ll receive an email when it&apos;s ready.
            </p>
          </div>
        )}
      </div>

      {/* Cases summary + Action items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cases summary */}
        <div className="space-y-3">
          <h2
            className="font-semibold text-[#222222] text-sm"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            GEIA work summary
          </h2>

          <div className="grid grid-cols-1 gap-3">
            {/* DataQs */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <FileSearch className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p
                  className="text-2xl font-bold text-[#222222]"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  {activeDataqCount}
                </p>
                <p className="text-xs text-gray-500">Active DataQ challenges</p>
              </div>
            </div>

            {/* CPDP */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p
                  className="text-2xl font-bold text-[#222222]"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  {activeCpdpCount}
                </p>
                <p className="text-xs text-gray-500">Active CPDP filings</p>
              </div>
            </div>

            {/* Completed action items */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p
                  className="text-2xl font-bold text-[#222222]"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  {completedActionCount ?? 0}
                </p>
                <p className="text-xs text-gray-500">Completed action items</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action items */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E5E5E5]">
            <h2
              className="font-semibold text-[#222222] text-sm"
              style={{ fontFamily: "var(--font-montserrat)" }}
            >
              Open action items
            </h2>
          </div>

          {actionItems && actionItems.length > 0 ? (
            <div className="divide-y divide-[#E5E5E5]">
              {actionItems.map((item: any) => (
                <div key={item.id} className="px-5 py-3.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#222222]">{item.title}</p>
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

      {/* GEIA team info banner */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#DC362E]/10 flex items-center justify-center shrink-0">
          <Info className="w-4 h-4 text-[#DC362E]" />
        </div>
        <p className="text-sm text-gray-600">
          Your GEIA team is actively working on your account. Questions?{" "}
          <span className="font-medium text-[#222222]">
            Contact your account manager directly.
          </span>
        </p>
      </div>
    </div>
  );
}
