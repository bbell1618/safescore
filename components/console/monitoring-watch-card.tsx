import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getRecentSnapshots } from "@/lib/monitoring/diff";
import { monitoringWatchStatusText, mostRecentMonitoringCheck } from "@/lib/monitoring/watch-status";

export async function MonitoringWatchCard({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const [snapshots, run] = await Promise.all([
    getRecentSnapshots(clientId, 1),
    supabase.from("activity_log").select("created_at,metadata").eq("client_id", clientId).filter("metadata->>source", "eq", "monitoring_cron").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (run.error) throw new Error(`Unable to load monitoring settings: ${run.error.message}`);
  const latest = snapshots[0];
  const source = run.data?.metadata?.source;
  if (run.data && typeof source !== "string") throw new Error("Latest monitoring run is missing source metadata");
  const lastCheck = mostRecentMonitoringCheck([
    run.data && typeof source === "string" ? { timestamp: run.data.created_at, source, kind: "run" } : null,
    latest ? { timestamp: latest.captured_at, source: latest.source, kind: "snapshot" } : null,
  ]);
  const status = monitoringWatchStatusText({ lastCheck, lastRun: run.data ? { timestamp: run.data.created_at, snapshotStatus: typeof run.data.metadata?.snapshot_status === "string" ? run.data.metadata.snapshot_status : null } : null, lastSnapshot: latest ? { timestamp: latest.captured_at } : null });
  return <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm"><h2 className="font-heading text-2xl text-navy">Monitoring settings</h2><p className="mt-3 text-sm leading-6 text-warm-mid">{status}</p><Link href={`/console/clients/${clientId}/work#monitoring`} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-amber-dark">Open monitoring work →</Link></section>;
}
