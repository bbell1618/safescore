import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { assembleClientWorkContext } from "@/lib/operator/checklist-server";
import { evaluateChecklist } from "@/lib/operator/checklist-rules";
import { getRecentSnapshots } from "@/lib/monitoring/diff";
import { isSubscriptionTier } from "@/lib/tiers";

export async function loadConsoleClients() {
  const service = await createServiceClient();
  const result = await service.from("clients").select("id,name,dot_number,tier,status", { count: "exact" }).order("name").range(0, 999);
  if (result.error) throw new Error(`Unable to load clients: ${result.error.message}`);
  const clients = result.data ?? [];
  if (result.count !== clients.length) throw new Error("Unable to load the complete client portfolio");
  const active = await Promise.all(clients.filter(client => client.status === "active").map(async client => {
    const [context, snapshots, alerts, requests] = await Promise.all([
      isSubscriptionTier(client.tier) ? assembleClientWorkContext(client.id, { service }) : Promise.resolve(null),
      !isSubscriptionTier(client.tier) ? getRecentSnapshots(client.id, 2) : Promise.resolve(null),
      service.from("alerts").select("id", { count: "exact", head: true }).eq("client_id", client.id).is("dismissed_at", null).is("read_at", null),
      service.from("client_requests").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("status", "open").eq("responsibility", "client"),
    ]);
    if (alerts.error || requests.error) throw new Error(`Unable to load client workload: ${alerts.error?.message ?? requests.error?.message}`);
    const points = context?.snapshots.map(row => ({ points: row.totalPoints, capturedAt: row.capturedAt })) ?? snapshots?.map(row => ({ points: row.total_points, capturedAt: row.captured_at })) ?? [];
    return { ...client, burden: points[0]?.points ?? null, delta: points.length > 1 ? points[0].points - points[1].points : null, lastRefresh: points[0]?.capturedAt ?? null, openWork: context ? evaluateChecklist(context).length + context.manualItems.filter(row => row.status === "open" && !row.deletedAt).length : 0, waiting: requests.count ?? 0, alerts: alerts.count ?? 0 };
  }));
  active.sort((a, b) => b.openWork - a.openWork || b.alerts - a.alerts || a.name.localeCompare(b.name));
  return { active, other: clients.filter(client => client.status !== "active"), total: clients.length };
}
