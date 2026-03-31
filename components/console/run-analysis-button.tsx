"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle } from "lucide-react";

interface RunAnalysisButtonProps {
  clientId: string;
  dotNumber: string;
  hasData?: boolean;
}

export function RunAnalysisButton({
  clientId,
  dotNumber,
  hasData,
}: RunAnalysisButtonProps) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRun() {
    setRunning(true);
    setError(null);
    setDone(false);
    setSummary(null);

    try {
      const res = await fetch("/api/analysis/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, dotNumber }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Analysis failed");
      } else {
        setSummary(
          `${data.violations} violations · ${data.crashes} crashes imported`
        );
        setDone(true);
        setTimeout(() => {
          router.refresh();
          setDone(false);
          setSummary(null);
        }, 2000);
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRun}
        disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1A1A1A] text-white rounded-lg hover:bg-black transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
        {running
          ? "Running analysis..."
          : hasData
          ? "Re-run analysis"
          : "Run full analysis"}
      </button>

      {done && summary && (
        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
          <CheckCircle className="w-3.5 h-3.5" />
          {summary}
        </span>
      )}

      {error && (
        <span className="text-xs text-[#DC362E] font-medium">{error}</span>
      )}
    </div>
  );
}
