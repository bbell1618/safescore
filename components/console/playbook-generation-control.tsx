"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import type { ClientTier } from "@/lib/supabase/types";
import { minimumTierForFeature, TIER_LABELS } from "@/lib/tiers";

type GeneratePlaybookResponse = {
  playbookId?: string;
  version?: number;
  error?: string;
};

export function PlaybookGenerationControl({
  clientId,
  clientTier,
  hasPlaybook,
  allowed,
}: {
  clientId: string;
  clientTier: ClientTier;
  hasPlaybook: boolean;
  allowed: boolean;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!allowed) return;

    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/playbooks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | GeneratePlaybookResponse
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ??
            `Playbook generation failed with HTTP ${response.status}.`
        );
      }
      if (!payload?.playbookId || payload.version == null) {
        throw new Error(
          "Playbook generation did not return a saved version."
        );
      }

      router.push(
        `/console/clients/${clientId}/remediation/playbook?version=${payload.version}`
      );
      router.refresh();
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Playbook generation failed."
      );
    } finally {
      setGenerating(false);
    }
  }

  if (!allowed) {
    const minimumTier = minimumTierForFeature("playbook_coach");
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[#1E1C1A]">
            Playbook generation is locked
          </p>
          <ServiceTierChip tier={clientTier} feature="playbook_coach" />
        </div>
        <p className="mt-1 text-xs leading-5 text-gray-600">
          Family coaching programs are available from the{" "}
          {TIER_LABELS[minimumTier]} tier. No playbook data is loaded or
          generated for this client.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={generate}
        disabled={generating}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C67A1E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B86E18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C67A1E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : hasPlaybook ? (
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        )}
        {generating
          ? "Generating playbook..."
          : hasPlaybook
            ? "Regenerate playbook"
            : "Generate playbook"}
      </button>
      <p className="text-xs text-gray-500">
        {hasPlaybook
          ? "Regeneration creates a new immutable version from the current Lane C record."
          : "Build the owner curriculum, family programs, and 12-month installment plan from the current Lane C record."}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
