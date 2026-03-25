"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScoreCard } from "@/components/ui/score-card";
import { simulateScoreImpact, summarizeImpact, type ViolationForCalc } from "@/lib/analysis/score-impact";
import { formatDate, priorityVariant } from "@/lib/utils";
import { AlertTriangle, CheckCircle, Clock, TrendingDown, Plus } from "lucide-react";

interface ViolationRow {
  id: string;
  violation_code: string;
  violation_description: string;
  basic_category: string | null;
  severity_weight: number | null;
  time_weight: number | null;
  oos_violation: boolean;
  convicted: boolean;
  challengeable: boolean | null;
  challenge_reason: string | null;
  challenge_priority: string | null;
  ai_assessed_at: string | null;
  inspections?: {
    inspection_date: string;
    state: string;
    level: string;
    facility_name: string;
  } | null;
}

interface SnapshotRow {
  unsafe_driving_measure: number | null;
  unsafe_driving_pct: number | null;
  hos_compliance_measure: number | null;
  hos_compliance_pct: number | null;
  vehicle_maint_measure: number | null;
  vehicle_maint_pct: number | null;
  crash_indicator_measure: number | null;
  crash_indicator_pct: number | null;
  driver_fitness_measure: number | null;
  driver_fitness_pct: number | null;
}

interface Props {
  clientId: string;
  violations: ViolationRow[];
  snapshot: SnapshotRow | null;
}

export function ViolationAnalyzer({ clientId, violations, snapshot }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "challengeable" | "not_challengeable" | "pending">("all");
  const [assessingAll, setAssessingAll] = useState(false);
  const [assessProgress, setAssessProgress] = useState(0);

  const filtered = useMemo(() => {
    switch (filter) {
      case "challengeable": return violations.filter((v) => v.challengeable === true);
      case "not_challengeable": return violations.filter((v) => v.challengeable === false);
      case "pending": return violations.filter((v) => v.challengeable === null);
      default: return violations;
    }
  }, [violations, filter]);

  const violationsForCalc: ViolationForCalc[] = violations.map((v) => ({
    id: v.id,
    basicCategory: v.basic_category ?? "vehicle_maintenance",
    severityWeight: v.severity_weight ?? 1,
    timeWeight: v.time_weight ?? 1,
    oosViolation: v.oos_violation,
  }));

  const currentSnapshots: Record<string, { measureValue: number; percentile: number | null }> = snapshot
    ? {
        unsafe_driving: { measureValue: snapshot.unsafe_driving_measure ?? 0, percentile: snapshot.unsafe_driving_pct ?? null },
        hos_compliance: { measureValue: snapshot.hos_compliance_measure ?? 0, percentile: snapshot.hos_compliance_pct ?? null },
        vehicle_maintenance: { measureValue: snapshot.vehicle_maint_measure ?? 0, percentile: snapshot.vehicle_maint_pct ?? null },
        crash_indicator: { measureValue: snapshot.crash_indicator_measure ?? 0, percentile: snapshot.crash_indicator_pct ?? null },
        driver_fitness: { measureValue: snapshot.driver_fitness_measure ?? 0, percentile: snapshot.driver_fitness_pct ?? null },
      }
    : {};

  const impactResults = useMemo(() => {
    if (selected.size === 0 || !snapshot) return [];
    return simulateScoreImpact(violationsForCalc, currentSnapshots, Array.from(selected));
  }, [selected, snapshot]);

  const impact = useMemo(() => summarizeImpact(impactResults), [impactResults]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssessAll() {
    setAssessingAll(true);
    setAssessProgress(0);
    const pendingViolations = violations.filter((v) => v.challengeable === null);
    try {
      const res = await fetch(`/api/analysis/assess-violations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, violationIds: pendingViolations.map((v) => v.id) }),
      });
      if (!res.ok) throw new Error("Assessment failed");
      window.location.reload();
    } catch (err) {
      console.error(err);
    } finally {
      setAssessingAll(false);
    }
  }

  async function createDataqCase(violationId: string) {
    const res = await fetch(`/api/cases/dataq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, violationId }),
    });
    if (res.ok) {
      const d = await res.json();
      window.location.href = `/console/clients/${clientId}/dataq?case=${d.caseId}`;
    }
  }

  const pendingCount = violations.filter((v) => v.challengeable === null).length;

  return (
    <div className="space-y-4">
      {/* Score impact simulator */}
      {selected.size > 0 && snapshot && (
        <div className="bg-[#1A1A1A] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-[#C5A059]" />
            <h3
              className="text-white font-semibold text-sm"
             
            >
              Score impact simulator — {selected.size} violation{selected.size > 1 ? "s" : ""} selected
            </h3>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {impactResults.slice(0, 4).map((r) => (
              <div key={r.basicCategory} className="bg-white/10 rounded-lg p-3">
                <p className="text-white/60 text-xs mb-1">{r.basicCategory.replace(/_/g, " ")}</p>
                <p className="text-white font-bold text-lg">
                  {r.projectedMeasure.toFixed(1)}
                </p>
                <p className={`text-xs font-medium ${r.measureDelta < 0 ? "text-green-400" : "text-white/40"}`}>
                  {r.measureDelta < 0 ? `↓ ${Math.abs(r.measureDelta).toFixed(1)}` : "No change"}
                </p>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-xs text-white/60">
            <span>
              Improving categories: <strong className="text-white">{impact.improvingCategories}</strong>
            </span>
            <span>
              Est. measure reduction: <strong className="text-green-400">{Math.abs(impact.totalMeasureDelta).toFixed(1)}</strong>
            </span>
            {impact.alertsRemoved > 0 && (
              <span>
                BASIC alerts cleared: <strong className="text-[#C5A059]">{impact.alertsRemoved}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {(["all", "challengeable", "not_challengeable", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-[#1A1A1A] text-white"
                  : "bg-[#F4F4F4] text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "all" ? "All" : f === "challengeable" ? "Challengeable" : f === "not_challengeable" ? "Not challengeable" : "Pending assessment"}
            </button>
          ))}
        </div>
        {pendingCount > 0 && (
          <button
            onClick={handleAssessAll}
            disabled={assessingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#DC362E] text-white rounded-lg text-xs font-medium hover:bg-[#b52a23] transition-colors disabled:opacity-50"
          >
            <Clock className="w-3.5 h-3.5" />
            {assessingAll ? `Assessing... (${assessProgress}/${pendingCount})` : `AI assess ${pendingCount} pending`}
          </button>
        )}
      </div>

      {/* Violations table */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-[#E5E5E5] bg-[#F4F4F4]">
            <tr>
              <th className="w-10 px-4 py-3"></th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Code</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Description</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">BASIC</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Date</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Challenge</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Severity</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E5E5]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No violations found
                </td>
              </tr>
            ) : (
              filtered.map((v) => (
                <tr
                  key={v.id}
                  className={`hover:bg-[#F4F4F4] transition-colors ${selected.has(v.id) ? "bg-[#F5EDDB]" : ""}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggleSelect(v.id)}
                      disabled={v.challengeable === false}
                      className="rounded border-gray-300 text-[#DC362E] focus:ring-[#DC362E]"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-medium text-[#1A1A1A]">
                    {v.violation_code}
                    {v.oos_violation && (
                      <span className="ml-1 text-[10px] font-sans text-[#DC362E] font-medium">OOS</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#1A1A1A] max-w-xs">
                    <p className="truncate">{v.violation_description}</p>
                    {v.challenge_reason && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{v.challenge_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500">
                      {v.basic_category?.replace(/_/g, " ") ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {v.inspections?.inspection_date
                      ? formatDate(v.inspections.inspection_date)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {v.challengeable === null ? (
                      <Badge variant="default">Pending</Badge>
                    ) : v.challengeable ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        {v.challenge_priority && (
                          <Badge variant={priorityVariant(v.challenge_priority)}>
                            {v.challenge_priority}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not challengeable</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-semibold ${
                        (v.severity_weight ?? 0) >= 8
                          ? "text-[#DC362E]"
                          : (v.severity_weight ?? 0) >= 5
                          ? "text-[#C5A059]"
                          : "text-gray-400"
                      }`}
                    >
                      {v.severity_weight ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {v.challengeable && (
                      <button
                        onClick={() => createDataqCase(v.id)}
                        className="flex items-center gap-1 text-xs text-[#DC362E] hover:underline font-medium"
                      >
                        <Plus className="w-3 h-3" />
                        Create case
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
