"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export function PortalDownloadReportButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);

    try {
      // No body — server determines client_id from session
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        let message = "Failed to generate report";
        try {
          const json = await response.json();
          message = json?.error ?? message;
        } catch {
          // ignore parse error
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `safescore-report-${today}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleDownload}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-[#DC362E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#b82c26] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Download className="w-4 h-4" />
        {loading ? "Generating..." : "Download Safety Report"}
      </button>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
