import { notFound } from "next/navigation";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { diffSnapshots, getRecentSnapshots } from "@/lib/monitoring/diff";
import {
  monitoringWatchStatusText,
  mostRecentMonitoringCheck,
} from "@/lib/monitoring/watch-status";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function signed(value: number) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function movementClass(value: number) {
  if (value > 0) return "text-[#B83B32]";
  if (value < 0) return "text-[#3D7A52]";
  return "text-gray-500";
}

export default async function MonitoringPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Unable to load client monitoring record: ${clientError.message}`);
  }
  if (!client) notFound();

  const snapshots = await getRecentSnapshots(id, 12);
  const latest = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;
  const diff = latest && previous ? diffSnapshots(latest, previous) : null;
  const snapshotRows = snapshots.map((snapshot, index) => ({
    snapshot,
    diffFromPrior: snapshots[index + 1] ? diffSnapshots(snapshot, snapshots[index + 1]) : null,
  }));

  const { data: latestMonitoringRun, error: latestMonitoringRunError } =
    await supabase
      .from("activity_log")
      .select("created_at, metadata")
      .eq("client_id", id)
      .filter("metadata->>source", "eq", "monitoring_cron")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  if (latestMonitoringRunError) {
    throw new Error(
      `Unable to load the latest monitoring run: ${latestMonitoringRunError.message}`
    );
  }

  const runSource = latestMonitoringRun?.metadata?.source;
  if (latestMonitoringRun && typeof runSource !== "string") {
    throw new Error("Latest monitoring run is missing its source metadata");
  }
  const lastCheck = mostRecentMonitoringCheck([
    latestMonitoringRun && typeof runSource === "string"
      ? {
          timestamp: latestMonitoringRun.created_at,
          source: runSource,
          kind: "run",
        }
      : null,
    latest
      ? {
          timestamp: latest.captured_at,
          source: latest.source,
          kind: "snapshot",
        }
      : null,
  ]);
  const snapshotStatus = latestMonitoringRun?.metadata?.snapshot_status;
  const watchStatus = monitoringWatchStatusText({
    lastCheck,
    lastRun: latestMonitoringRun
      ? {
          timestamp: latestMonitoringRun.created_at,
          snapshotStatus: typeof snapshotStatus === "string" ? snapshotStatus : null,
        }
      : null,
    lastSnapshot: latest ? { timestamp: latest.captured_at } : null,
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <h1 className="text-xl font-bold text-[#1E1C1A]">Monitoring</h1>
        {latest && previous && diff ? (
          <p className="text-sm text-gray-500 mt-1">
            Since {formatDate(previous.snapshot_date)}, in-window burden moved from {previous.total_points} to {latest.total_points}.
          </p>
        ) : latest ? (
          <p className="text-sm text-gray-500 mt-1">
            Monitoring baseline captured {formatDate(latest.snapshot_date)}. The first comparison appears after the next refresh.
          </p>
        ) : (
          <p className="text-sm text-gray-500 mt-1">
            Monitoring is ready, but no burden snapshots have been captured yet.
          </p>
        )}
      </div>

      <section
        aria-label="Monitoring watch status"
        className="rounded-xl border border-[#D9E8DD] bg-[#F3F8F4] px-5 py-4"
      >
        <p className="text-sm font-medium leading-6 text-[#315E3E]">
          {watchStatus}
        </p>
      </section>

      <div>
        <h2 className="font-semibold text-[#1E1C1A] text-sm">SafeScore computed burden</h2>
        <p className="mt-1 text-xs text-gray-500">Calculated from the canonical in-window inspection and violation layer.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">In-window burden</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{latest?.total_points ?? 0}</p>
          {diff && <p className={`text-xs mt-1 ${movementClass(diff.totalPointsDelta)}`}>{signed(diff.totalPointsDelta)} since prior</p>}
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Violations</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{latest?.violation_count ?? 0}</p>
          {diff && <p className={`text-xs mt-1 ${movementClass(diff.violationCountDelta)}`}>{signed(diff.violationCountDelta)} since prior</p>}
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Inspections</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{latest?.inspection_count ?? 0}</p>
          {diff && <p className={`text-xs mt-1 ${movementClass(diff.inspectionCountDelta)}`}>{signed(diff.inspectionCountDelta)} since prior</p>}
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">Crashes</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{latest?.crash_count ?? 0}</p>
          {diff && <p className={`text-xs mt-1 ${movementClass(diff.crashCountDelta)}`}>{signed(diff.crashCountDelta)} since prior</p>}
        </div>
        <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4">
          <p className="text-xs text-gray-500">OOS violations</p>
          <p className="text-2xl font-bold text-[#1E1C1A] mt-1">{latest?.oos_count ?? 0}</p>
          {diff && <p className={`text-xs mt-1 ${movementClass(diff.oosCountDelta)}`}>{signed(diff.oosCountDelta)} since prior</p>}
        </div>
      </div>

      {diff && (
        <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Per-BASIC movement</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {diff.perBasicDeltas.map((item) => (
              <div key={item.basicCategory} className="flex items-center justify-between border border-[#F0E8DA] rounded-lg bg-white/60 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#1E1C1A]">{BASIC_LABELS[item.basicCategory] ?? item.basicCategory.replaceAll("_", " ")}</p>
                  <p className="text-xs text-gray-500">Violation count {signed(item.countDelta)}</p>
                </div>
                <p className={`text-sm font-semibold ${movementClass(item.pointsDelta)}`}>{signed(item.pointsDelta)} pts</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <div className="p-5 border-b border-[#F0E8DA]">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">Snapshot history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/60 text-xs text-gray-500">
              <tr>
                <th className="text-left font-medium px-5 py-3">Snapshot</th>
                <th className="text-left font-medium px-5 py-3">Burden</th>
                <th className="text-left font-medium px-5 py-3">Violations</th>
                <th className="text-left font-medium px-5 py-3">Inspections</th>
                <th className="text-left font-medium px-5 py-3">Crashes</th>
                <th className="text-left font-medium px-5 py-3">Change vs prior</th>
                <th className="text-left font-medium px-5 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E8DA]">
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                    No snapshots captured yet.
                  </td>
                </tr>
              ) : (
                snapshotRows.map(({ snapshot, diffFromPrior }) => (
                  <tr key={snapshot.id}>
                    <td className="px-5 py-4 text-[#1E1C1A]">{formatDate(snapshot.snapshot_date)}</td>
                    <td className="px-5 py-4 font-semibold text-[#1E1C1A]">{snapshot.total_points}</td>
                    <td className="px-5 py-4 text-gray-500">{snapshot.violation_count}</td>
                    <td className="px-5 py-4 text-gray-500">{snapshot.inspection_count}</td>
                    <td className="px-5 py-4 text-gray-500">{snapshot.crash_count}</td>
                    <td className="px-5 py-4 text-xs text-gray-500">
                      {diffFromPrior ? (
                        <div className="space-y-1">
                          <div className={movementClass(diffFromPrior.totalPointsDelta)}>{signed(diffFromPrior.totalPointsDelta)} pts</div>
                          <div>
                            V {signed(diffFromPrior.violationCountDelta)} / I {signed(diffFromPrior.inspectionCountDelta)} / C {signed(diffFromPrior.crashCountDelta)} / OOS {signed(diffFromPrior.oosCountDelta)}
                          </div>
                        </div>
                      ) : (
                        "Baseline"
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-500">{snapshot.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
