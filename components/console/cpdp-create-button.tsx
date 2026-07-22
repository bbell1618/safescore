"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ServiceTierChip } from "@/components/console/service-tier-chip";
import type { ClientTier } from "@/lib/supabase/types";

interface Props {
  clientId: string;
  crashId: string;
  clientTier: ClientTier;
}

export function CpdpCreateButton({ clientId, crashId, clientTier }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cases/cpdp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, crashId }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to create case");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <ServiceTierChip tier={clientTier} feature="case_visibility" compact />
      <button
        onClick={handleCreate}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] transition-colors disabled:opacity-50"
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {loading ? "Creating..." : "Create CPDP submission"}
      </button>
      {error && <p className="text-[10px] text-[#C67A1E]">{error}</p>}
    </div>
  );
}
