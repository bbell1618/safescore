"use client";

import { useState, useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { narrativeBlockReason, hasVerifyPlaceholder } from "@/lib/analysis/narrative-sentinels";
import { toFilingReadyNarrative } from "@/lib/cpdp/filing-narrative";
import { cpdpFiledTimelineLabel } from "@/lib/cases/presentation";
import { FiledAuthorizationStatus } from "@/components/console/filed-authorization-status";
import {
  Car,
  AlertTriangle,
  Check,
  Download,
  Upload,
  FileText,
  Loader2,
  Edit3,
  Copy,
  Info,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ─── CPDP eligible crash types ────────────────────────────────────────────────
// Full 21-type list for crashes on/after 2024-12-01; pre-2024 uses a shorter set.
// Source: 49 CFR Part 385 Appendix B to Subchapter B

const ELIGIBLE_TYPES_EXPANDED = [
  "Struck in the rear by another vehicle",
  "Struck while legally stopped or parked",
  "Wrong-direction or illegal U-turn by another vehicle",
  "Struck by an impaired driver",
  "Struck by a distracted driver",
  "Struck by a vehicle changing lanes",
  "Failure to stop at traffic control device by another vehicle",
  "Other driver fell asleep or had a medical emergency",
  "Animal strike",
  "Cargo or debris from another vehicle",
  "Infrastructure failure (road, bridge, or signal defect)",
  "Other vehicle mechanical failure",
  "Suicide attempt by another person",
  "Weather event or natural disaster",
  "Struck in a work zone (not carrier's negligence)",
  "Struck by a train or railroad equipment",
  "Rail crossing signal or gate failure",
  "Vehicle ahead stopped or turned unexpectedly",
  "Struck while loading or unloading",
  "Struck by a vehicle crossing the median",
  "Other — crash circumstances beyond the carrier's control",
];

const ELIGIBLE_TYPES_LEGACY = [
  "Struck in the rear",
  "Parked or legally stopped vehicle struck",
  "Wrong-direction or illegal turn by other vehicle",
  "Other vehicle failure to yield",
  "Lane change by other vehicle",
  "Other driver fell asleep or was incapacitated",
  "Animal strike",
  "Infrastructure failure",
  "Other — not preventable",
];

const EXPANDED_CUTOFF = "2024-12-01";

const FMCSA_CPDP_CATEGORIES = [
  "Struck in the rear",
  "Struck on the side at the rear",
  "Struck on the side (same direction)",
  "Wrong direction",
  "U-turns and illegal turns",
  "Parked or legally stopped",
  "Failure of the other vehicle to stop",
  "Under the influence",
  "Medical issues, falling asleep, or distracted driving",
  "Cargo/equipment/debris or infrastructure failure",
  "Animal strike",
  "Suicide",
  "Struck by vehicle entering road from lot/private drive",
  "Another motorist lost control of vehicle",
  "Non-motorist",
  "Rare or unusual",
  "Video submission",
];

function getEligibleTypes(crashDate: string): string[] {
  return crashDate >= EXPANDED_CUTOFF
    ? ELIGIBLE_TYPES_EXPANDED
    : ELIGIBLE_TYPES_LEGACY;
}

// ─── Status tracker ──────────────────────────────────────────────────────────

// NOTE: The DB enum retains the 'pending' value (deprecated). All 'pending' rows
// were migrated to 'filed' via additive UPDATE. The UI maps both defensively.
const STATUS_STEPS = [
  { key: "draft", label: "Draft" },
  { key: "filed", label: "Filed / Pending FMCSA" },
  { key: "determination_made", label: "Determination" },
  { key: "closed", label: "Closed" },
] as const;

// 'pending' is deprecated — treat it as 'filed' for display purposes.
function StatusTracker({
  status,
  filedDate,
}: {
  status: string;
  filedDate: string | null;
}) {
  // Defensive: treat legacy 'pending' rows as 'filed' in the tracker.
  const normalizedStatus = status === "pending" ? "filed" : status;
  const currentIdx = STATUS_STEPS.findIndex((s) => s.key === normalizedStatus);
  const filedTimeline =
    normalizedStatus === "filed" ? cpdpFiledTimelineLabel(filedDate) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-0 w-full overflow-x-auto pb-1">
        {STATUS_STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={step.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold
                    ${done ? "bg-green-500 text-white" : active ? "bg-[#C67A1E] text-white" : "bg-gray-200 text-gray-400"}`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span
                  className={`text-[10px] text-center leading-tight truncate w-full px-1 ${
                    active ? "text-[#C67A1E] font-semibold" : done ? "text-green-600" : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STATUS_STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-shrink-0 w-6 mx-1 ${
                    i < currentIdx ? "bg-green-400" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {filedTimeline && (
        <p className="text-center text-xs font-medium text-gray-600">
          {filedTimeline}
        </p>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CpdpCaseRow {
  id: string;
  status: string;
  ai_narrative: string | null;
  final_narrative: string | null;
  filing_notes: string | null;
  case_number: string | null;
  outcome: string | null;
  determination_date: string | null;
  filed_date: string | null;
  cpdp_eligible_types: string[] | null;
  filed_without_evidence: boolean;
  override_reason: string | null;
  narrative_evidence_verified: boolean;
  // AI assessment fields — populated on PAR upload
  ai_assessed_at: string | null;
  ai_eligibility_verdict: string | null;   // 'ELIGIBLE' | 'INDETERMINATE' | 'NOT_ELIGIBLE'
  ai_eligibility_rationale: string | null;
  ai_suggested_types: string[] | null;     // original AI suggestions (preserved after human edits)
  // PAR identity confirmation — human confirms the PAR matches this FMCSA crash record
  par_identity_confirmed: boolean;
  par_confirmed_at: string | null;
  par_confirmed_by: string | null;
}

export interface CrashRow {
  id: string;
  crash_date: string;
  city: string;
  state: string;
  report_number: string;
  tow_away: boolean;
  fatalities: number;
  injuries: number;
  hazmat_release: boolean;
  cpdp_eligible: boolean | null;
}

export interface EvidenceItem {
  id: string;
  doc_type: string;
  label: string;
  context_note: string | null;
  fmcsa_category: string | null;
  required: boolean;
  status: string;
  storage_path: string | null;
  uploaded_by: string | null;
}

interface Props {
  clientId: string;
  clientDotNumber: string | null;
  filingAuthorized: boolean;
  filingAuthorizedBy: string | null;
  filingAuthorizationScope: string | null;
  cpdpCase: CpdpCaseRow;
  crash: CrashRow;
  initialEvidence: EvidenceItem[];
  parRetrievalStatus: "ready" | "not_configured";
}

// ─── Evidence status pill ─────────────────────────────────────────────────────

function EvidenceStatusPill({ status }: { status: string }) {
  const received = status === "received";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        received ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      {received ? "Received" : "Pending"}
    </span>
  );
}

function FilingStep({
  number,
  children,
}: {
  number: number;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#C67A1E] text-[11px] font-bold text-white">
        {number}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CpdpCaseEditor({
  clientId,
  clientDotNumber,
  filingAuthorized,
  filingAuthorizedBy,
  filingAuthorizationScope,
  cpdpCase,
  crash,
  initialEvidence,
  parRetrievalStatus,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Eligibility
  const [selectedTypes, setSelectedTypes] = useState<string[]>(
    cpdpCase.cpdp_eligible_types ?? []
  );
  const [eligibilitySaving, setEligibilitySaving] = useState(false);
  const [eligibilitySaved, setEligibilitySaved] = useState(false);

  // AI assessment state — from initial case row or populated after PAR upload
  const [aiVerdict, setAiVerdict] = useState<string | null>(
    cpdpCase.ai_eligibility_verdict ?? null
  );
  const [aiRationale, setAiRationale] = useState<string | null>(
    cpdpCase.ai_eligibility_rationale ?? null
  );
  const [aiSuggestedTypes, setAiSuggestedTypes] = useState<string[]>(
    cpdpCase.ai_suggested_types ?? []
  );

  // PAR identity confirmation state
  const [parConfirmed, setParConfirmed] = useState<boolean>(
    cpdpCase.par_identity_confirmed ?? false
  );
  const [parConfirming, setParConfirming] = useState(false);

  // Evidence
  const [evidence, setEvidence] = useState<EvidenceItem[]>(initialEvidence);
  const [generatingEvidence, setGeneratingEvidence] = useState(false);
  const [evidenceGenError, setEvidenceGenError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Narrative
  const [narrative, setNarrative] = useState(
    cpdpCase.final_narrative ?? cpdpCase.ai_narrative ?? ""
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [narrativeSaving, setNarrativeSaving] = useState(false);
  const [narrativeSaved, setNarrativeSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filingCopied, setFilingCopied] = useState(false);

  // Filing
  const [caseNumber, setCaseNumber] = useState(cpdpCase.case_number ?? "");
  const [filingNotes, setFilingNotes] = useState(cpdpCase.filing_notes ?? "");
  const [filingError, setFilingError] = useState<string | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(
    cpdpCase.filed_without_evidence ?? false
  );
  const [overrideReason, setOverrideReason] = useState(cpdpCase.override_reason ?? "");
  const [authorizationOverrideChecked, setAuthorizationOverrideChecked] = useState(false);
  const [authorizationOverrideReason, setAuthorizationOverrideReason] = useState("");

  // Status
  const [status, setStatus] = useState<string>(cpdpCase.status);

  const caseId = cpdpCase.id;
  const isResolved = ["determination_made", "closed"].includes(status);
  const parReceived = evidence.some(
    (e) => e.doc_type === "police_report" && e.status === "received"
  );
  const blockReason = narrativeBlockReason(narrative);
  const hasEvidence = evidence.length > 0;
  const authorizationOverrideActive =
    authorizationOverrideChecked && authorizationOverrideReason.trim().length > 0;
  const authorizationGateSatisfied = filingAuthorized || authorizationOverrideActive;
  const canFile =
    !isResolved &&
    status !== "filed" &&
    status !== "pending" && // 'pending' is deprecated but guarded defensively
    !blockReason &&
    narrative.trim().length > 50 &&
    (parReceived || overrideChecked) &&
    authorizationGateSatisfied;
  const filingReady = toFilingReadyNarrative(narrative);
  const selectedTypeSummary =
    selectedTypes.length > 0 ? selectedTypes.join("; ") : "No eligible type selected yet";
  const displayDotNumber = clientDotNumber || "not on file";
  const displayCrashDate = crash.crash_date ? formatDate(crash.crash_date) : "not on file";
  const displayCrashState = crash.state || "not on file";
  const displayFmcsaCrashNumber = crash.report_number || "not on file";

  // ── Eligibility save ────────────────────────────────────────────────────────
  async function saveEligibility() {
    setEligibilitySaving(true);
    setEligibilitySaved(false);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpdp_eligible_types: selectedTypes }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Save failed");
      }
      setEligibilitySaved(true);
      setTimeout(() => setEligibilitySaved(false), 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setEligibilitySaving(false);
    }
  }

  // ── Evidence generate ───────────────────────────────────────────────────────
  async function generateEvidence() {
    setGeneratingEvidence(true);
    setEvidenceGenError(null);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setEvidence(data.evidence ?? []);
    } catch (err) {
      setEvidenceGenError(err instanceof Error ? err.message : "Failed to generate checklist");
    } finally {
      setGeneratingEvidence(false);
    }
  }

  // ── Upload ──────────────────────────────────────────────────────────────────
  async function handleUpload(evidId: string, file: File) {
    setUploadingId(evidId);
    setUploadErrors((prev) => { const n = { ...prev }; delete n[evidId]; return n; });
    const evidItem = evidence.find((e) => e.id === evidId);
    const isPar = evidItem?.doc_type === "police_report";
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/cases/cpdp/${caseId}/evidence/${evidId}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadErrors((prev) => ({ ...prev, [evidId]: data.error ?? "Upload failed" }));
        return;
      }
      // Mark evidence item received
      setEvidence((prev) =>
        prev.map((e) =>
          e.id === evidId ? { ...e, status: "received", uploaded_by: "geia" } : e
        )
      );
      // If the PAR was uploaded and the server returned an eligibility assessment,
      // update §1 state and auto-trigger the narrative draft.
      if (isPar && data.assessment) {
        const { verdict, eligibleTypes, reasoning } = data.assessment as {
          verdict: string;
          eligibleTypes: string[];
          reasoning: string;
        };
        setAiVerdict(verdict ?? null);
        setAiRationale(reasoning ?? null);
        setAiSuggestedTypes(eligibleTypes ?? []);
        // Pre-select AI-suggested types if the human hasn't made a selection yet
        setSelectedTypes((prev) =>
          prev.length === 0 && eligibleTypes.length > 0 ? eligibleTypes : prev
        );
        // Auto-draft the narrative from the newly uploaded PAR
        generateNarrative();
      }
    } catch {
      setUploadErrors((prev) => ({ ...prev, [evidId]: "Network error" }));
    } finally {
      setUploadingId(null);
    }
  }

  // ── Download ────────────────────────────────────────────────────────────────
  async function handleDownload(evidId: string) {
    setDownloadingId(evidId);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}/evidence/${evidId}/download`);
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed");
      window.open(data.url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  }

  // ── Confirm PAR identity ────────────────────────────────────────────────────
  // Records that a human reviewer has verified the attached PAR corresponds to
  // this FMCSA crash record. Clears the report-number mismatch block in the
  // narrative prompt (FMCSA MCMIS numbers and local PAR numbers always differ).
  async function confirmParIdentity() {
    setParConfirming(true);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          par_identity_confirmed: true,
          par_confirmed_at: new Date().toISOString(),
          par_confirmed_by: "geia",
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Confirmation failed");
      }
      setParConfirmed(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setParConfirming(false);
    }
  }

  // ── Generate narrative ──────────────────────────────────────────────────────
  async function generateNarrative() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _action: "narrative" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Generation failed");
      setNarrative(data.narrative ?? "");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  // ── Save narrative ──────────────────────────────────────────────────────────
  async function saveNarrative() {
    if (blockReason) return;
    setNarrativeSaving(true);
    setNarrativeSaved(false);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final_narrative: narrative }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Save failed");
      }
      setNarrativeSaved(true);
      setTimeout(() => setNarrativeSaved(false), 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setNarrativeSaving(false);
    }
  }

  // ── Mark filed ──────────────────────────────────────────────────────────────
  async function markFiled() {
    setFilingError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        status: "filed",
        filed_date: new Date().toISOString().split("T")[0],
      };
      if (caseNumber.trim()) payload.case_number = caseNumber.trim();
      const authOverrideNote = authorizationOverrideActive
        ? `Filing authorization override: ${authorizationOverrideReason.trim()}`
        : "";
      const combinedFilingNotes = [filingNotes.trim(), authOverrideNote]
        .filter(Boolean)
        .join("\n\n");
      if (combinedFilingNotes) payload.filing_notes = combinedFilingNotes;
      if (overrideChecked) {
        payload.filed_without_evidence = true;
        payload.override_reason = overrideReason.trim() || null;
      }

      const res = await fetch(`/api/cases/cpdp/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to file");
      setStatus("filed");
      router.refresh();
    } catch (err) {
      setFilingError(err instanceof Error ? err.message : "Filing failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Status advance ──────────────────────────────────────────────────────────
  async function advanceStatus(newStatus: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/cases/cpdp/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setStatus(newStatus);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  const eligibleTypes = getEligibleTypes(crash.crash_date);

  return (
    <div className="space-y-6">

      {/* ── Status Tracker ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#F0E8DA] p-5">
        <StatusTracker status={status} filedDate={cpdpCase.filed_date} />
      </div>

      {/* ── Case Summary ───────────────────────────────────────────────────── */}
      <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
        <div className="flex items-start gap-3">
          <Car className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-[#1E1C1A] text-sm">
                {formatDate(crash.crash_date)} — {crash.city}, {crash.state}
              </span>
              {crash.tow_away && <Badge variant="warning">Tow-away</Badge>}
              {crash.fatalities > 0 && <Badge variant="danger">{crash.fatalities} fatal</Badge>}
              {crash.injuries > 0 && <Badge variant="warning">{crash.injuries} injured</Badge>}
              {crash.hazmat_release && <Badge variant="danger">Hazmat</Badge>}
            </div>
            <p className="text-xs text-gray-500">
              Report: {crash.report_number}
            </p>
          </div>
        </div>
      </div>

      {/* ── Section 1: Eligibility ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#F0E8DA] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">1. Eligible crash type</h2>
          {crash.crash_date >= EXPANDED_CUTOFF && (
            <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-2 py-0.5">
              21-type list (Dec 2024+)
            </span>
          )}
        </div>

        {/* AI assessment banner — shown after PAR is uploaded and assessed */}
        {aiVerdict && (
          <div
            className={`flex items-start gap-2.5 p-3 rounded-lg border ${
              aiVerdict === "ELIGIBLE"
                ? "bg-blue-50 border-blue-200"
                : aiVerdict === "NOT_ELIGIBLE"
                ? "bg-red-50 border-red-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            {aiVerdict === "ELIGIBLE" ? (
              <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle
                className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                  aiVerdict === "NOT_ELIGIBLE" ? "text-red-600" : "text-amber-600"
                }`}
              />
            )}
            <div className="flex-1 min-w-0">
              <p
                className={`text-xs font-semibold mb-0.5 ${
                  aiVerdict === "ELIGIBLE"
                    ? "text-blue-800"
                    : aiVerdict === "NOT_ELIGIBLE"
                    ? "text-red-800"
                    : "text-amber-800"
                }`}
              >
                AI assessment from PAR
                {aiVerdict === "ELIGIBLE" && " — Eligible"}
                {aiVerdict === "NOT_ELIGIBLE" && " — Likely not eligible"}
                {aiVerdict === "INDETERMINATE" && " — Ambiguous"}
              </p>
              {aiRationale && (
                <p
                  className={`text-[11px] ${
                    aiVerdict === "ELIGIBLE"
                      ? "text-blue-700"
                      : aiVerdict === "NOT_ELIGIBLE"
                      ? "text-red-700"
                      : "text-amber-700"
                  }`}
                >
                  {aiRationale}
                </p>
              )}
              {aiVerdict === "ELIGIBLE" && aiSuggestedTypes.length > 0 && (
                <p className="text-[10px] text-blue-600 mt-1">
                  {aiSuggestedTypes.length} type{aiSuggestedTypes.length !== 1 ? "s" : ""} pre-selected below. Review and save to confirm.
                </p>
              )}
              {aiVerdict === "NOT_ELIGIBLE" && (
                <p className="text-[10px] text-red-600 mt-1">
                  You may still manually select types and file — this is an AI assessment, not a final ruling.
                </p>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500">
          Select all applicable types. This is asserted in the RFD narrative — ground it in the PAR.
        </p>
        <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-1">
          {eligibleTypes.map((t) => {
            const isAiSuggested = aiSuggestedTypes.includes(t);
            return (
              <label
                key={t}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  selectedTypes.includes(t)
                    ? "border-[#C67A1E] bg-[#FDF4E7] text-[#1E1C1A]"
                    : "border-[#F0E8DA] hover:border-[#C67A1E]/50 text-gray-600"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#C67A1E] flex-shrink-0"
                  checked={selectedTypes.includes(t)}
                  onChange={(e) =>
                    setSelectedTypes((prev) =>
                      e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)
                    )
                  }
                />
                <span className="flex-1">{t}</span>
                {isAiSuggested && (
                  <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded px-1 py-0.5 flex-shrink-0 self-start mt-0.5">
                    AI
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-400">
            {selectedTypes.length} selected
          </span>
          <button
            onClick={saveEligibility}
            disabled={eligibilitySaving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] disabled:opacity-50 transition-colors"
          >
            {eligibilitySaving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : eligibilitySaved ? (
              <Check className="w-3 h-3" />
            ) : null}
            {eligibilitySaved ? "Saved" : "Save eligibility"}
          </button>
        </div>
      </div>

      {/* ── Section 2: Evidence ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#F0E8DA] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">2. Evidence</h2>
          {!parReceived && (
            <span className="text-[10px] text-[#C67A1E] font-medium">
              PAR required
            </span>
          )}
        </div>

        {parRetrievalStatus === "not_configured" && !parReceived && (
          <div className="rounded-lg border border-[#F0E8DA] bg-white p-3">
            <p className="text-xs font-semibold text-[#1E1C1A]">PAR retrieval pending account activation</p>
            <p className="mt-1 text-[11px] text-gray-500">LexisNexis retrieval is not configured. Use the manual-upload path below; no report data is fabricated.</p>
          </div>
        )}

        {!hasEvidence ? (
          <div className="text-center py-6">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-3">Generate the evidence checklist to start uploading.</p>
            {evidenceGenError && (
              <p className="text-xs text-red-600 mb-2">{evidenceGenError}</p>
            )}
            <button
              onClick={generateEvidence}
              disabled={generatingEvidence}
              className="flex items-center gap-1.5 mx-auto px-3 py-1.5 text-xs font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] disabled:opacity-50 transition-colors"
            >
              {generatingEvidence && <Loader2 className="w-3 h-3 animate-spin" />}
              Generate evidence checklist
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* PAR identity confirmation — shown when PAR is uploaded */}
            {parReceived && (
              <div className={`flex items-start gap-2.5 p-3 rounded-lg border ${
                parConfirmed
                  ? "bg-green-50 border-green-200"
                  : "bg-blue-50 border-blue-200"
              }`}>
                {parConfirmed ? (
                  <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold mb-0.5 ${parConfirmed ? "text-green-800" : "text-blue-800"}`}>
                    {parConfirmed ? "PAR identity confirmed" : "Confirm this PAR matches this crash"}
                  </p>
                  <p className={`text-[11px] ${parConfirmed ? "text-green-700" : "text-blue-700"}`}>
                    {parConfirmed
                      ? "A reviewer has confirmed the uploaded PAR corresponds to this FMCSA crash record. The narrative generator will use this PAR without re-checking report numbers."
                      : "FMCSA crash numbers and local PAR report numbers always differ. After reviewing the uploaded PAR, confirm it is for this crash to allow grounded narrative generation."}
                  </p>
                </div>
                {!parConfirmed && (
                  <button
                    onClick={confirmParIdentity}
                    disabled={parConfirming}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
                  >
                    {parConfirming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Confirm
                  </button>
                )}
              </div>
            )}
            {evidence.map((ev) => (
              <div
                key={ev.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  ev.required && ev.status !== "received"
                    ? "border-[#C67A1E]/40 bg-[#FDF4E7]"
                    : "border-[#F0E8DA]"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-medium text-[#1E1C1A]">
                      {ev.label}
                    </span>
                    {ev.required && (
                      <span className="text-[9px] font-bold text-[#C67A1E] uppercase tracking-wide">
                        required
                      </span>
                    )}
                    <EvidenceStatusPill status={ev.status} />
                  </div>
                  {ev.context_note && (
                    <p className="text-[11px] text-gray-400">{ev.context_note}</p>
                  )}
                  {uploadErrors[ev.id] && (
                    <p className="text-[11px] text-red-600 mt-1">{uploadErrors[ev.id]}</p>
                  )}
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {ev.status === "received" && (
                    <button
                      onClick={() => handleDownload(ev.id)}
                      disabled={downloadingId === ev.id}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium border border-[#F0E8DA] rounded hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors disabled:opacity-50"
                      title="Download"
                    >
                      {downloadingId === ev.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => uploadRefs.current[ev.id]?.click()}
                    disabled={uploadingId === ev.id}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium border border-[#F0E8DA] rounded hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors disabled:opacity-50"
                    title={ev.status === "received" ? "Replace" : "Upload"}
                  >
                    {uploadingId === ev.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    <span>{ev.status === "received" ? "Replace" : "Upload"}</span>
                  </button>
                  <input
                    type="file"
                    className="hidden"
                    ref={(el) => { uploadRefs.current[ev.id] = el; }}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tif,.tiff,.mp4,.mov,.avi"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(ev.id, f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 3: Narrative ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#F0E8DA] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">3. Submission narrative</h2>
          <div className="flex gap-2">
            <button
              onClick={generateNarrative}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] disabled:opacity-50 transition-colors"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Edit3 className="w-3 h-3" />}
              {generating ? "Generating…" : parReceived ? "Re-generate from PAR" : "Generate draft"}
            </button>
            {narrative && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(narrative);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>

        {!parReceived && hasEvidence && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Upload the Police Accident Report before generating the narrative. Without the PAR,
              the AI cannot assert verifiable facts and will return a provisional draft only.
            </p>
          </div>
        )}

        {genError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-700">{genError}</p>
          </div>
        )}

        {/* Sentinel gates */}
        {blockReason && narrative.includes("INSUFFICIENT EVIDENCE") && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-300 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-700">
              <p className="font-semibold mb-0.5">Insufficient Evidence — filing blocked</p>
              <p>The AI determined the attached documents do not support a non-preventable finding. Obtain the proper PAR and regenerate before filing.</p>
            </div>
          </div>
        )}
        {blockReason && hasVerifyPlaceholder(narrative) && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-300 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Narrative contains unresolved <code className="font-mono">[VERIFY: …]</code> placeholders. Resolve them manually before saving or filing.
            </p>
          </div>
        )}

        <textarea
          className="w-full min-h-[200px] p-3 text-xs text-[#1E1C1A] bg-gray-50 border border-[#F0E8DA] rounded-lg resize-y font-mono focus:outline-none focus:border-[#C67A1E]"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="AI-generated narrative will appear here. You can edit before saving."
        />

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400">
            {narrative.trim().length} chars
          </span>
          <button
            onClick={saveNarrative}
            disabled={narrativeSaving || !!blockReason || narrative.trim().length < 10}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] disabled:opacity-50 transition-colors"
          >
            {narrativeSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : narrativeSaved ? <Check className="w-3 h-3" /> : null}
            {narrativeSaved ? "Saved" : "Save narrative"}
          </button>
        </div>
      </div>

      {/* ── Section 4: Filing ──────────────────────────────────────────────── */}
      {!isResolved && (
        <div className="bg-white rounded-xl border border-[#F0E8DA] p-5 space-y-4">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">4. File with FMCSA</h2>

          {status === "filed" || status === "pending" ? (
            <FiledAuthorizationStatus
              clientId={clientId}
              filingAuthorized={filingAuthorized}
              filingAuthorizedBy={filingAuthorizedBy}
              filingAuthorizationScope={filingAuthorizationScope}
            />
          ) : (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                filingAuthorized
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {filingAuthorized ? (
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              )}
              <div>
                <p className="font-semibold">
                  {filingAuthorized
                    ? `Client authorized GEIA to file on their behalf${filingAuthorizedBy ? ` (${filingAuthorizedBy})` : ""}.`
                    : "No filing authorization on record for this client."}
                </p>
                {!filingAuthorized && (
                  <p className="mt-0.5">
                    GEIA files on the carrier&apos;s behalf and attests under 18 USC 1001 - obtain the client&apos;s authorization (onboarding Step 3) before filing.
                  </p>
                )}
                {filingAuthorized && filingAuthorizationScope && (
                  <p className="mt-0.5 text-[11px] text-green-600">{filingAuthorizationScope}</p>
                )}
              </div>
            </div>
          )}

          {status === "filed" || status === "pending" ? (
            // 'filed' and legacy 'pending' are the same state: submitted to DataQs,
            // awaiting FMCSA's ruling. "Advance to Pending FMCSA" removed — it was
            // a no-op step between identical states.
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>
                  Case filed{cpdpCase.filed_date ? ` on ${formatDate(cpdpCase.filed_date)}` : ""}
                  {cpdpCase.case_number ? ` — FMCSA case ${cpdpCase.case_number}` : ""}.
                </span>
              </div>
              <button
                onClick={() => advanceStatus("determination_made")}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] disabled:opacity-50 transition-colors"
              >
                Record determination
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <ol className="space-y-4">
                <FilingStep number={1}>
                  <div className="space-y-1 text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Open DataQs.</p>
                    <p>
                      Sign in at{" "}
                      <a
                        href="https://dataqs.fmcsa.dot.gov"
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[#C67A1E] underline-offset-2 hover:underline"
                      >
                        dataqs.fmcsa.dot.gov
                      </a>
                      , then choose Add a Request - Crash record.
                    </p>
                  </div>
                </FilingStep>

                <FilingStep number={2}>
                  <div className="space-y-2 text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Identify the crash.</p>
                    <div className="grid grid-cols-1 gap-2 rounded-lg border border-[#F0E8DA] bg-[#FBF7F0] p-3 sm:grid-cols-2">
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-gray-400">State</span>
                        <span className="font-mono text-[#1E1C1A]">{displayCrashState}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-gray-400">USDOT</span>
                        <span className="font-mono text-[#1E1C1A]">{displayDotNumber}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-gray-400">Crash date</span>
                        <span className="font-mono text-[#1E1C1A]">{displayCrashDate}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-gray-400">FMCSA crash/report number</span>
                        <span className="font-mono text-[#1E1C1A]">{displayFmcsaCrashNumber}</span>
                      </div>
                    </div>
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-800">
                      The report-number field expects the FMCSA MCMIS crash number, NOT the local PAR number.
                    </p>
                  </div>
                </FilingStep>

                <FilingStep number={3}>
                  <div className="text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Choose the reason.</p>
                    <p>Select <span className="font-semibold">Crash could not be prevented</span>.</p>
                  </div>
                </FilingStep>

                <FilingStep number={4}>
                  <div className="space-y-2 text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Select the eligible crash type.</p>
                    <p>
                      Based on the case, this looks like:{" "}
                      <span className="font-semibold text-[#1E1C1A]">{selectedTypeSummary}</span>.
                    </p>
                    <p>
                      Select the FMCSA category in the portal that matches this crash, then record which one you chose in the filing notes in step 8.
                    </p>
                    <div className="rounded-lg border border-[#F0E8DA] bg-[#FBF7F0] p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase text-gray-400">
                        FMCSA CPDP eligible categories
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {FMCSA_CPDP_CATEGORIES.map((category) => (
                          <span
                            key={category}
                            className="rounded-full border border-[#F0E8DA] bg-white px-2 py-1 text-[10px] text-[#1E1C1A]"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-gray-400">
                        Source: FMCSA CPDP Eligibility Guide, December 2024.
                      </p>
                    </div>
                  </div>
                </FilingStep>

                <FilingStep number={5}>
                  <div className="space-y-2 text-xs text-gray-600">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#1E1C1A]">Paste the explanation.</p>
                        <p>Cleaned for filing - internal notes removed. Review before pasting into the Explain the details of the crash box.</p>
                      </div>
                      {!filingReady.blocked && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(filingReady.text);
                            setFilingCopied(true);
                            setTimeout(() => setFilingCopied(false), 2000);
                          }}
                          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[#F0E8DA] px-3 py-1.5 text-xs font-medium transition-colors hover:border-[#C67A1E] hover:text-[#C67A1E]"
                        >
                          <Copy className="h-3 w-3" />
                          {filingCopied ? "Copied" : "Copy filing-ready text"}
                        </button>
                      )}
                    </div>
                    {filingReady.blocked ? (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                        <span>{filingReady.blockReason}</span>
                      </div>
                    ) : (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[#F0E8DA] bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-[#1E1C1A]">
                        {filingReady.text}
                      </pre>
                    )}
                  </div>
                </FilingStep>

                <FilingStep number={6}>
                  <div className="space-y-2 text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Attach evidence.</p>
                    {evidence.length === 0 ? (
                      <p className="rounded-lg border border-[#F0E8DA] bg-[#FBF7F0] p-3">
                        No evidence checklist is on file yet. Generate and upload the PAR before filing.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {evidence.map((ev) => (
                          <div
                            key={ev.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-[#F0E8DA] bg-[#FBF7F0] px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[#1E1C1A]">
                                {ev.label}
                                {ev.required ? " (required)" : ""}
                              </p>
                              {ev.fmcsa_category && (
                                <p className="text-[10px] text-gray-400">{ev.fmcsa_category}</p>
                              )}
                            </div>
                            <EvidenceStatusPill status={ev.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </FilingStep>

                <FilingStep number={7}>
                  <div className="text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Review and submit.</p>
                    <p>Review the DataQs request, evidence, and federal attestation before submitting.</p>
                  </div>
                </FilingStep>

                <FilingStep number={8}>
                  <div className="space-y-3 text-xs text-gray-600">
                    <p className="font-semibold text-[#1E1C1A]">Record the result here.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          FMCSA case ID (after filing)
                        </label>
                        <input
                          type="text"
                          value={caseNumber}
                          onChange={(e) => setCaseNumber(e.target.value)}
                          placeholder="e.g. CPDP-2026-XXXXXX"
                          className="w-full px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg focus:outline-none focus:border-[#C67A1E]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Filing notes - record the DataQs scenario you selected + reviewing agency
                        </label>
                        <input
                          type="text"
                          value={filingNotes}
                          onChange={(e) => setFilingNotes(e.target.value)}
                          placeholder="e.g. Parked or legally stopped - FMCSA Western Region"
                          className="w-full px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg focus:outline-none focus:border-[#C67A1E]"
                        />
                      </div>
                    </div>

                    {/* PAR gate override */}
                    {!parReceived && hasEvidence && (
                      <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-[#C67A1E]"
                            checked={overrideChecked}
                            onChange={(e) => setOverrideChecked(e.target.checked)}
                          />
                          <span className="text-xs text-amber-800">
                            File without PAR - I understand FMCSA may not review this submission without a Police Accident Report.
                          </span>
                        </label>
                        {overrideChecked && (
                          <input
                            type="text"
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            placeholder="Reason (e.g. PAR unavailable - proceeding with dashcam)"
                            className="w-full px-2 py-1 text-xs border border-amber-300 rounded bg-white focus:outline-none"
                          />
                        )}
                      </div>
                    )}

                    {!filingAuthorized && (
                      <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-[#C67A1E]"
                            checked={authorizationOverrideChecked}
                            onChange={(e) => setAuthorizationOverrideChecked(e.target.checked)}
                          />
                          <span className="text-xs text-amber-800">
                            File without recorded authorization - I confirm GEIA has the carrier&apos;s authorization to file on their behalf.
                          </span>
                        </label>
                        {authorizationOverrideChecked && (
                          <input
                            type="text"
                            value={authorizationOverrideReason}
                            onChange={(e) => setAuthorizationOverrideReason(e.target.value)}
                            placeholder="Reason / authorization source (required)"
                            className="w-full px-2 py-1 text-xs border border-amber-300 rounded bg-white focus:outline-none"
                          />
                        )}
                      </div>
                    )}

                    {filingError && (
                      <p className="text-xs text-red-600">{filingError}</p>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={markFiled}
                        disabled={saving || !canFile}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] disabled:opacity-40 transition-colors"
                        title={
                          !canFile
                            ? blockReason ??
                              (!authorizationGateSatisfied
                                ? "Client filing authorization is required, or use the authorization override below."
                                : !parReceived && !overrideChecked
                                ? "Upload the PAR or enable the override"
                                : narrative.trim().length < 50
                                ? "Add a narrative before filing"
                                : "")
                            : undefined
                        }
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Mark as filed
                      </button>
                      {!canFile && (
                        <span className="text-[11px] text-gray-400">
                          {blockReason
                            ? "Resolve narrative issues"
                            : !authorizationGateSatisfied
                            ? "Client authorization required - obtain it or use override"
                            : !parReceived && !overrideChecked
                            ? "PAR required - upload or override"
                            : narrative.trim().length < 50
                            ? "Narrative too short"
                            : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </FilingStep>
              </ol>
              {false && (
                <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    FMCSA case ID (after filing)
                  </label>
                  <input
                    type="text"
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                    placeholder="e.g. CPDP-2026-XXXXXX"
                    className="w-full px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg focus:outline-none focus:border-[#C67A1E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Reviewing agency / notes
                  </label>
                  <input
                    type="text"
                    value={filingNotes}
                    onChange={(e) => setFilingNotes(e.target.value)}
                    placeholder="e.g. FMCSA Western Region"
                    className="w-full px-3 py-1.5 text-xs border border-[#F0E8DA] rounded-lg focus:outline-none focus:border-[#C67A1E]"
                  />
                </div>
              </div>

              {/* PAR gate override */}
              {!parReceived && hasEvidence && (
                <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#C67A1E]"
                      checked={overrideChecked}
                      onChange={(e) => setOverrideChecked(e.target.checked)}
                    />
                    <span className="text-xs text-amber-800">
                      File without PAR — I understand FMCSA may not review this submission without a Police Accident Report.
                    </span>
                  </label>
                  {overrideChecked && (
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Reason (e.g. PAR unavailable — proceeding with dashcam)"
                      className="w-full px-2 py-1 text-xs border border-amber-300 rounded bg-white focus:outline-none"
                    />
                  )}
                </div>
              )}

              {filingError && (
                <p className="text-xs text-red-600">{filingError}</p>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={markFiled}
                  disabled={saving || !canFile}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] disabled:opacity-40 transition-colors"
                  title={
                    !canFile
                      ? blockReason ??
                        (!parReceived && !overrideChecked
                          ? "Upload the PAR or enable the override"
                          : narrative.trim().length < 50
                          ? "Add a narrative before filing"
                          : "")
                      : undefined
                  }
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Mark as filed
                </button>
                {!canFile && (
                  <span className="text-[11px] text-gray-400">
                    {blockReason
                      ? "Resolve narrative issues"
                      : !parReceived && !overrideChecked
                      ? "PAR required — upload or override"
                      : narrative.trim().length < 50
                      ? "Narrative too short"
                      : ""}
                  </span>
                )}
              </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 5: Determination ───────────────────────────────────────── */}
      {isResolved && (
        <div className="bg-white rounded-xl border border-[#F0E8DA] p-5 space-y-4">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">4. File with FMCSA</h2>
          <FiledAuthorizationStatus
            clientId={clientId}
            filingAuthorized={filingAuthorized}
            filingAuthorizedBy={filingAuthorizedBy}
            filingAuthorizationScope={filingAuthorizationScope}
          />
        </div>
      )}

      {status === "determination_made" && (
        <div className="bg-white rounded-xl border border-[#F0E8DA] p-5 space-y-3">
          <h2 className="font-semibold text-[#1E1C1A] text-sm">5. Determination</h2>
          {cpdpCase.outcome && (
            <div className="flex items-center gap-3">
              <Badge
                variant={
                  cpdpCase.outcome === "not_preventable"
                    ? "success"
                    : cpdpCase.outcome === "preventable"
                    ? "danger"
                    : "warning"
                }
              >
                {cpdpCase.outcome === "not_preventable"
                  ? "Not Preventable"
                  : cpdpCase.outcome === "preventable"
                  ? "Preventable"
                  : cpdpCase.outcome}
              </Badge>
              {cpdpCase.determination_date && (
                <span className="text-xs text-gray-500">
                  {formatDate(cpdpCase.determination_date)}
                </span>
              )}
            </div>
          )}
          <button
            onClick={() => advanceStatus("closed")}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#C67A1E] hover:text-[#C67A1E] disabled:opacity-50 transition-colors"
          >
            Close case
          </button>
        </div>
      )}

      {saveError && (
        <p className="text-xs text-red-600">{saveError}</p>
      )}
    </div>
  );
}
