"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { FileText, ChevronDown, ChevronUp } from "lucide-react";

interface Report {
  id: string;
  type: string;
  title: string;
  final_content: string | null;
  sent_at: string | null;
}

interface ReportViewerProps {
  reports: Report[];
}

const typeLabel: Record<string, string> = {
  assessment: "Assessment",
  monthly: "Monthly",
  quarterly: "Quarterly",
  improvement: "Improvement",
  underwriter: "Underwriter",
};

const typeVariant = (
  type: string
): "default" | "info" | "gold" | "success" => {
  if (type === "assessment") return "info";
  if (type === "underwriter") return "gold";
  if (type === "improvement") return "success";
  return "default";
};

export function ReportViewer({ reports }: ReportViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
      <div className="divide-y divide-[#E5E5E5]">
        {reports.map((report) => {
          const isExpanded = expandedId === report.id;

          return (
            <div key={report.id}>
              <button
                onClick={() =>
                  setExpandedId(isExpanded ? null : report.id)
                }
                className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-[#F4F4F4] transition-colors"
              >
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A]">
                    {report.title}
                  </p>
                  {report.sent_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Sent {formatDate(report.sent_at)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={typeVariant(report.type)}>
                    {typeLabel[report.type] ?? report.type}
                  </Badge>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 border-t border-[#E5E5E5] bg-[#F4F4F4]">
                  {report.final_content ? (
                    <div className="pt-4">
                      <div
                        className="bg-white rounded-xl border border-[#E5E5E5] p-5 text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap"
                      >
                        {report.final_content}
                      </div>
                    </div>
                  ) : (
                    <div className="pt-4 text-sm text-gray-400">
                      Report content is not available.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
