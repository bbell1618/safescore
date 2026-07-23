"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Edit3, FileText, Loader2 } from "lucide-react";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import { ReportContent } from "@/components/reports/report-content";
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

  async function handleGenerate() {
    setGenerating(true);
    setContent(null);
    setReportId(null);
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
              type="button"
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
        type="button"
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

      {content !== null && reportId && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
              <div>
                <p className="text-sm font-medium text-green-800">
                  AI draft saved to report history
                </p>
                <p className="mt-0.5 text-xs text-green-700">
                  Open the saved draft to edit final_content and complete human
                  review. The original AI copy stays intact.
                </p>
              </div>
            </div>
            <Link
              href={`/console/clients/${clientId}/reports/${reportId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B2D4F] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2A4270]"
            >
              Review saved draft
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-[#F0E8DA] bg-white px-6 py-7">
            <ReportContent content={content} />
          </div>
        </div>
      )}
    </div>
  );
}
