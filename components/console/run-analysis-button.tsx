"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface RunAnalysisButtonProps {
  clientId: string;
  dotNumber: string;
  hasData?: boolean;
  hasFmcsaAccess?: boolean;
}

const PROGRESS_STEPS = [
  "Pulling carrier profile...",
  "Checking violations...",
  "Importing crashes...",
  "Assessing challengeability...",
  "Finalizing...",
];

type MonitoringSnapshotResult =
  | {
      status: "inserted";
      snapshotDate: string;
      totalPoints: number;
      previousSnapshotDate: string | null;
    }
  | {
      status: "unchanged";
      snapshotDate: string;
      totalPoints: number;
      previousSnapshotDate: string;
    };

function analysisSummary(data: {
  violations?: number;
  crashes?: number;
  monitoringSnapshot?: MonitoringSnapshotResult;
}) {
  if (data.monitoringSnapshot?.status === "unchanged") {
    return `Re-analysis complete \u2014 no change since ${formatDate(data.monitoringSnapshot.previousSnapshotDate)}.`;
  }

  if (data.monitoringSnapshot?.status === "inserted") {
    return `Re-analysis complete \u2014 new monitoring snapshot captured for ${formatDate(data.monitoringSnapshot.snapshotDate)}.`;
  }

  return `${data.violations ?? 0} violations \u00B7 ${data.crashes ?? 0} crashes imported`;
}

export function RunAnalysisButton({
  clientId,
  dotNumber,
  hasData,
  hasFmcsaAccess,
}: RunAnalysisButtonProps) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  function startProgressAnimation() {
    setStepIndex(0);
    stepTimer.current = setInterval(() => {
      setStepIndex((i) => (i < PROGRESS_STEPS.length - 1 ? i + 1 : i));
    }, 1800);
  }

  function stopProgressAnimation() {
    if (stepTimer.current) {
      clearInterval(stepTimer.current);
      stepTimer.current = null;
    }
  }

  async function handleRun() {
    if (hasData) {
      const confirmed = window.confirm(
        "Re-run public analysis for this client? This refreshes the public FMCSA snapshot and imported safety data."
      );
      if (!confirmed) return;
    }

    setRunning(true);
    setError(null);
    setDone(false);
    setSummary(null);
    startProgressAnimation();

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
        setSummary(analysisSummary(data));
        setDone(true);
        setTimeout(() => {
          router.refresh();
          setDone(false);
          setSummary(null);
        }, 2500);
      }
    } catch {
      setError("Network error \u2014 try again");
    } finally {
      stopProgressAnimation();
      setRunning(false);
    }
  }

  const buttonLabel = hasFmcsaAccess
    ? hasData
      ? "Re-run analysis"
      : "Run full analysis"
    : hasData
    ? "Re-run public analysis"
    : "Run public analysis";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1B2D4F] text-white rounded-lg hover:bg-[#2A4270] transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
        {running ? PROGRESS_STEPS[stepIndex] : buttonLabel}
      </button>

      {done && summary && (
        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
          <CheckCircle className="w-3.5 h-3.5" />
          {summary}
        </span>
      )}

      {error && (
        <span className="text-xs text-[#C67A1E] font-medium">{error}</span>
      )}
    </div>
  );
}
