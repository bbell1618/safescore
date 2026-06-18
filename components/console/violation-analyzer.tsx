"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScoreCard } from "@/components/ui/score-card";
import { simulateScoreImpact, summarizeImpact, type ViolationForCalc } from "@/lib/analysis/score-impact";
import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
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
  convicted: boolean | null;
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
  const asOf = useMemo(() => new Date(), []);

  function challengeLabelClass(label: string): string {
    if (label === "strong") return "bg-green-50 text-green-700 border-green-200";
    if (label === "moderate") return "bg-amber-50 text-amber-700 border-amber-200";
    if (label === "weak") return "bg-[#F0E8DA] text-gray-700 border-[#E4D7C4]";
    return "bg-gray-50 text-gray-500 border-gray-200";
  }

  return (
    <div className="space-y-4">
      {/* Score impact simulator */}
      {selected.size > 0 && snapshot && (
        <div className="bg-[#1B2D4F] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-[#DAA520]" />
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
                BASIC alerts cleared: <strong className="text-[#DAA520]">{impact.alertsRemoved}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {(["all", "challengeable", "not_challengeable", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-[#1B2D4F] text-white"
                  : "bg-[#FEFCF8] text-gray-600 hover:bg-gray-200"
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
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C67A1E] text-white rounded-lg text-xs font-medium hover:bg-[#B86E18] transition-colors disabled:opacity-50"
          >
            <Clock className="w-3.5 h-3.5" />
            {assessingAll ? `Assessing... (${assessProgress}/${pendingCount})` : `AI assess ${pendingCount} pending`}
          </button>
        )}
      </div>

      {/* Violations table */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-[#F0E8DA] bg-[#FEFCF8]">
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
          <tbody className="divide-y divide-[#F0E8DA]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No violations found
                </td>
              </tr>
            ) : (
              filtered.map((v) => {
                const computedTimeWeight = timeWeightFor(v.inspections?.inspection_date ?? null, asOf);
                const challengeScore = scoreChallenge({
                  violationCode: v.violation_code,
                  basicCategory: v.basic_category ?? null,
                  severityWeight: v.severity_weight,
                  timeWeight: computedTimeWeight,
                  challengeReason: v.challenge_reason,
                  oosViolation: v.oos_violation,
                  convicted: v.convicted,
                  basicPercentile: null,
                });

                return (
                  <tr
                    key={v.id}
                    className={`hover:bg-[#FBF7F0] transition-colors ${selected.has(v.id) ? "bg-[#F5EDDB]" : ""}`}
                  >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggleSelect(v.id)}
                      disabled={v.challengeable === false}
                      className="rounded border-gray-300 text-[#C67A1E] focus:ring-[#C67A1E]"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-medium text-[#1E1C1A]">
                    {v.violation_code}
                    {v.oos_violation && (
                      <span className="ml-1 text-[10px] font-sans text-[#C67A1E] font-medium">OOS</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#1E1C1A] max-w-xs">
                    <p className="truncate">{v.violation_description}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{challengeScore.summary}</p>
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
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {v.challengeable === null && <Badge variant="default">Pending</Badge>}
                        {v.challengeable === true && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                        {v.challenge_priority && (
                          <Badge variant={priorityVariant(v.challenge_priority)}>
                            {v.challenge_priority}
                          </Badge>
                        )}
                        <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${challengeLabelClass(challengeScore.label)}`}>
                          {challengeScore.label.replace(/_/g, " ")} · {challengeScore.overall}
                        </span>
                      </div>
                      <div className="space-y-1 text-[10px] text-gray-500 leading-snug">
                        <p title={challengeScore.factors.evidenceObtainabilityNote}>
                          Evidence {challengeScore.factors.evidenceObtainability}: {challengeScore.factors.evidenceObtainabilityNote}
                        </p>
                        <p title={challengeScore.factors.scoreImpactNote}>
                          Impact {challengeScore.factors.scoreImpact}: {challengeScore.factors.scoreImpactNote}
                        </p>
                        <p title={challengeScore.factors.proceduralGroundsNote}>
                          Procedural {challengeScore.factors.proceduralGrounds}: {challengeScore.factors.proceduralGroundsNote}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-semibold ${
                        (v.severity_weight ?? 0) >= 8
                          ? "text-[#C67A1E]"
                          : (v.severity_weight ?? 0) >= 5
                          ? "text-[#DAA520]"
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
                        className="flex items-center gap-1 text-xs text-[#C67A1E] hover:underline font-medium"
                      >
                        <Plus className="w-3 h-3" />
                        Create case
                      </button>
                    )}
                  </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
