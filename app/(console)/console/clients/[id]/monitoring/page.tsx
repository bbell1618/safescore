import { notFound } from "next/navigation";
import { BASIC_LABELS } from "@/lib/analysis/basic-measure";
import { getBasics } from "@/lib/fmcsa/client";
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

function formatFmcsaDate(value: string | null) {
  if (!value) return null;
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return formatDate(dateOnly ?? value);
}

const OFFICIAL_BASICS = [
  { label: "Unsafe Driving", source: "unsafeDriving", measure: "unsafe_driving_measure", percentile: "unsafe_driving_pct", alert: "unsafe_driving_alert" },
  { label: "HOS Compliance", source: "hosCompliance", measure: "hos_compliance_measure", percentile: "hos_compliance_pct", alert: "hos_compliance_alert" },
  { label: "Driver Fitness", source: "driverFitness", measure: "driver_fitness_measure", percentile: "driver_fitness_pct", alert: "driver_fitness_alert" },
  { label: "Controlled Substances/Alcohol", source: "controlledSubstances", measure: "controlled_substance_measure", percentile: "controlled_substance_pct", alert: "controlled_substance_alert" },
  { label: "Vehicle Maintenance", source: "vehicleMaintenance", measure: "vehicle_maint_measure", percentile: "vehicle_maint_pct", alert: "vehicle_maint_alert" },
  { label: "HM Compliance", source: "hmCompliance", measure: "hm_compliance_measure", percentile: "hm_compliance_pct", alert: "hm_compliance_alert" },
  { label: "Crash Indicator", source: "crashIndicator", measure: "crash_indicator_measure", percentile: "crash_indicator_pct", alert: "crash_indicator_alert" },
] as const;

export default async function MonitoringPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, dot_number")
    .eq("id", id)
    .maybeSingle();

  if (clientError) {
    throw new Error(`Unable to load client monitoring record: ${clientError.message}`);
  }
  if (!client) notFound();

  const { data: officialSnapshot, error: officialSnapshotError } = await supabase
    .from("score_snapshots")
    .select("*")
    .eq("client_id", id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (officialSnapshotError) {
    throw new Error(
      `Unable to load the official FMCSA snapshot: ${officialSnapshotError.message}`
    );
  }

  let publicBasics: Awaited<ReturnType<typeof getBasics>> | null = null;
  let publicBasicsError: string | null = null;
  if (!officialSnapshot || officialSnapshot.source !== "authenticated") {
    try {
      publicBasics = await getBasics(client.dot_number, { throwOnError: true });
    } catch (error) {
      publicBasicsError =
        error instanceof Error ? error.message : "Unknown FMCSA API error";
    }
  }

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
  const watchStatus = monitoringWatchStatusText({ lastCheck });

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

      <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div>
          <h2 className="font-semibold text-[#1E1C1A] text-sm">FMCSA official measures</h2>
          <p className="mt-1 text-xs text-gray-500">
            {publicBasics
              ? `Public FMCSA API · FMCSA SMS snapshot ${formatFmcsaDate(publicBasics.smsSnapshotDate) ?? "date not provided"} · fetched ${formatFmcsaDate(publicBasics.retrievedAt) ?? "date not provided"}. These measures and percentiles are reported by FMCSA; they are not SafeScore burden points.`
              : officialSnapshot
                ? `${officialSnapshot.source === "authenticated" ? "Authenticated FMCSA Portal export" : "Public FMCSA API"} · FMCSA SMS snapshot ${officialSnapshot.source === "authenticated" ? formatDate(officialSnapshot.snapshot_date) : "date unavailable on stored snapshot"} · fetched ${formatDate(officialSnapshot.created_at)}. These measures and percentiles are reported by FMCSA; they are not SafeScore burden points.${publicBasicsError ? ` Live source check failed: ${publicBasicsError}` : ""}`
                : publicBasicsError
                  ? `Unable to load FMCSA official measures: ${publicBasicsError}`
                  : "No FMCSA measure snapshot has been imported yet."}
          </p>
        </div>
        {(publicBasics || officialSnapshot) && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {OFFICIAL_BASICS.map((basic) => {
              const sourceBasic = publicBasics?.[basic.source] ?? null;
              const measure = publicBasics
                ? sourceBasic?.measureValue ?? null
                : officialSnapshot?.[basic.measure] ?? null;
              const percentile = publicBasics
                ? sourceBasic?.percentile ?? null
                : officialSnapshot?.[basic.percentile] ?? null;
              const alert = publicBasics
                ? sourceBasic?.alert ?? false
                : officialSnapshot?.[basic.alert] ?? false;
              return (
                <div key={basic.label} className="rounded-lg border border-[#F0E8DA] bg-white/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-[#1E1C1A]">{basic.label}</p>
                    {alert && <span className="rounded-full bg-[#FDECEA] px-2 py-0.5 text-[10px] font-medium text-[#B83B32]">Alert</span>}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#1E1C1A]">Measure {measure ?? "Unknown"}</p>
                  <p className="text-xs text-gray-500">Percentile {percentile == null ? "Unknown" : `${percentile}%`}</p>
                </div>
              );
            })}
          </div>
        )}
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
