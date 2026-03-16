import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ScoreCard } from "@/components/ui/score-card";
import { Badge } from "@/components/ui/badge";
import { OnboardingBanner } from "@/components/portal/onboarding-banner";
import { formatDate, priorityVariant, caseStatusLabel, caseStatusVariant } from "@/lib/utils";
import {
  Building2,
  MapPin,
  CheckCircle2,
  FileSearch,
  ShieldAlert,
  Info,
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
  ]);

  if (!client) redirect("/portal");

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

  return (
    <div className="space-y-6">
      {/* Onboarding banner (shown when no snapshot) */}
      {!snapshot && <OnboardingBanner />}

      {/* Company header */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h1
                className="text-xl font-bold text-[#222222]"
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                {client.name}
              </h1>
              {client.tier && (
                <Badge variant={tierVariant(client.tier)}>
                  {tierLabel[client.tier]}
                </Badge>
              )}
              <Badge variant={client.status === "active" ? "success" : "default"}>
                {client.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                DOT {client.dot_number}
                {client.mc_number ? ` · MC ${client.mc_number}` : ""}
              </span>
              {(client.city || client.state) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {[client.city, client.state].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BASIC score section */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              className="font-semibold text-[#222222] text-sm"
              style={{ fontFamily: "var(--font-montserrat)" }}
            >
              BASIC scores
            </h2>
            {snapshot && (
              <p className="text-xs text-gray-400 mt-0.5">
                As of {formatDate(snapshot.snapshot_date)}
              </p>
            )}
          </div>
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
          <div className="rounded-lg border border-[#E5E5E5] bg-[#F4F4F4] px-5 py-8 text-center">
            <p className="text-sm text-gray-500">
              Your first score snapshot will appear here after GEIA completes your initial
              assessment.
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
                <FileSearch className="w-4.5 h-4.5 text-blue-600" />
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
                <ShieldAlert className="w-4.5 h-4.5 text-amber-600" />
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
                <CheckCircle2 className="w-4.5 h-4.5 text-green-600" />
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
              {actionItems.map((item) => (
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
