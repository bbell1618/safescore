import { Bell, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { TierUpgradeNote } from "@/components/portal/tier-upgrade-note";
import { getPortalPageAccess } from "@/lib/portal/access";
import { diffSnapshots, getRecentSnapshots } from "@/lib/monitoring/diff";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export default async function PortalMonitoringPage() {
  const access = await getPortalPageAccess("trend_history");
  if (!access.allowed) {
    return (
      <TierUpgradeNote
        feature="trend_history"
        currentTier={access.tier}
        title="Monitoring history is not included in your plan"
      />
    );
  }

  const { data: alerts, error: alertsError } = await access.supabase
    .from("alerts")
    .select("id, severity, title, message, created_at, read_at")
    .eq("client_id", access.clientId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(25);
  if (alertsError) throw new Error(`Unable to load monitoring alerts: ${alertsError.message}`);

  const snapshots = await getRecentSnapshots(access.clientId, 12);
  const latest = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;
  const latestDiff = latest && previous ? diffSnapshots(latest, previous) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1E1C1A]">Monitoring</h1>
        <p className="mt-1 text-sm text-gray-500">
          Alerts and the history of your computed weighted violation burden.
        </p>
      </div>

      <section className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#1E1C1A]">Burden trend</h2>
            <p className="mt-1 text-xs text-gray-500">
              {latest ? `Latest snapshot ${formatDate(latest.snapshot_date)}` : "No monitoring snapshot has been captured yet."}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-[#1E1C1A]">{latest?.total_points ?? 0}</p>
            {latestDiff && (
              <p className={latestDiff.totalPointsDelta > 0 ? "text-xs text-[#B83B32]" : "text-xs text-[#3D7A52]"}>
                {latestDiff.totalPointsDelta > 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                {signed(latestDiff.totalPointsDelta)} since prior
              </p>
            )}
          </div>
        </div>
        {latestDiff && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {latestDiff.perBasicDeltas.map((item) => (
              <div key={item.basicCategory} className="flex items-center justify-between rounded-lg border border-[#F0E8DA] bg-white px-3 py-2">
                <span className="text-xs text-gray-600">{BASIC_LABELS[item.basicCategory] ?? item.basicCategory.replaceAll("_", " ")}</span>
                <span className="text-xs font-medium text-[#1E1C1A]">{signed(item.pointsDelta)} pts</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#F0E8DA] bg-[#FBF7F0]">
        <div className="flex items-center gap-2 border-b border-[#F0E8DA] px-5 py-4">
          <Bell className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-[#1E1C1A]">Alerts</h2>
        </div>
        {alerts && alerts.length > 0 ? (
          <div className="divide-y divide-[#F0E8DA]">
            {alerts.map((alert) => (
              <div key={alert.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#1E1C1A]">{alert.title}</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{alert.message}</p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{formatDate(alert.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-green-500" />
            <p className="text-sm text-gray-500">No active monitoring alerts.</p>
          </div>
        )}
      </section>
    </div>
  );
}
