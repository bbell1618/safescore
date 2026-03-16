"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";

export function QuickAssessment() {
  const [dot, setDot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAssess(e: React.FormEvent) {
    e.preventDefault();
    const dotNum = dot.trim().replace(/\D/g, "");
    if (!dotNum) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/fmcsa/carrier/${dotNum}`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to fetch carrier data");
      }
      // Redirect to a pre-assessment page
      router.push(`/console/assess/${dotNum}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
      <h3
        className="font-semibold text-[#222222] text-sm mb-3"
        style={{ fontFamily: "var(--font-montserrat)" }}
      >
        Quick assessment
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Enter any DOT number to run an instant safety profile pull.
      </p>
      <form onSubmit={handleAssess} className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={dot}
            onChange={(e) => setDot(e.target.value)}
            placeholder="DOT number (e.g. 2533650)"
            className="flex-1 px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
          />
          <button
            type="submit"
            disabled={loading || !dot.trim()}
            className="px-3 py-2 bg-[#DC362E] text-white rounded-lg hover:bg-[#b52a23] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </button>
        </div>
        {error && (
          <p className="text-xs text-[#DC362E]">{error}</p>
        )}
      </form>
      <p className="text-[10px] text-gray-400 mt-2">
        Try DOT 2533650 — Nationwide Carrier (pilot client)
      </p>
    </div>
  );
}
