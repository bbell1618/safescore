import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { QuickAssessment } from "@/components/console/quick-assessment";
import { NewClientButton } from "@/components/console/new-client-button";
import { AlertTriangle, CheckCircle, Clock, Users, TrendingDown } from "lucide-react";

export const dynamic = "force-dynamic";

const tierLabel: Record<string, string> = {
  monitor: "Monitor",
  remediate: "Remediate",
  total_safety: "Total Safety",
};

const tierVariant: Record<string, "default" | "info" | "gold" | "warning"> = {
  monitor: "default",
  remediate: "info",
  total_safety: "gold",
};

const statusVariant: Record<string, "success" | "default" | "warning" | "danger"> = {
  active: "success",
  prospect: "outline" as "default",
  paused: "warning",
  churned: "default",
};

export default async function ConsolePage() {
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("*, score_snapshots(snapshot_date, vehicle_maint_measure, vehicle_maint_pct, crash_indicator_pct, unsafe_driving_pct, hos_compliance_pct)")
    .order("created_at", { ascending: false });

  const { data: alertCounts } = await supabase
    .from("alerts")
    .select("client_id")
    .is("dismissed_at", null)
    .is("read_at", null);

  const alertMap = new Map<string, number>();
  for (const a of alertCounts ?? []) {
    alertMap.set(a.client_id, (alertMap.get(a.client_id) ?? 0) + 1);
  }

  const activeCount = clients?.filter((c) => c.status === "active").length ?? 0;
  const prospectCount = clients?.filter((c) => c.status === "prospect").length ?? 0;
  const alertClients = clients?.filter((c) => (alertMap.get(c.id) ?? 0) > 0) ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-xl font-bold text-[#1A1A1A]"
          >
            Client overview
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All SafeScore clients and prospects
          </p>
        </div>
        <NewClientButton />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Active clients", value: activeCount, icon: CheckCircle, color: "text-green-600" },
          { label: "Prospects", value: prospectCount, icon: Clock, color: "text-[#C5A059]" },
          { label: "Needs attention", value: alertClients.length, icon: AlertTriangle, color: "text-[#DC362E]" },
          { label: "Total clients", value: clients?.length ?? 0, icon: Users, color: "text-[#1A1A1A]" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center gap-3"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} shrink-0`} />
            <div>
              <p className="text-2xl font-bold text-[#1A1A1A]">
                {stat.value}
              </p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Client list */}
        <div className="col-span-2">
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
              <h2
                className="font-semibold text-[#1A1A1A] text-sm"
              >
                All clients
              </h2>
              <Link
                href="/console/clients/new"
                className="text-xs text-[#DC362E] hover:underline font-medium"
              >
                + Add client
              </Link>
            </div>

            {clients && clients.length > 0 ? (
              <div className="divide-y divide-[#E5E5E5]">
                {clients.map((client) => {
                  const alerts = alertMap.get(client.id) ?? 0;
                  const latestSnapshot = client.score_snapshots?.[0];
                  const worstPct = latestSnapshot
                    ? Math.max(
                        latestSnapshot.vehicle_maint_pct ?? 0,
                        latestSnapshot.crash_indicator_pct ?? 0,
                        latestSnapshot.unsafe_driving_pct ?? 0,
                        latestSnapshot.hos_compliance_pct ?? 0
                      )
                    : null;

                  return (
                    <Link
                      key={client.id}
                      href={`/console/clients/${client.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#F4F4F4] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[#1A1A1A] text-sm truncate">
                            {client.name}
                          </p>
                          {alerts > 0 && (
                            <AlertTriangle className="w-3.5 h-3.5 text-[#DC362E] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          DOT {client.dot_number} · {client.city ?? "—"}, {client.state ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {client.tier && (
                          <Badge variant={tierVariant[client.tier] ?? "default"}>
                            {tierLabel[client.tier]}
                          </Badge>
                        )}
                        <Badge variant={statusVariant[client.status] ?? "default"}>
                          {client.status}
                        </Badge>
                        {worstPct !== null && (
                          <span
                            className={`text-xs font-semibold ${
                              worstPct >= 80
                                ? "text-[#DC362E]"
                                : worstPct >= 65
                                ? "text-[#C5A059]"
                                : "text-green-600"
                            }`}
                          >
                            {worstPct}th
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No clients yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Run a quick assessment below to add your first prospect.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Quick Assessment */}
          <QuickAssessment />

          {/* Needs attention */}
          {alertClients.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E5E5E5] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#DC362E]" />
                <h3
                  className="font-semibold text-[#1A1A1A] text-sm"
                >
                  Needs attention
                </h3>
              </div>
              <div className="divide-y divide-[#E5E5E5]">
                {alertClients.slice(0, 5).map((client) => (
                  <Link
                    key={client.id}
                    href={`/console/clients/${client.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[#F4F4F4] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">
                        {client.name}
                      </p>
                      <p className="text-xs text-gray-400">DOT {client.dot_number}</p>
                    </div>
                    <Badge variant="danger">
                      {alertMap.get(client.id)} alert{(alertMap.get(client.id) ?? 0) > 1 ? "s" : ""}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Tip */}
          <div className="bg-[#1A1A1A] rounded-xl p-4">
            <TrendingDown className="w-5 h-5 text-[#C5A059] mb-2" />
            <p
              className="text-white text-sm font-semibold"
            >
              Pilot client ready
            </p>
            <p className="text-white/60 text-xs mt-1">
              DOT 2533650 — Nationwide Carrier Inc. Run a quick assessment to see the full analysis.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
