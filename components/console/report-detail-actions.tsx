"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CheckCircle2,
  Eye,
  Pencil,
  Printer,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { ReportContent } from "@/components/reports/report-content";
import type { ReportStatus } from "@/lib/supabase/types";

type ReportActionResponse = {
  error?: string;
  success?: boolean;
  clientEmail?: string | null;
  emailSent?: boolean;
  dryRun?: boolean;
  emailError?: string | null;
  report?: {
    id: string;
    status: ReportStatus;
    final_content?: string | null;
    reviewed_by?: string | null;
    reviewed_at?: string | null;
    sent_at?: string | null;
  };
};

async function responseBody(response: Response): Promise<ReportActionResponse> {
  return (await response.json().catch(() => ({}))) as ReportActionResponse;
}

export function ReportDetailActions({
  clientId,
  reportId,
  reportTitle,
  initialStatus,
  initialFinalContent,
  aiContent,
  printHref,
}: {
  clientId: string;
  reportId: string;
  reportTitle: string;
  initialStatus: ReportStatus;
  initialFinalContent: string | null;
  aiContent: string | null;
  printHref: string;
}) {
  const router = useRouter();
  const initialContent = initialFinalContent ?? aiContent ?? "";
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<
    "save" | "review" | "send" | "delete" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isDraft = status === "draft";
  const isReviewed = status === "reviewed";
  const hasUnsavedChanges = content !== savedContent;

  async function updateReport(action: "save" | "review") {
    if (!content.trim()) {
      setError("Report content cannot be empty.");
      return;
    }
    setPending(action);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          action,
          finalContent: content,
        }),
      });
      const payload = await responseBody(response);
      if (!response.ok || !payload.report) {
        throw new Error(
          payload.error ?? `Report update failed with HTTP ${response.status}`
        );
      }

      setSavedContent(payload.report.final_content ?? content);
      setContent(payload.report.final_content ?? content);
      setStatus(payload.report.status);
      setEditing(false);
      setMessage(
        action === "review"
          ? "Report marked reviewed. The original AI draft remains unchanged."
          : "Draft edits saved. The original AI draft remains unchanged."
      );
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update report"
      );
    } finally {
      setPending(null);
    }
  }

  async function deleteDraft() {
    if (
      !window.confirm(
        `Delete the draft report "${reportTitle}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setPending("delete");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/reports/${reportId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const payload = await responseBody(response);
      if (!response.ok) {
        throw new Error(
          payload.error ?? `Draft deletion failed with HTTP ${response.status}`
        );
      }
      router.push(`/console/clients/${clientId}/reports`);
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete report draft"
      );
      setPending(null);
    }
  }

  async function sendToClient() {
    setPending("send");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/reports/${reportId}/send`, {
        method: "POST",
      });
      const payload = await responseBody(response);
      if (!response.ok || !payload.success || !payload.report) {
        throw new Error(
          payload.error ?? `Report send failed with HTTP ${response.status}`
        );
      }

      setStatus(payload.report.status);
      if (payload.dryRun) {
        setMessage("Marked sent — email suppressed by dry-run gate");
      } else if (payload.emailSent) {
        setMessage("Report sent to the client and published in their portal.");
      } else {
        setMessage("Report marked sent and published in the client portal.");
        setError(
          payload.emailError ??
            "The client notification was not delivered. Check the client email and delivery configuration."
        );
      }
      router.refresh();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send report"
      );
    } finally {
      setPending(null);
    }
  }

  function cancelEditing() {
    setContent(savedContent);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7DDCE] bg-[#FBF7F0] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={printHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-xs font-medium text-[#4D463E] transition-colors hover:border-[#C67A1E] hover:text-[#9A5A14]"
          >
            <Printer className="h-3.5 w-3.5" />
            Print view
          </Link>
          {isDraft && !editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setError(null);
                setMessage(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CCBA] bg-white px-3 py-2 text-xs font-medium text-[#4D463E] transition-colors hover:border-[#C67A1E] hover:text-[#9A5A14]"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit final copy
            </button>
          )}
          {isDraft && editing && (
            <>
              <button
                type="button"
                onClick={() => updateReport("save")}
                disabled={pending !== null || !hasUnsavedChanges}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B2D4F] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2A4270] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {pending === "save" ? "Saving..." : "Save edits"}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={pending !== null}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </>
          )}
          {isDraft && !editing && (
            <button
              type="button"
              onClick={() => updateReport("review")}
              disabled={pending !== null || !content.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C67A1E] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#A86417] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {pending === "review" ? "Marking reviewed..." : "Mark reviewed"}
            </button>
          )}
          {isReviewed && (
            <button
              type="button"
              onClick={sendToClient}
              disabled={pending !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B2D4F] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2A4270] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {pending === "send" ? "Sending..." : "Send to client"}
            </button>
          )}
        </div>

        {isDraft && (
          <button
            type="button"
            onClick={deleteDraft}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[#A33A32] transition-colors hover:bg-[#FAECEB] disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {pending === "delete" ? "Deleting..." : "Delete draft"}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {message}
        </p>
      )}

      {editing ? (
        <section className="rounded-xl border border-[#E7DDCE] bg-white p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#1E1C1A]">
                Edit final client copy
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Markdown is supported. Saving changes only final_content; the AI
                draft remains intact.
              </p>
            </div>
            <Pencil className="h-4 w-4 text-gray-400" />
          </div>
          <label htmlFor="report-final-content" className="sr-only">
            Final report content
          </label>
          <textarea
            id="report-final-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={28}
            className="min-h-[32rem] w-full resize-y rounded-lg border border-[#D8CCBA] px-4 py-3 font-mono text-sm leading-6 text-[#292621] outline-none transition-shadow focus:border-[#C67A1E] focus:ring-2 focus:ring-[#C67A1E]/20"
          />
        </section>
      ) : (
        <section className="rounded-xl border border-[#E7DDCE] bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10">
          <div className="mb-6 flex items-center gap-2 border-b border-[#E7DDCE] pb-4 text-xs font-medium uppercase tracking-[0.12em] text-gray-500">
            <Eye className="h-4 w-4" />
            Client view
          </div>
          <ReportContent content={content} />
        </section>
      )}

      {aiContent && (
        <details className="rounded-xl border border-[#E7DDCE] bg-[#FBF7F0]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-[#4D463E]">
            Original AI draft
          </summary>
          <div className="border-t border-[#E7DDCE] bg-white px-6 py-7">
            <p className="mb-5 text-xs text-gray-500">
              Read-only source retained for comparison with the final client
              copy.
            </p>
            <ReportContent content={aiContent} />
          </div>
        </details>
      )}
    </div>
  );
}
