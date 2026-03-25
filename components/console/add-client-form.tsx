"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AddClientFormProps {
  dot: string;
  mc: string;
  name: string;
  city: string;
  state: string;
  fleetSize: number;
  driverCount: number;
}

export function AddClientForm({ dot, mc, name, city, state, fleetSize, driverCount }: AddClientFormProps) {
  const [tier, setTier] = useState<"monitor" | "remediate" | "total_safety">("remediate");
  const [geiaClient, setGeiaClient] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Check if already exists
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("dot_number", dot)
      .single();

    if (existing) {
      router.push(`/console/clients/${existing.id}`);
      return;
    }

    const { data, error: insertErr } = await supabase
      .from("clients")
      .insert({
        dot_number: dot,
        mc_number: mc || null,
        name,
        city,
        state,
        fleet_size: fleetSize,
        driver_count: driverCount,
        tier,
        status: "prospect",
        geia_client: geiaClient,
      })
      .select()
      .single();

    if (insertErr) {
      setError(insertErr.message);
      setLoading(false);
      return;
    }

    router.push(`/console/clients/${data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Carrier name</label>
          <input
            type="text"
            defaultValue={name}
            disabled
            className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm bg-gray-50 text-gray-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Service tier</label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as typeof tier)}
            className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DC362E]"
          >
            <option value="monitor">Monitor — $199/mo</option>
            <option value="remediate">Remediate — $599/mo</option>
            <option value="total_safety">Total Safety — $999+/mo</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="geia-client"
          checked={geiaClient}
          onChange={(e) => setGeiaClient(e.target.checked)}
          className="rounded border-gray-300 text-[#DC362E] focus:ring-[#DC362E]"
        />
        <label htmlFor="geia-client" className="text-sm text-gray-700">
          This carrier is an existing GEIA insurance client (waives assessment fee)
        </label>
      </div>

      {error && (
        <p className="text-sm text-[#DC362E]">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="px-5 py-2.5 bg-[#DC362E] text-white rounded-lg text-sm font-medium hover:bg-[#b52a23] transition-colors disabled:opacity-50"
       
      >
        {loading ? "Adding client..." : "Add as SafeScore client"}
      </button>
    </form>
  );
}
