"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, CheckCircle, Loader2 } from "lucide-react";

export function ChallengeabilityAnalysisButton({
  clientId,
  totalCount,
  unassessedCount,
}: {
  clientId: string;
  totalCount: number;
  unassessedCount: number;
}) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRun() {
    const force = unassessedCount === 0;
    if (force && !window.confirm("All violations are assessed. Re-run challengeability analysis for every violation?")) return;

    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      let cursor: string | undefined;
      let assessed = 0;
      let challengeable = 0;
      let requested = 0;
      let hasMore = true;
      while (hasMore) {
        const response = await fetch("/api/analysis/assess-violations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, force, cursor }),
        });
        const data = await response.json();
        assessed += data.assessed ?? 0;
        challengeable += data.challengeable ?? 0;
        requested += data.requested ?? 0;
        if (!response.ok) {
          const partial = assessed ? ` ${assessed} were saved successfully.` : "";
          throw new Error(`${data.error ?? "Challengeability analysis failed"}${partial}`);
        }
        hasMore = Boolean(data.hasMore);
        cursor = force ? data.nextCursor ?? undefined : undefined;
      }
      setMessage(
        requested === 0
          ? "Every violation is already assessed."
          : `Assessed ${assessed} violation${assessed === 1 ? "" : "s"}; ${challengeable} flagged for review.`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Challengeability analysis failed");
    } finally {
      setRunning(false);
    }
  }

  const workCount = unassessedCount > 0 ? unassessedCount : totalCount;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleRun}
        disabled={running || totalCount === 0}
        className="flex items-center gap-1.5 rounded-lg border border-[#C67A1E] bg-white px-3 py-1.5 text-xs font-medium text-[#9A5B14] transition-colors hover:bg-[#FDF4E7] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="h-3.5 w-3.5" />}
        {running
          ? `Assessing ${workCount} violation${workCount === 1 ? "" : "s"}...`
          : unassessedCount > 0
            ? `Run challengeability analysis (${unassessedCount})`
            : "Re-run challengeability analysis"}
      </button>
      {message && <span className="flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle className="h-3.5 w-3.5" />{message}</span>}
      {error && <span className="max-w-sm text-xs font-medium text-[#B83B32]">{error}</span>}
    </div>
  );
}
