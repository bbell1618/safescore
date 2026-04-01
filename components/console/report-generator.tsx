"use client";

import { useState } from "react";
import { FileText, Loader2, Send, Edit3, CheckCircle } from "lucide-react";

interface Props {
  clientId: string;
  dotNumber: string;
  carrierName: string;
}

type ReportType = "assessment" | "monthly" | "quarterly" | "improvement" | "underwriter";

const reportTypes: Array<{ value: ReportType; label: string; description: string }> = [
  { value: "assessment", label: "Initial assessment", description: "Full safety profile analysis with recommendations. Used to onboard new clients." },
  { value: "monthly", label: "Monthly progress", description: "Score changes, new violations, case updates, and next steps." },
  { value: "quarterly", label: "Quarterly re-analysis", description: "Comprehensive re-analysis with before/after comparison." },
  { value: "improvement", label: "Improvement report", description: "Before/after summary of score improvements achieved. Used for insurance re-marketing." },
  { value: "underwriter", label: "Underwriter report", description: "Carrier-ready document showing remediation work completed. Submitted to insurance carriers." },
];

export function ReportGenerator({ clientId, dotNumber, carrierName }: Props) {
  const [type, setType] = useState<ReportType>("assessment");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setContent(null);
    setReportId(null);
    setSaved(false);
    setSent(false);
    setSendError(null);
    try {
      const res = await fetch(`/api/reports/generate-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, dotNumber, type }),
      });
      const data = await res.json();
      if (data.content) setContent(data.content);
      if (data.reportId) setReportId(data.reportId);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!content) return;
    const res = await fetch(`/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, type, content }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.reportId) setReportId(data.reportId);
      setSaved(true);
    }
  }

  async function handleSend() {
    if (!reportId) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/send`, {
        method: "POST",
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json();
        setSendError(data.error ?? "Failed to send report");
      }
    } catch {
      setSendError("Network error — please try again");
    } finally {
      setSending(false);
    }
  }

  const selectedType = reportTypes.find((r) => r.value === type)!;

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] p-5 space-y-5">
      <div>
        <label className="block text-xs font-semibold text-[#1A1A1A] mb-2">
          Report type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {reportTypes.map((rt) => (
            <button
              key={rt.value}
              onClick={() => setType(rt.value)}
              className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                type === rt.value
                  ? "border-[#DC362E] bg-red-50"
                  : "border-[#E5E5E5] hover:border-gray-300"
              }`}
            >
              <p className={`text-xs font-medium ${type === rt.value ? "text-[#DC362E]" : "text-[#1A1A1A]"}`}>
                {rt.label}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">{rt.description}</p>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-2 px-4 py-2.5 bg-[#DC362E] text-white rounded-lg text-sm font-medium hover:bg-[#b52a23] transition-colors disabled:opacity-50"
      >
        {generating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Edit3 className="w-4 h-4" />
        )}
        {generating ? "Generating AI draft..." : `Generate ${selectedType.label.toLowerCase()}`}
      </button>

      {content !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#1A1A1A]">
              AI draft — review before sending to client
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saved}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E5E5] rounded-lg text-xs hover:border-[#1A1A1A] transition-colors disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                {saved ? "Saved" : "Save as reviewed"}
              </button>
              {sent ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Sent
                </div>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={sending || !reportId}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] text-white rounded-lg text-xs hover:bg-black transition-colors disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {sending ? "Sending..." : "Send to client"}
                </button>
              )}
            </div>
          </div>
          {sendError && (
            <p className="text-xs text-[#DC362E]">{sendError}</p>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            className="w-full px-4 py-3 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] resize-y"
          />
        </div>
      )}
    </div>
  );
}
