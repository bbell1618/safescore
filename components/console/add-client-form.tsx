"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ClientIntakeFields,
  type ClientIntakeValues,
} from "@/components/console/client-intake-fields";

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
  const [values, setValues] = useState<ClientIntakeValues>({
    name,
    dotNumber: dot,
    mcNumber: mc,
    contactName: "",
    contactEmail: "",
    tier: "remediate",
    driverCount: driverCount ? String(driverCount) : "",
    geiaClient: false,
  });
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

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          dot_number: values.dotNumber,
          mc_number: values.mcNumber || undefined,
          contact_name: values.contactName || undefined,
          contact_email: values.contactEmail || undefined,
          driver_count: values.driverCount ? parseInt(values.driverCount, 10) : undefined,
          tier: values.tier,
          geia_client: values.geiaClient,
          status: "prospect",
          city,
          state,
          fleet_size: fleetSize,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error ?? "Failed to create client");
        setLoading(false);
        return;
      }

      router.push(`/console/clients/${result.client.id}`);
    } catch {
      setError("Network error \u2014 please try again");
      setLoading(false);
      return;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ClientIntakeFields
        idPrefix="assess-client"
        values={values}
        onChange={setValues}
        lockedFields={{ name: true, dotNumber: true }}
      />

      {error && (
        <p className="text-sm text-[#C67A1E]">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !values.name.trim() || !values.dotNumber.trim()}
        className="px-5 py-2.5 bg-[#C67A1E] text-white rounded-lg text-sm font-medium hover:bg-[#B86E18] transition-colors disabled:opacity-50"
      >
        {loading ? "Adding client..." : "Add as SafeScore client"}
      </button>
    </form>
  );
}
