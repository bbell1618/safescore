"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { caseStatusLabel, caseStatusVariant, formatDate, daysUntil } from "@/lib/utils";
import { AlertTriangle, FileText, Edit3, Clock, ChevronDown, ChevronUp } from "lucide-react";

interface CaseRow {
  id: string;
  status: string;
  priority: string | null;
  filed_date: string | null;
  state_deadline: string | null;
  ai_narrative: string | null;
  final_narrative: string | null;
  filing_notes: string | null;
  case_number: string | null;
  outcome: string | null;
  violations: {
    violation_code: string;
    violation_description: string;
    basic_category: string | null;
    severity_weight: number | null;
  } | null;
}

interface Props {
  clientId: string;
  cases: CaseRow[];
}

export function DataqWorkbench({ clientId, cases }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function generateNarrative(caseId: string) {
    setGenerating(caseId);
    try {
      const res = await fetch(`/api/cases/dataq/${caseId}/narrative`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.narrative) {
        setNarratives((prev) => ({ ...prev, [caseId]: data.narrative }));
      }
    } finally {
      setGenerating(null);
    }
  }

  async function saveNarrative(caseId: string) {
    setSaving(caseId);
    try {
      await fetch(`/api/cases/dataq/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final_narrative: narratives[caseId] }),
      });
    } finally {
      setSaving(null);
    }
  }

  async function updateStatus(caseId: string, status: string) {
    await fetch(`/api/cases/dataq/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    window.location.reload();
  }

  if (cases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-12 text-center">
        <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No DataQs cases yet</p>
        <p className="text-xs text-gray-400 mt-1">
          Go to the Violations tab and click "Create case" on a challengeable violation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cases.map((c) => {
        const isExpanded = expandedId === c.id;
        const deadline = daysUntil(c.state_deadline);
        const narrative = narratives[c.id] ?? c.final_narrative ?? c.ai_narrative ?? "";

        return (
          <div
            key={c.id}
            className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden"
          >
            {/* Case header */}
            <div
              className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-[#F4F4F4] transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : c.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-mono text-xs font-semibold text-[#1A1A1A]">
                    {c.violations?.violation_code ?? "—"}
                  </p>
                  <Badge variant={caseStatusVariant(c.status)}>
                    {caseStatusLabel(c.status)}
                  </Badge>
                  {c.priority && (
                    <Badge variant={c.priority === "high" ? "danger" : c.priority === "medium" ? "warning" : "info"}>
                      {c.priority}
                    </Badge>
                  )}
                  {deadline !== null && deadline <= 3 && (
                    <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                      <AlertTriangle className="w-3 h-3 text-[#DC362E]" />
                      <span className="text-[10px] font-medium text-[#DC362E]">
                        {deadline <= 0 ? "OVERDUE" : `${deadline}d deadline`}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-sm text-[#1A1A1A] truncate">
                  {c.violations?.violation_description ?? "Unknown violation"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {c.case_number ? `Case #${c.case_number}` : "No case number yet"}
                  {c.filed_date ? ` · Filed ${formatDate(c.filed_date)}` : ""}
                  {c.state_deadline ? ` · Deadline ${formatDate(c.state_deadline)}` : ""}
                </p>
              </div>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
              )}
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-[#E5E5E5] px-5 py-5 space-y-5">
                {/* Narrative editor */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-[#1A1A1A]">
                      RDR narrative
                      {c.ai_narrative && !c.final_narrative && (
                        <span className="ml-2 text-[10px] font-normal text-[#C5A059]">AI draft — review before filing</span>
                      )}
                      {c.final_narrative && (
                        <span className="ml-2 text-[10px] font-normal text-green-600">Human-reviewed</span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => generateNarrative(c.id)}
                        disabled={generating === c.id}
                        className="flex items-center gap-1 px-3 py-1 text-xs border border-[#E5E5E5] rounded-lg hover:border-[#DC362E] hover:text-[#DC362E] transition-colors disabled:opacity-50"
                      >
                        <Edit3 className="w-3 h-3" />
                        {generating === c.id ? "Generating..." : "AI draft"}
                      </button>
                      <button
                        onClick={() => saveNarrative(c.id)}
                        disabled={saving === c.id || !narratives[c.id]}
                        className="flex items-center gap-1 px-3 py-1 text-xs bg-[#1A1A1A] text-white rounded-lg hover:bg-black transition-colors disabled:opacity-50"
                      >
                        {saving === c.id ? "Saving..." : "Save as reviewed"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={narrative}
                    onChange={(e) =>
                      setNarratives((prev) => ({ ...prev, [c.id]: e.target.value }))
                    }
                    placeholder={narrative || "No narrative yet. Click 'AI draft' to generate."}
                    rows={8}
                    className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] resize-y font-mono"
                  />
                </div>

                {/* Filing checklist */}
                <div>
                  <p className="text-xs font-semibold text-[#1A1A1A] mb-2">
                    Filing checklist
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { label: "Narrative drafted and reviewed", done: !!c.final_narrative },
                      { label: "Evidence documents attached", done: false },
                      { label: "Violation code verified correct", done: c.status !== "draft" },
                      { label: "Filed through DataQs portal", done: ["filed", "pending_state", "pending_fmcsa", "approved", "denied", "closed"].includes(c.status) },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2 text-xs">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${item.done ? "bg-green-500 border-green-500" : "border-gray-300"}`}>
                          {item.done && <span className="text-white text-[10px]">✓</span>}
                        </div>
                        <span className={item.done ? "text-gray-400 line-through" : "text-gray-700"}>
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status actions */}
                <div className="flex gap-2 flex-wrap">
                  {c.status === "draft" && (
                    <button
                      onClick={() => updateStatus(c.id, "filed")}
                      className="px-4 py-2 bg-[#DC362E] text-white rounded-lg text-xs font-medium hover:bg-[#b52a23] transition-colors"
                    >
                      Mark as filed
                    </button>
                  )}
                  {c.status === "filed" && (
                    <>
                      <button
                        onClick={() => updateStatus(c.id, "pending_state")}
                        className="px-4 py-2 bg-[#1A1A1A] text-white rounded-lg text-xs font-medium hover:bg-black transition-colors"
                      >
                        Pending state review
                      </button>
                    </>
                  )}
                  {c.status === "pending_state" && (
                    <>
                      <button
                        onClick={() => updateStatus(c.id, "approved")}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                      >
                        Mark approved
                      </button>
                      <button
                        onClick={() => updateStatus(c.id, "denied")}
                        className="px-4 py-2 bg-red-100 text-[#DC362E] rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
                      >
                        Mark denied
                      </button>
                    </>
                  )}
                  {c.status === "denied" && (
                    <button
                      onClick={() => updateStatus(c.id, "reconsidering")}
                      className="px-4 py-2 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors"
                    >
                      Request reconsideration
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
