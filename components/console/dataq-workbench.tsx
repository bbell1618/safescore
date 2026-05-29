"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  caseStatusLabel,
  caseStatusVariant,
  formatDate,
  daysUntil,
} from "@/lib/utils";
import {
  AlertTriangle,
  FileText,
  Edit3,
  ExternalLink,
  LinkIcon,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";

interface ViolationDetail {
  violation_code: string;
  violation_description: string;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  challenge_reason: string | null;
  challenge_priority: string | null;
  inspection_id: string | null;
}

interface InspectionDetail {
  inspection_date: string;
  state: string;
  level: string;
  facility_name: string | null;
  report_number: string;
}

interface CaseRow {
  id: string;
  status: string;
  priority: string | null;
  filed_date: string | null;
  state_deadline: string | null;
  outcome_date: string | null;
  ai_narrative: string | null;
  final_narrative: string | null;
  filing_notes: string | null;
  case_number: string | null;
  outcome: string | null;
  violations: ViolationDetail | null;
  inspections: InspectionDetail | null;
}

interface Props {
  clientId: string;
  cases: CaseRow[];
}

interface RelinkViolation {
  id: string;
  violation_code: string;
  violation_description: string;
  challenge_priority: string | null;
  inspection_id: string | null;
}

const BASIC_LABELS: Record<string, string> = {
  unsafe_driving: "Unsafe Driving",
  hos_compliance: "HOS Compliance",
  driver_fitness: "Driver Fitness",
  controlled_substance: "Controlled Substance",
  vehicle_maintenance: "Vehicle Maintenance",
  hazmat_compliance: "Hazmat Compliance",
  crash_indicator: "Crash Indicator",
};

const FILED_STATES = ["filed", "pending_state", "pending_fmcsa"];
const FILED_OR_RESOLVED = [
  "filed",
  "pending_state",
  "pending_fmcsa",
  "approved",
  "denied",
  "closed",
];
const RESOLVED_STATES = ["approved", "denied", "reconsidering", "closed"];

function todayAsYYYYMMDD(): string {
  return new Intl.DateTimeFormat("en-CA").format();
}

function StatusPill({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
        done
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-400"
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          done ? "bg-green-500 text-white" : "bg-gray-300 text-white"
        }`}
      >
        {done ? (
          <Check className="h-2.5 w-2.5" />
        ) : (
          <span className="text-[10px] leading-none">-</span>
        )}
      </span>
      {label}
    </div>
  );
}

export function DataqWorkbench({ clientId, cases }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<Record<string, string>>({});
  const [caseNumbers, setCaseNumbers] = useState<Record<string, string>>({});
  const [savedCaseNumbers, setSavedCaseNumbers] = useState<Record<string, string>>({});
  const [savingCaseNumber, setSavingCaseNumber] = useState<string | null>(null);
  const [caseNumberSaved, setCaseNumberSaved] = useState<string | null>(null);
  const [narrativeApproved, setNarrativeApproved] = useState<string | null>(null);
  const [approvedLocal, setApprovedLocal] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [filingNotes, setFilingNotes] = useState<Record<string, string>>({});

  // Re-link state
  const [relinking, setRelinking] = useState<string | null>(null);
  const [relinkViolations, setRelinkViolations] = useState<RelinkViolation[]>([]);
  const [relinkLoading, setRelinkLoading] = useState(false);
  const [selectedRelink, setSelectedRelink] = useState<Record<string, string>>({});

  async function generateNarrative(caseId: string) {
    setGenerating(caseId);
    setGenerationError((prev) => {
      const next = { ...prev };
      delete next[caseId];
      return next;
    });
    try {
      const res = await fetch(`/api/cases/dataq/${caseId}/narrative`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setGenerationError((prev) => ({
          ...prev,
          [caseId]: data.error ?? "Failed to generate narrative",
        }));
        return;
      }
      if (data.narrative) {
        setNarratives((prev) => ({ ...prev, [caseId]: data.narrative }));
      }
    } catch {
      setGenerationError((prev) => ({
        ...prev,
        [caseId]: "Network error — could not reach generation endpoint",
      }));
    } finally {
      setGenerating(null);
    }
  }

  async function approveNarrative(caseId: string, value: string) {
    await fetch(`/api/cases/dataq/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ final_narrative: value }),
    });
    setApprovedLocal((prev) => ({ ...prev, [caseId]: true }));
    setNarrativeApproved(caseId);
    setTimeout(() => {
      setNarrativeApproved((current) => (current === caseId ? null : current));
    }, 2000);
  }

  async function saveCaseNumber(caseId: string, value: string) {
    setSavingCaseNumber(caseId);
    try {
      await fetch(`/api/cases/dataq/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_number: value }),
      });
      setSavedCaseNumbers((prev) => ({ ...prev, [caseId]: value }));
      setCaseNumberSaved(caseId);
      setTimeout(() => {
        setCaseNumberSaved((current) => (current === caseId ? null : current));
      }, 2000);
    } finally {
      setSavingCaseNumber(null);
    }
  }

  async function markAsFiled(caseId: string, caseNumber: string) {
    await fetch(`/api/cases/dataq/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "filed",
        filed_date: todayAsYYYYMMDD(),
        case_number: caseNumber,
      }),
    });
    window.location.reload();
  }

  async function updateStatus(
    caseId: string,
    payload: Record<string, unknown>
  ) {
    await fetch(`/api/cases/dataq/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    window.location.reload();
  }

  async function saveFilingNotes(caseId: string, value: string) {
    await fetch(`/api/cases/dataq/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filing_notes: value }),
    });
  }

  async function copyNarrative(caseId: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(caseId);
      setTimeout(() => {
        setCopied((current) => (current === caseId ? null : current));
      }, 2000);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  async function openRelink(caseId: string) {
    setRelinking(caseId);
    setRelinkLoading(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/violations?challengeable=true`
      );
      if (res.ok) {
        const data = await res.json();
        setRelinkViolations(data.violations ?? []);
      }
    } catch {
      // ignore — dropdown will be empty
    } finally {
      setRelinkLoading(false);
    }
  }

  async function submitRelink(caseId: string) {
    const violationId = selectedRelink[caseId];
    if (!violationId) return;

    const viol = relinkViolations.find((v) => v.id === violationId);

    await fetch(`/api/cases/dataq/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        violation_id: violationId,
        inspection_id: viol?.inspection_id ?? null,
      }),
    });
    setRelinking(null);
    window.location.reload();
  }

  if (cases.length === 0) {
    return (
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-12 text-center">
        <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No DataQs cases yet</p>
        <p className="text-xs text-gray-400 mt-1">
          Go to the Violations tab and click &quot;Create case&quot; on a challengeable violation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cases.map((c) => {
        const isExpanded = expandedId === c.id;
        const deadline = daysUntil(c.state_deadline);
        const narrative =
          narratives[c.id] ?? c.final_narrative ?? c.ai_narrative ?? "";
        const isOrphaned = c.violations === null;

        const currentCaseNumber =
          caseNumbers[c.id] !== undefined
            ? caseNumbers[c.id]
            : c.case_number ?? "";
        const lastSavedCaseNumber =
          savedCaseNumbers[c.id] !== undefined
            ? savedCaseNumbers[c.id]
            : c.case_number ?? "";
        const caseNumberDirty = currentCaseNumber !== lastSavedCaseNumber;

        const finalNarrativeReady =
          approvedLocal[c.id] || !!c.final_narrative;

        const errMsg = generationError[c.id];

        // Progress pills (Bug 1)
        const pills = [
          { label: "Narrative generated", done: c.ai_narrative != null },
          {
            label: "Narrative reviewed",
            done: c.final_narrative != null || approvedLocal[c.id] === true,
          },
          {
            label: "Case # saved",
            done:
              typeof lastSavedCaseNumber === "string" &&
              lastSavedCaseNumber.trim().length > 0,
          },
          { label: "Filed", done: FILED_OR_RESOLVED.includes(c.status) },
        ];

        const isDraft = c.status === "draft";
        const isFiled = FILED_STATES.includes(c.status);
        const isResolved = RESOLVED_STATES.includes(c.status);

        return (
          <div
            key={c.id}
            className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-hidden"
          >
            {/* Case header */}
            <div
              className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-[#FBF7F0] transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : c.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="font-mono text-xs font-semibold text-[#1E1C1A]">
                    {isOrphaned ? "—" : (c.violations?.violation_code ?? "—")}
                  </p>
                  <Badge variant={caseStatusVariant(c.status)}>
                    {caseStatusLabel(c.status)}
                  </Badge>
                  {c.priority && (
                    <Badge
                      variant={
                        c.priority === "high"
                          ? "danger"
                          : c.priority === "medium"
                          ? "warning"
                          : "info"
                      }
                    >
                      {c.priority}
                    </Badge>
                  )}
                  {isOrphaned && (
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <span className="text-[10px] font-medium text-amber-700">
                        Violation unlinked
                      </span>
                    </div>
                  )}
                  {deadline !== null && deadline <= 3 && (
                    <div className="flex items-center gap-1 bg-[#FDF4E7] border border-[#C67A1E]/20 rounded px-1.5 py-0.5">
                      <AlertTriangle className="w-3 h-3 text-[#C67A1E]" />
                      <span className="text-[10px] font-medium text-[#C67A1E]">
                        {deadline <= 0 ? "OVERDUE" : `${deadline}d deadline`}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-sm text-[#1E1C1A] truncate">
                  {isOrphaned
                    ? "Violation data lost — re-run analysis or re-link manually"
                    : (c.violations?.violation_description ?? "Unknown violation")}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {currentCaseNumber
                    ? `Case #${currentCaseNumber}`
                    : "No case number yet"}
                  {c.filed_date ? ` · Filed ${formatDate(c.filed_date)}` : ""}
                  {c.state_deadline
                    ? ` · Deadline ${formatDate(c.state_deadline)}`
                    : ""}
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
              <div className="border-t border-[#F0E8DA] px-5 py-5 space-y-5">

                {/* ===================== DRAFT PHASE ===================== */}
                {isDraft && (
                  <>
                    {/* Orphaned case — re-link panel */}
                    {isOrphaned && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <div className="flex items-start gap-2 mb-3">
                          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-800">
                              Violation link lost
                            </p>
                            <p className="text-xs text-amber-700 mt-0.5">
                              A previous analysis run replaced the violation this case was tracking.
                              Re-run analysis (which will auto-repair the link) or manually select
                              the correct violation below.
                            </p>
                          </div>
                        </div>

                        {relinking === c.id ? (
                          <div className="space-y-2">
                            {relinkLoading ? (
                              <p className="text-xs text-gray-500">Loading violations...</p>
                            ) : relinkViolations.length === 0 ? (
                              <p className="text-xs text-gray-500">
                                No challengeable violations found. Run analysis first.
                              </p>
                            ) : (
                              <select
                                className="w-full px-3 py-2 text-xs border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                value={selectedRelink[c.id] ?? ""}
                                onChange={(e) =>
                                  setSelectedRelink((prev) => ({
                                    ...prev,
                                    [c.id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Select violation...</option>
                                {relinkViolations.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.violation_code} — {v.violation_description.slice(0, 60)}
                                    {v.challenge_priority
                                      ? ` [${v.challenge_priority}]`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => submitRelink(c.id)}
                                disabled={!selectedRelink[c.id]}
                                className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                              >
                                Re-link violation
                              </button>
                              <button
                                onClick={() => setRelinking(null)}
                                className="px-3 py-1.5 text-xs border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => openRelink(c.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                          >
                            <LinkIcon className="w-3 h-3" />
                            Re-link violation
                          </button>
                        )}
                      </div>
                    )}

                    {/* Violation + inspection context */}
                    {!isOrphaned && (
                      <div className="grid grid-cols-2 gap-4">
                        {/* Violation details */}
                        <div className="bg-white border border-[#F0E8DA] rounded-lg p-3 space-y-1.5">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                            Violation
                          </p>
                          <p className="font-mono text-sm font-bold text-[#1E1C1A]">
                            {c.violations?.violation_code}
                          </p>
                          <p className="text-xs text-gray-700">
                            {c.violations?.violation_description}
                          </p>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {c.violations?.basic_category && (
                              <span className="text-[10px] bg-[#FBF7F0] border border-[#F0E8DA] rounded px-1.5 py-0.5 text-gray-600">
                                {BASIC_LABELS[c.violations.basic_category] ??
                                  c.violations.basic_category}
                              </span>
                            )}
                            {c.violations?.severity_weight != null && (
                              <span className="text-[10px] bg-[#FBF7F0] border border-[#F0E8DA] rounded px-1.5 py-0.5 text-gray-600">
                                Severity {c.violations.severity_weight}
                              </span>
                            )}
                            {c.violations?.oos_violation && (
                              <span className="text-[10px] bg-[#FDF4E7] border border-[#C67A1E]/20 rounded px-1.5 py-0.5 text-[#C67A1E] font-medium">
                                OOS
                              </span>
                            )}
                          </div>
                          {c.violations?.challenge_reason && (
                            <div className="pt-1 border-t border-[#F0E8DA]">
                              <p className="text-[10px] font-semibold text-gray-400 mb-0.5">
                                AI assessment
                              </p>
                              <p className="text-xs text-gray-600">
                                {c.violations.challenge_reason}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Inspection details */}
                        <div className="bg-white border border-[#F0E8DA] rounded-lg p-3 space-y-1.5">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                            Inspection
                          </p>
                          <p className="text-sm font-medium text-[#1E1C1A]">
                            {c.inspections
                              ? formatDate(c.inspections.inspection_date)
                              : "—"}
                          </p>
                          {c.inspections && (
                            <>
                              <p className="text-xs text-gray-500">
                                Report #{c.inspections.report_number}
                              </p>
                              <p className="text-xs text-gray-500">
                                {c.inspections.facility_name
                                  ? `${c.inspections.facility_name}`
                                  : `Level ${c.inspections.level} · ${c.inspections.state}`}
                              </p>
                              <p className="text-xs text-gray-400">
                                Level {c.inspections.level} · {c.inspections.state}
                              </p>
                            </>
                          )}
                          {!c.inspections && (
                            <p className="text-xs text-gray-400 italic">
                              Inspection data not linked
                            </p>
                          )}
                          <div className="pt-1 border-t border-[#F0E8DA]">
                            <a
                              href="https://dataqs.fmcsa.dot.gov"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] text-[#C67A1E] hover:underline font-medium"
                            >
                              <ExternalLink className="w-3 h-3" />
                              File on DataQs portal
                            </a>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Evidence guidance (Bug 4) */}
                    <div className="bg-[#FBF7F0] border border-[#F0E8DA] rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-[#1E1C1A] mb-2">
                        Evidence needed
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-gray-600">
                        <li>
                          ELD/driver logs from{" "}
                          {c.inspections?.inspection_date
                            ? formatDate(c.inspections.inspection_date)
                            : "the inspection date"}{" "}
                          (the inspection date)
                        </li>
                        <li>Driver certification records for the 24-hour period</li>
                        <li>
                          Any correspondence or documentation related to this
                          inspection
                        </li>
                        <li>
                          Request these from the client via the Documents tab, then
                          attach when filing on the DataQs portal
                        </li>
                      </ul>
                    </div>

                    {/* Narrative editor */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-[#1E1C1A]">
                          RDR narrative
                          {c.ai_narrative && !finalNarrativeReady && (
                            <span className="ml-2 text-[10px] font-normal text-[#DAA520]">
                              AI draft — review before filing
                            </span>
                          )}
                          {finalNarrativeReady && (
                            <span className="ml-2 text-[10px] font-normal text-green-600">
                              Human-reviewed
                            </span>
                          )}
                        </label>
                        <button
                          onClick={() => generateNarrative(c.id)}
                          disabled={generating === c.id}
                          className="flex items-center gap-1 px-3 py-1 text-xs border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors disabled:opacity-50"
                        >
                          <Edit3 className="w-3 h-3" />
                          {generating === c.id ? "Generating..." : "AI draft"}
                        </button>
                      </div>

                      {/* Generation error */}
                      {errMsg && (
                        <div className="mb-2 px-3 py-2 bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg">
                          <p className="text-xs text-[#B83B32]">
                            <span className="font-medium">Generation failed:</span>{" "}
                            {errMsg}
                          </p>
                        </div>
                      )}

                      <textarea
                        value={narrative}
                        onChange={(e) =>
                          setNarratives((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }))
                        }
                        placeholder="No narrative yet. Click 'AI draft' to generate."
                        rows={8}
                        className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] resize-y font-mono"
                      />

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <button
                          onClick={() => approveNarrative(c.id, narrative)}
                          disabled={!narrative.trim()}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1B2D4F] text-white rounded-lg hover:bg-[#2A4270] transition-colors disabled:opacity-50"
                        >
                          Approve narrative
                        </button>
                        <button
                          onClick={() => approveNarrative(c.id, narrative)}
                          disabled={!narrative.trim()}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors disabled:opacity-50"
                        >
                          Edit &amp; approve
                        </button>
                        {narrativeApproved === c.id && (
                          <span className="text-xs text-green-600 font-medium">
                            Approved
                          </span>
                        )}
                        {finalNarrativeReady && (
                          <>
                            <button
                              onClick={() => copyNarrative(c.id, narrative)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors"
                            >
                              {copied === c.id ? "Copied" : "Copy for filing"}
                            </button>
                            <a
                              href="https://dataqs.fmcsa.dot.gov"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1.5 text-xs text-[#C67A1E] hover:underline font-medium"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open DataQs portal
                            </a>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Progress pills (Bug 1) */}
                    <div className="flex flex-wrap gap-2">
                      {pills.map((p) => (
                        <StatusPill key={p.label} label={p.label} done={p.done} />
                      ))}
                    </div>

                    {/* Case number (Bug 2) */}
                    <div>
                      <label className="text-xs font-semibold text-[#1E1C1A] block mb-1.5">
                        DataQs case number
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={currentCaseNumber}
                          onChange={(e) =>
                            setCaseNumbers((prev) => ({
                              ...prev,
                              [c.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && caseNumberDirty) {
                              e.preventDefault();
                              saveCaseNumber(c.id, currentCaseNumber);
                            }
                          }}
                          placeholder="Assigned by FMCSA after filing"
                          className="flex-1 px-3 py-1.5 border border-[#F0E8DA] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
                        />
                        <button
                          onClick={() => saveCaseNumber(c.id, currentCaseNumber)}
                          disabled={savingCaseNumber === c.id || !caseNumberDirty}
                          className="px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors disabled:opacity-40"
                        >
                          {savingCaseNumber === c.id ? "Saving..." : "Save"}
                        </button>
                        {caseNumberSaved === c.id && (
                          <span className="text-xs text-green-600 font-medium">
                            Saved
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mark as filed */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => markAsFiled(c.id, currentCaseNumber)}
                        disabled={!currentCaseNumber.trim()}
                        className="px-4 py-2 bg-[#C67A1E] text-white rounded-lg text-xs font-medium hover:bg-[#B86E18] transition-colors disabled:opacity-40"
                      >
                        Mark as filed
                      </button>
                    </div>
                  </>
                )}

                {/* ===================== FILED / PENDING PHASE ===================== */}
                {isFiled && (
                  <>
                    <h3 className="text-lg font-bold text-[#1E1C1A]">
                      {c.case_number
                        ? `Case #${c.case_number}`
                        : "No case number assigned"}
                    </h3>

                    {/* Status timeline */}
                    <div className="flex items-center gap-2">
                      {(() => {
                        const steps = [
                          { key: "draft", label: "Draft" },
                          { key: "filed", label: "Filed" },
                          { key: "pending_state", label: "Pending State" },
                          { key: "pending_fmcsa", label: "Pending FMCSA" },
                          { key: "resolved", label: "Resolved" },
                        ];
                        const currentIndex = steps.findIndex(
                          (s) => s.key === c.status
                        );
                        return steps.map((s, i) => {
                          const isCurrent = i === currentIndex;
                          const isPast = i < currentIndex;
                          return (
                            <div
                              key={s.key}
                              className="flex items-center gap-2"
                            >
                              <div className="flex items-center gap-1.5">
                                {isPast ? (
                                  <Check className="w-3.5 h-3.5 text-green-600" />
                                ) : null}
                                <span
                                  className="text-xs font-medium"
                                  style={{
                                    color: isCurrent
                                      ? "#C67A1E"
                                      : isPast
                                      ? "#1E1C1A"
                                      : "#9CA3AF",
                                  }}
                                >
                                  {s.label}
                                </span>
                              </div>
                              {i < steps.length - 1 && (
                                <ChevronRightSeparator />
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Read-only narrative */}
                    <div>
                      <label className="text-xs font-semibold text-[#1E1C1A] block mb-1.5">
                        RDR narrative
                      </label>
                      <textarea
                        value={c.final_narrative ?? c.ai_narrative ?? ""}
                        readOnly
                        disabled
                        rows={8}
                        className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-gray-50 text-gray-600 resize-y font-mono"
                      />
                    </div>

                    {/* Status actions */}
                    <div className="flex gap-2 flex-wrap">
                      {c.status === "filed" && (
                        <button
                          onClick={() =>
                            updateStatus(c.id, { status: "pending_state" })
                          }
                          className="px-4 py-2 bg-[#1B2D4F] text-white rounded-lg text-xs font-medium hover:bg-[#2A4270] transition-colors"
                        >
                          State responded
                        </button>
                      )}
                      {c.status === "pending_state" && (
                        <>
                          <button
                            onClick={() =>
                              updateStatus(c.id, { status: "pending_fmcsa" })
                            }
                            className="px-4 py-2 bg-[#1B2D4F] text-white rounded-lg text-xs font-medium hover:bg-[#2A4270] transition-colors"
                          >
                            Escalate to FMCSA
                          </button>
                          <button
                            onClick={() =>
                              updateStatus(c.id, {
                                status: "approved",
                                outcome_date: todayAsYYYYMMDD(),
                              })
                            }
                            className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                          >
                            Mark approved
                          </button>
                          <button
                            onClick={() =>
                              updateStatus(c.id, {
                                status: "denied",
                                outcome_date: todayAsYYYYMMDD(),
                              })
                            }
                            className="px-4 py-2 bg-[#FAECEB] text-[#B83B32] rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                          >
                            Mark denied
                          </button>
                        </>
                      )}
                      {c.status === "pending_fmcsa" && (
                        <>
                          <button
                            onClick={() =>
                              updateStatus(c.id, {
                                status: "approved",
                                outcome_date: todayAsYYYYMMDD(),
                              })
                            }
                            className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                          >
                            Mark approved
                          </button>
                          <button
                            onClick={() =>
                              updateStatus(c.id, {
                                status: "denied",
                                outcome_date: todayAsYYYYMMDD(),
                              })
                            }
                            className="px-4 py-2 bg-[#FAECEB] text-[#B83B32] rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                          >
                            Mark denied
                          </button>
                        </>
                      )}
                    </div>

                    {/* Filing notes */}
                    <div>
                      <label className="text-xs font-semibold text-[#1E1C1A] block mb-1.5">
                        Filing notes
                      </label>
                      <textarea
                        value={
                          filingNotes[c.id] !== undefined
                            ? filingNotes[c.id]
                            : c.filing_notes ?? ""
                        }
                        onChange={(e) =>
                          setFilingNotes((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }))
                        }
                        onBlur={(e) => saveFilingNotes(c.id, e.target.value)}
                        rows={4}
                        placeholder="Notes about the filing, correspondence, and next steps."
                        className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] resize-y"
                      />
                    </div>
                  </>
                )}

                {/* ===================== RESOLVED PHASE ===================== */}
                {isResolved && (
                  <>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span
                        className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-bold ${
                          c.status === "approved"
                            ? "bg-green-100 text-green-700"
                            : c.status === "denied"
                            ? "bg-[#FAECEB] text-[#B83B32]"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {caseStatusLabel(c.status)}
                      </span>
                    </div>

                    <div className="text-sm text-gray-700 space-y-1">
                      <p>
                        <span className="font-semibold text-[#1E1C1A]">
                          Case number:
                        </span>{" "}
                        {c.case_number ?? "—"}
                      </p>
                      <p>
                        <span className="font-semibold text-[#1E1C1A]">
                          Outcome date:
                        </span>{" "}
                        {formatDate(c.outcome_date)}
                      </p>
                    </div>

                    {/* Read-only narrative display */}
                    <div>
                      <p className="text-xs font-semibold text-[#1E1C1A] mb-1.5">
                        RDR narrative
                      </p>
                      <div className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white text-gray-700 whitespace-pre-wrap font-mono">
                        {c.final_narrative ?? c.ai_narrative ?? "—"}
                      </div>
                    </div>

                    {c.status === "denied" && (
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() =>
                            updateStatus(c.id, { status: "reconsidering" })
                          }
                          className="px-4 py-2 bg-[#FDF4E7] text-[#C67A1E] rounded-lg text-xs font-medium hover:bg-[#FBF7F0] transition-colors"
                        >
                          Request reconsideration
                        </button>
                      </div>
                    )}

                    {/* Filing notes display */}
                    {c.filing_notes && (
                      <div>
                        <p className="text-xs font-semibold text-[#1E1C1A] mb-1.5">
                          Filing notes
                        </p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {c.filing_notes}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChevronRightSeparator() {
  return <ChevronDown className="w-3 h-3 text-gray-300 -rotate-90" />;
}
