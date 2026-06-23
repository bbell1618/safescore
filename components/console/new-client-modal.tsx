"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, UserPlus } from "lucide-react";
import {
  ClientIntakeFields,
  type ClientIntakeValues,
} from "@/components/console/client-intake-fields";

interface NewClientModalProps {
  onClose: () => void;
}

export function NewClientModal({ onClose }: NewClientModalProps) {
  const router = useRouter();

  const [values, setValues] = useState<ClientIntakeValues>({
    name: "",
    dotNumber: "",
    mcNumber: "",
    contactName: "",
    contactEmail: "",
    tier: "monitor",
    driverCount: "",
    geiaClient: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create client");
      } else {
        onClose();
        router.refresh();
      }
    } catch {
      setError("Network error \u2014 please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#FBF7F0] rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0E8DA]">
          <div>
            <h2 className="font-bold text-[#1E1C1A] text-base">Add new client</h2>
            <p className="text-xs text-gray-500 mt-0.5">Create a new SafeScore client record</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-[#1E1C1A] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 max-h-[80vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            <ClientIntakeFields
              idPrefix="new-client"
              values={values}
              onChange={setValues}
            />

            {error && (
              <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-3 py-2 text-sm text-[#B83B32]">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-[#F0E8DA] rounded-lg hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !values.name.trim() || !values.dotNumber.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {loading ? "Adding..." : "Add client"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
