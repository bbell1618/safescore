"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { timeWeightFor } from "@/lib/analysis/basic-measure";
import { formatDate } from "@/lib/utils";
import { CheckCircle, Plus } from "lucide-react";

interface ViolationRow {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  time_weight: number | null;
  oos_violation: boolean;
  convicted: boolean | null;
  challenge_reason: string | null;
  challenge_priority: string | null;
  ai_assessed_at: string | null;
  inspections?: {
    inspection_date: string | null;
    state: string | null;
    level: string | null;
    facility_name: string | null;
  } | null;
}

interface Props {
  clientId: string;
  violations: ViolationRow[];
}

type Filter = "all" | "review" | "weak" | "not_challengeable";

export function ViolationAnalyzer({ clientId, violations }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const asOf = useMemo(() => new Date(), []);

  const scoredViolations = useMemo(() => {
    return violations.map((violation) => {
      const computedTimeWeight = timeWeightFor(violation.inspections?.inspection_date ?? null, asOf);
      const challengeScore = scoreChallenge({
        violationCode: violation.violation_code ?? "",
        basicCategory: violation.basic_category ?? null,
        severityWeight: violation.severity_weight,
        timeWeight: computedTimeWeight,
        challengeReason: violation.challenge_reason,
        oosViolation: violation.oos_violation,
        convicted: violation.convicted,
        basicPercentile: null,
      });

      return { violation, challengeScore };
    });
  }, [violations, asOf]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "review":
        return scoredViolations.filter(({ challengeScore }) => challengeScore.label === "strong" || challengeScore.label === "moderate");
      case "weak":
        return scoredViolations.filter(({ challengeScore }) => challengeScore.label === "weak");
      case "not_challengeable":
        return scoredViolations.filter(({ challengeScore }) => challengeScore.label === "not_challengeable");
      default:
        return scoredViolations;
    }
  }, [scoredViolations, filter]);

  async function createDataqCase(violationId: string) {
    const res = await fetch(`/api/cases/dataq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, violationId }),
    });
    if (res.ok) {
      const d = await res.json();
      router.push(`/console/clients/${clientId}/dataq?case=${d.caseId}`);
    }
  }

function challengeLabelClass(label: string): string {
  if (label === "strong") return "bg-green-50 text-green-700 border-green-200";
  if (label === "moderate") return "bg-amber-50 text-amber-700 border-amber-200";
  if (label === "weak") return "bg-[#F0E8DA] text-gray-700 border-[#E4D7C4]";
  return "bg-gray-50 text-gray-500 border-gray-200";
}

function basicLabel(basicCategory: string | null) {
  if (!basicCategory) return "Uncategorized \u2014 excluded from BASIC scoring";
  return basicCategory.replace(/_/g, " ");
}

  return (
    <div className="space-y-4">
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 flex items-center justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
          {([
            ["all", "All"],
            ["review", "Strong/moderate review"],
            ["weak", "Weak review"],
            ["not_challengeable", "Not challengeable"],
          ] as Array<[Filter, string]>).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === value
                  ? "bg-[#1B2D4F] text-white"
                  : "bg-[#FEFCF8] text-gray-600 hover:bg-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Challenge labels are computed live from v2 grounds, not the legacy stored flag.
        </p>
      </div>

      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-[#F0E8DA] bg-[#FEFCF8]">
            <tr>
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
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No violations found
                </td>
              </tr>
            ) : (
              filtered.map(({ violation, challengeScore }) => {
                const canCreateCase = challengeScore.label === "strong" || challengeScore.label === "moderate";

                return (
                  <tr key={violation.id} className="hover:bg-[#FBF7F0] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-[#1E1C1A]">
                      {violation.violation_code ?? "--"}
                      {violation.oos_violation && (
                        <span className="ml-1 text-[10px] font-sans text-[#C67A1E] font-medium">OOS</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#1E1C1A] max-w-xs">
                      <p className="truncate">{violation.violation_description}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{challengeScore.summary}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500">
                        {basicLabel(violation.basic_category)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {violation.inspections?.inspection_date
                        ? formatDate(violation.inspections.inspection_date)
                        : "--"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {canCreateCase && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                          <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${challengeLabelClass(challengeScore.label)}`}>
                            {challengeScore.label.replace(/_/g, " ")}{"\u00B7"} {challengeScore.overall}
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
                          (violation.severity_weight ?? 0) >= 8
                            ? "text-[#C67A1E]"
                            : (violation.severity_weight ?? 0) >= 5
                            ? "text-[#DAA520]"
                            : "text-gray-400"
                        }`}
                      >
                        {violation.severity_weight ?? "--"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canCreateCase && (
                        <button
                          onClick={() => createDataqCase(violation.id)}
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
