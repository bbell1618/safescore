import { createClient } from "@/lib/supabase/server";
import { getClientBurden } from "@/lib/analysis/basic-measure-server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { QuickAssessment } from "@/components/console/quick-assessment";
import { NewClientButton } from "@/components/console/new-client-button";
import { OperatorToday } from "@/components/console/operator-today";
import { AlertTriangle, CheckCircle, Clock, Users } from "lucide-react";
import { getOperatorToday } from "@/lib/operator/checklist-server";
import {
  normalizeClientTier,
  isClientTier,
  tierBadgeVariant,
  tierDisplayLabel,
} from "@/lib/tiers";

export const dynamic = "force-dynamic";

const statusVariant: Record<string, "success" | "default" | "warning" | "danger" | "outline"> = {
  onboarding: "warning",
  awaiting_activation: "warning",
  active: "success",
  prospect: "outline",
  paused: "warning",
  churned: "default",
};

const statusLabel: Record<string, string> = {
  onboarding: "Onboarding",
  awaiting_activation: "Awaiting activation",
  active: "Active",
  prospect: "Prospect",
  paused: "Paused",
  churned: "Churned",
};

export default async function ConsolePage() {
  const supabase = await createClient();

  const [todayResult, clientsResult, alertsResult] = await Promise.all([
    getOperatorToday()
      .then((payload) => ({ payload, error: null }))
      .catch((error: unknown) => ({
        payload: null,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Today context loading failure",
      })),
    supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("alerts")
      .select("client_id")
      .is("dismissed_at", null)
      .is("read_at", null),
  ]);

  if (clientsResult.error) {
    throw new Error(`Unable to load console clients: ${clientsResult.error.message}`);
  }
  if (alertsResult.error) {
    throw new Error(`Unable to load console alert counts: ${alertsResult.error.message}`);
  }
  const clients = clientsResult.data;
  const alertCounts = alertsResult.data;

  const alertMap = new Map<string, number>();
  for (const a of alertCounts ?? []) {
    alertMap.set(a.client_id, (alertMap.get(a.client_id) ?? 0) + 1);
  }

  const activeCount = clients?.filter((c) => c.status === "active").length ?? 0;
  const onboardingCount =
    clients?.filter((c) =>
      c.status === "onboarding" || c.status === "awaiting_activation"
    ).length ?? 0;
  const alertClients = clients?.filter((c) => (alertMap.get(c.id) ?? 0) > 0) ?? [];
  const clientBurdenEntries = await Promise.all(
    (clients ?? []).map(async (client) => {
      const burden = await getClientBurden(client.id);
      return [client.id, burden] as const;
    })
  );
  const burdenByClient = new Map(clientBurdenEntries);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <OperatorToday
        items={todayResult.payload?.items ?? []}
        gates={todayResult.payload?.gates ?? []}
        error={todayResult.error}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#1E1C1A]">Client overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">All SafeScore clients and prospects</p>
        </div>
        <NewClientButton />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Active clients", value: activeCount, icon: CheckCircle, color: "text-green-600" },
          { label: "Onboarding / activation", value: onboardingCount, icon: Clock, color: "text-[#DAA520]" },
          { label: "Needs attention", value: alertClients.length, icon: AlertTriangle, color: "text-[#C67A1E]" },
          { label: "Total clients", value: clients?.length ?? 0, icon: Users, color: "text-[#1E1C1A]" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center gap-3"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} shrink-0`} />
            <div>
              <p className="text-2xl font-bold text-[#1E1C1A]">{stat.value}</p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Client list */}
        <div className="col-span-2">
          <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F0E8DA] flex items-center justify-between">
              <h2 className="font-semibold text-[#1E1C1A] text-sm">All clients</h2>
              <Link
                href="/console/clients/new"
                className="text-xs text-[#C67A1E] hover:underline font-medium"
              >
                + Add client
              </Link>
            </div>

            {clients && clients.length > 0 ? (
              <div className="divide-y divide-[#F0E8DA]">
                {clients.map((client) => {
                  const alerts = alertMap.get(client.id) ?? 0;
                  const burden = burdenByClient.get(client.id);
                  const topBasic = burden?.perBasic[0] ?? null;
                  const clientTier = normalizeClientTier(client.tier);
                  const clientHasAssignedTier = isClientTier(client.tier);

                  const locationParts = [client.city, client.state].filter(Boolean);

                  return (
                    <Link
                      key={client.id}
                      href={`/console/clients/${client.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#FBF7F0] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[#1E1C1A] text-sm truncate">
                            {client.name}
                          </p>
                          {alerts > 0 && (
                            <AlertTriangle className="w-3.5 h-3.5 text-[#C67A1E] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          DOT {client.dot_number}
                          {locationParts.length > 0 ? ` \u00B7 ${locationParts.join(", ")}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={
                            clientHasAssignedTier
                              ? tierBadgeVariant(clientTier)
                              : "outline"
                          }
                        >
                          {tierDisplayLabel(client.tier)}
                        </Badge>
                        <Badge variant={(statusVariant[client.status] ?? "default") as "success" | "default" | "warning" | "danger"}>
                          {statusLabel[client.status] ?? client.status}
                        </Badge>
                        {burden && (
                          <span className="text-xs font-semibold text-[#C67A1E]">
                            {burden.totalPoints} pts{topBasic ? ` - ${topBasic.label}` : ""}
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
          <QuickAssessment />

          {alertClients.length > 0 && (
            <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#F0E8DA] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#C67A1E]" />
                <h3 className="font-semibold text-[#1E1C1A] text-sm">Needs attention</h3>
              </div>
              <div className="divide-y divide-[#F0E8DA]">
                {alertClients.slice(0, 5).map((client) => (
                  <Link
                    key={client.id}
                    href={`/console/clients/${client.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[#FBF7F0] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1E1C1A] truncate">{client.name}</p>
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
        </div>
      </div>
    </div>
  );
}
