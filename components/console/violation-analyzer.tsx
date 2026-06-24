"use client";

import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { evidenceRequirementsForViolation } from "@/lib/analysis/evidence-requirements";
import { BASIC_LABELS, timeWeightFor } from "@/lib/analysis/basic-measure";
import { formatDate } from "@/lib/utils";
import {
  CheckCircle,
  ChevronDown,
  ExternalLink,
  Search,
} from "lucide-react";

interface ViolationRow {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  time_weight: number | null;
  oos_violation: boolean;
  convicted: boolean | null;
  citation_number: string | null;
  citation_result: string | null;
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

interface DataqCaseRow {
  id: string;
  violation_id: string | null;
  status: string | null;
}

interface Props {
  clientId: string;
  violations: ViolationRow[];
  dataqCases: DataqCaseRow[];
}

type TierFilter =
  | "all"
  | "strong"
  | "moderate"
  | "possibly"
  | "not_challengeable"
  | "operational";
type SeverityFilter = "all" | "8plus" | "5plus" | "under5" | "unscored";
type SortField = "date" | "points" | "severity";
type SortDirection = "asc" | "desc";

export function ViolationAnalyzer({ clientId, violations, dataqCases }: Props) {
  const router = useRouter();
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [basicFilter, setBasicFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [creatingCaseId, setCreatingCaseId] = useState<string | null>(null);
  const [caseByViolation, setCaseByViolation] = useState<Record<string, DataqCaseRow>>(() => {
    return Object.fromEntries(
      dataqCases
        .filter((caseRow) => caseRow.violation_id)
        .map((caseRow) => [caseRow.violation_id as string, caseRow])
    );
  });
  const asOf = useMemo(() => new Date(), []);

  const scoredViolations = useMemo(() => {
    return violations.map((violation) => {
      const computedTimeWeight = timeWeightFor(
        violation.inspections?.inspection_date ?? null,
        asOf
      );
      const points =
        violation.severity_weight != null && computedTimeWeight > 0
          ? computedTimeWeight * (violation.severity_weight + (violation.oos_violation ? 2 : 0))
          : 0;
      const challengeScore = scoreChallenge({
        violationCode: violation.violation_code ?? "",
        basicCategory: violation.basic_category ?? null,
        severityWeight: violation.severity_weight,
        timeWeight: computedTimeWeight,
        challengeReason: violation.challenge_reason,
        oosViolation: violation.oos_violation,
        convicted: violation.convicted,
        citationNumber: violation.citation_number,
        citationResult: violation.citation_result,
        basicPercentile: null,
      });

      const evidenceRequirements = evidenceRequirementsForViolation(
        {
          violationCode: violation.violation_code,
          violationDescription: violation.violation_description,
          basicCategory: violation.basic_category,
          citationNumber: violation.citation_number,
          citationResult: violation.citation_result,
          challengeReason: violation.challenge_reason,
        },
        challengeScore
      );

      return { violation, challengeScore, evidenceRequirements, points };
    });
  }, [violations, asOf]);

  const basicOptions = useMemo(() => {
    return Array.from(
      new Set(violations.map((violation) => violation.basic_category).filter(Boolean) as string[])
    ).sort();
  }, [violations]);

  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const rows = scoredViolations.filter(({ violation, challengeScore }) => {
      if (tierFilter !== "all" && challengeScore.label !== tierFilter) return false;
      if (basicFilter !== "all" && violation.basic_category !== basicFilter) return false;

      const severity = violation.severity_weight;
      if (severityFilter === "8plus" && (severity == null || severity < 8)) return false;
      if (severityFilter === "5plus" && (severity == null || severity < 5)) return false;
      if (severityFilter === "under5" && (severity == null || severity >= 5)) return false;
      if (severityFilter === "unscored" && severity != null) return false;

      const inspectionDate = violation.inspections?.inspection_date ?? "";
      if (dateFrom && (!inspectionDate || inspectionDate < dateFrom)) return false;
      if (dateTo && (!inspectionDate || inspectionDate > dateTo)) return false;

      if (query) {
        const haystack = `${violation.violation_code ?? ""} ${violation.violation_description ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    return [...rows].sort((a, b) => {
      const multiplier = sortDirection === "asc" ? 1 : -1;
      if (sortField === "points") return (a.points - b.points) * multiplier;
      if (sortField === "severity") {
        return ((a.violation.severity_weight ?? -1) - (b.violation.severity_weight ?? -1)) * multiplier;
      }
      return ((a.violation.inspections?.inspection_date ?? "").localeCompare(b.violation.inspections?.inspection_date ?? "")) * multiplier;
    });
  }, [
    basicFilter,
    dateFrom,
    dateTo,
    scoredViolations,
    searchText,
    severityFilter,
    sortDirection,
    sortField,
    tierFilter,
  ]);

  async function createDataqCase(violationId: string) {
    setCreatingCaseId(violationId);
    try {
      const res = await fetch(`/api/violations/${violationId}/investigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.caseId) {
        setCaseByViolation((prev) => ({
          ...prev,
          [violationId]: {
            id: data.caseId,
            violation_id: violationId,
            status: data.status ?? "investigating",
          },
        }));
        router.refresh();
      }
    } finally {
      setCreatingCaseId(null);
    }
  }

  function toggleExpanded(violationId: string) {
    setExpandedIds((prev) => ({ ...prev, [violationId]: !prev[violationId] }));
  }

  function stopRowToggle(event: { stopPropagation: () => void }) {
    event.stopPropagation();
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, violationId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded(violationId);
    }
  }

  function setSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "date" ? "desc" : "desc");
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-4 space-y-4">
        <div className="flex gap-2 flex-wrap">
          {([
            ["all", "All"],
            ["strong", "Strong"],
            ["moderate", "Moderate"],
            ["possibly", "Investigate"],
            ["not_challengeable", "Not challengeable"],
            ["operational", "Operational"],
          ] as Array<[TierFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTierFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tierFilter === value
                  ? "bg-[#1B2D4F] text-white"
                  : "bg-[#FEFCF8] text-gray-600 hover:bg-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr_0.8fr]">
          <label className="text-xs text-gray-500">
            Search
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Code or description"
              className="mt-1 w-full rounded-lg border border-[#F0E8DA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs text-gray-500">
            BASIC
            <select
              value={basicFilter}
              onChange={(event) => setBasicFilter(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#F0E8DA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            >
              <option value="all">All BASICs</option>
              {basicOptions.map((basic) => (
                <option key={basic} value={basic}>
                  {BASIC_LABELS[basic] ?? basic.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Severity
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
              className="mt-1 w-full rounded-lg border border-[#F0E8DA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            >
              <option value="all">All severities</option>
              <option value="8plus">8+</option>
              <option value="5plus">5+</option>
              <option value="under5">Under 5</option>
              <option value="unscored">Unscored</option>
            </select>
          </label>
          <label className="text-xs text-gray-500">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#F0E8DA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs text-gray-500">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#F0E8DA] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
        </div>

        <p className="text-xs text-gray-500">
          Tiers are computed live. Investigate means evidence is needed, not that the violation is removable.
        </p>
      </div>

      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] overflow-x-auto">
        <table className="w-full min-w-[1040px] table-fixed text-sm">
          <thead className="border-b border-[#F0E8DA] bg-[#FEFCF8]">
            <tr>
              <th className="w-9 px-3 py-3"></th>
              <th className="w-[112px] text-left px-3 py-3 text-xs font-medium text-gray-500">Code</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-500">Description</th>
              <th className="w-[150px] text-left px-3 py-3 text-xs font-medium text-gray-500">BASIC</th>
              <th className="w-[112px] text-left px-3 py-3 text-xs font-medium text-gray-500">
                <SortButton active={sortField === "date"} direction={sortDirection} onClick={() => setSort("date")}>
                  Date
                </SortButton>
              </th>
              <th className="w-[88px] text-left px-3 py-3 text-xs font-medium text-gray-500">
                <SortButton active={sortField === "severity"} direction={sortDirection} onClick={() => setSort("severity")}>
                  Severity
                </SortButton>
              </th>
              <th className="w-[210px] text-left px-3 py-3 text-xs font-medium text-gray-500">
                <SortButton active={sortField === "points"} direction={sortDirection} onClick={() => setSort("points")}>
                  Tier / points
                </SortButton>
              </th>
              <th className="w-[150px] px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0E8DA]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400 text-sm">
                  No violations found
                </td>
              </tr>
            ) : (
              filtered.map(({ violation, challengeScore, evidenceRequirements, points }) => {
                const canCreateCase =
                  challengeScore.label === "strong" ||
                  challengeScore.label === "moderate" ||
                  challengeScore.label === "possibly";
                const existingCase = caseByViolation[violation.id] ?? null;
                const actionLabel = challengeScore.label === "possibly" ? "Investigate" : "Challenge";
                const isExpanded = Boolean(expandedIds[violation.id]);

                return (
                  <Fragment key={violation.id}>
                    <tr
                      className="cursor-pointer hover:bg-[#FBF7F0] focus:bg-[#FBF7F0] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#C67A1E] transition-colors"
                      tabIndex={0}
                      role="button"
                      aria-expanded={isExpanded}
                      aria-controls={`violation-details-${violation.id}`}
                      onClick={() => toggleExpanded(violation.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, violation.id)}
                    >
                      <td className="px-3 py-3 align-middle">
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 transition-transform ${
                            isExpanded ? "rotate-180 text-[#C67A1E]" : ""
                          }`}
                        />
                      </td>
                      <td className="px-3 py-3 align-middle font-mono text-xs font-medium text-[#1E1C1A] whitespace-nowrap">
                        {violation.violation_code ?? "--"}
                        {violation.oos_violation && (
                          <span className="ml-1 text-[10px] font-sans text-[#C67A1E] font-medium">OOS</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-middle text-[#1E1C1A]">
                        <p className="line-clamp-2 break-words leading-snug">{violation.violation_description}</p>
                      </td>
                      <td className="px-3 py-3 align-middle text-xs text-gray-500">
                        {basicLabel(violation.basic_category)}
                      </td>
                      <td className="px-3 py-3 align-middle text-xs text-gray-500 whitespace-nowrap">
                        {violation.inspections?.inspection_date ? formatDate(violation.inspections.inspection_date) : "--"}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <span className={severityClass(violation.severity_weight)}>
                          {violation.severity_weight ?? "--"}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {canCreateCase && <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                            <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 whitespace-nowrap ${challengeLabelClass(challengeScore.label)}`}>
                              {tierLabel(challengeScore.label)} {"\u00B7"} {points} pts
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{challengeScore.summary}</p>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                          {existingCase ? (
                            <a
                              href={`/console/clients/${clientId}/dataq?case=${existingCase.id}`}
                              onClick={stopRowToggle}
                              className="inline-flex items-center gap-1 text-xs text-[#C67A1E] hover:underline font-medium"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {existingCase.status === "investigating" ? "Investigating" : "Open case"}
                            </a>
                          ) : canCreateCase ? (
                            <button
                              onClick={(event) => {
                                stopRowToggle(event);
                                createDataqCase(violation.id);
                              }}
                              disabled={creatingCaseId === violation.id}
                              className="inline-flex items-center gap-1 text-xs text-[#C67A1E] hover:underline font-medium disabled:opacity-50"
                            >
                              <Search className="w-3 h-3" />
                              {creatingCaseId === violation.id ? "Creating..." : actionLabel}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr id={`violation-details-${violation.id}`} className="bg-white/70">
                        <td colSpan={8} className="px-3 py-4">
                          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                            <div>
                              <p className="text-xs font-semibold text-[#1E1C1A] mb-2">Evidence checklist</p>
                              {evidenceRequirements.length > 0 ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {evidenceRequirements.map((item) => (
                                    <div key={item.docType} className="rounded border border-[#F0E8DA] bg-white p-3">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-xs font-semibold text-[#1E1C1A]">{item.label}</span>
                                        <span className={`text-[10px] border rounded px-1.5 py-0.5 ${acquisitionClass(item.acquisitionMethod)}`}>
                                          {acquisitionLabel(item.acquisitionMethod)}
                                        </span>
                                      </div>
                                      <p className="text-xs text-gray-500 mt-1 leading-snug">{item.neededReason}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400">No checklist needed for this tier.</p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-[#1E1C1A] mb-2">Reasoning</p>
                              <div className="space-y-2 text-xs text-gray-600 leading-snug">
                                <p>
                                  <span className="font-semibold text-[#1E1C1A]">Evidence {challengeScore.factors.evidenceObtainability}:</span>{" "}
                                  {challengeScore.factors.evidenceObtainabilityNote}
                                </p>
                                <p>
                                  <span className="font-semibold text-[#1E1C1A]">Impact {challengeScore.factors.scoreImpact}:</span>{" "}
                                  {challengeScore.factors.scoreImpactNote}
                                </p>
                                <p>
                                  <span className="font-semibold text-[#1E1C1A]">Procedural {challengeScore.factors.proceduralGrounds}:</span>{" "}
                                  {challengeScore.factors.proceduralGroundsNote}
                                </p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortButton({
  active,
  direction,
  onClick,
  children,
}: {
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-[#C67A1E]">
      {children}
      <span className="text-[10px]">{active ? (direction === "asc" ? "up" : "down") : ""}</span>
    </button>
  );
}

function challengeLabelClass(label: string): string {
  if (label === "strong") return "bg-green-50 text-green-700 border-green-200";
  if (label === "moderate") return "bg-amber-50 text-amber-700 border-amber-200";
  if (label === "possibly") return "bg-[#FDF4E7] text-[#C67A1E] border-[#C67A1E]/20";
  if (label === "operational") return "bg-[#F0E8DA] text-gray-700 border-[#E4D7C4]";
  return "bg-gray-50 text-gray-500 border-gray-200";
}

function severityClass(severity: number | null) {
  const color =
    (severity ?? 0) >= 8
      ? "text-[#C67A1E]"
      : (severity ?? 0) >= 5
        ? "text-[#DAA520]"
        : "text-gray-400";
  return `text-xs font-semibold ${color}`;
}

function basicLabel(basicCategory: string | null) {
  if (!basicCategory) return "Uncategorized";
  return BASIC_LABELS[basicCategory] ?? basicCategory.replace(/_/g, " ");
}

function tierLabel(label: string) {
  if (label === "possibly") return "Investigate";
  if (label === "not_challengeable") return "Not challengeable";
  return label.replace(/_/g, " ");
}

function acquisitionLabel(method: string) {
  if (method === "auto") return "Auto";
  if (method === "client") return "From client";
  return "Manual";
}

function acquisitionClass(method: string) {
  if (method === "auto") return "bg-blue-50 text-blue-700 border-blue-100";
  if (method === "client") return "bg-[#FDF4E7] text-[#C67A1E] border-[#C67A1E]/20";
  return "bg-gray-50 text-gray-600 border-gray-200";
}
