"use client";

import { useState } from "react";
import { FileText, Loader2, Send, Edit3, CheckCircle } from "lucide-react";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import type { ClientTier } from "@/lib/supabase/types";

interface Props {
  clientId: string;
  clientTier: ClientTier;
}

type ReportType = "assessment" | "monthly" | "quarterly" | "improvement" | "underwriter";

const reportTypes: Array<{ value: ReportType; label: string; description: string }> = [
  { value: "assessment", label: "Initial assessment", description: "Full safety profile analysis with recommendations. Used to onboard new clients." },
  { value: "monthly", label: "Monthly progress", description: "Burden trend, new violations, and next priorities. Open challenges are added for Remediate and above." },
  { value: "quarterly", label: "Quarterly re-analysis", description: "Comprehensive re-analysis with before/after comparison." },
  { value: "improvement", label: "Improvement report", description: "Before/after summary of score improvements achieved. Used for insurance re-marketing." },
  { value: "underwriter", label: "Underwriter report", description: "Carrier-ready document showing remediation work completed. Submitted to insurance carriers." },
];

export function ReportGenerator({ clientId, clientTier }: Props) {
  const [type, setType] = useState<ReportType>("assessment");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
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
    setGenerationError(null);
    try {
      const res = await fetch(`/api/reports/generate-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, type }),
      });
      const data = (await res.json().catch(() => null)) as {
        content?: string;
        reportId?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          data?.error ?? `Report generation failed with HTTP ${res.status}`
        );
      }
      if (!data?.content || !data.reportId) {
        throw new Error("Report generation did not return a saved draft.");
      }
      setContent(data.content);
      setReportId(data.reportId);
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : "Report generation failed."
      );
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
    <div className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5 space-y-5">
      <div>
        <label className="block text-xs font-semibold text-[#1E1C1A] mb-2">
          Report type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {reportTypes.map((rt) => (
            <button
              key={rt.value}
              onClick={() => setType(rt.value)}
              className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                type === rt.value
                  ? "border-[#C67A1E] bg-[#FDF4E7]"
                  : "border-[#F0E8DA] hover:border-gray-300"
              }`}
            >
              <p className={`text-xs font-medium ${type === rt.value ? "text-[#C67A1E]" : "text-[#1E1C1A]"}`}>
                {rt.label}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">{rt.description}</p>
              {rt.value === "monthly" && (
                <span className="mt-1 inline-flex">
                  <ServiceTierChip tier={clientTier} feature="monthly_reports" compact />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-2 px-4 py-2.5 bg-[#C67A1E] text-white rounded-lg text-sm font-medium hover:bg-[#B86E18] transition-colors disabled:opacity-50"
      >
        {generating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Edit3 className="w-4 h-4" />
        )}
        {generating ? "Generating AI draft..." : `Generate ${selectedType.label.toLowerCase()}`}
      </button>

      {generationError && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {generationError}
        </p>
      )}

      {content !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#1E1C1A]">
              AI draft — review before sending to client
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saved}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#F0E8DA] rounded-lg text-xs hover:border-[#1B2D4F] transition-colors disabled:opacity-50"
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
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1B2D4F] text-white rounded-lg text-xs hover:bg-[#2A4270] transition-colors disabled:opacity-50"
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
            <p className="text-xs text-[#C67A1E]">{sendError}</p>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            className="w-full px-4 py-3 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] resize-y"
          />
        </div>
      )}
    </div>
  );
}
