"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Building2, UserPlus } from "lucide-react";

interface NewClientModalProps {
  onClose: () => void;
}

export function NewClientModal({ onClose }: NewClientModalProps) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [dotNumber, setDotNumber] = useState("");
  const [mcNumber, setMcNumber] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [tier, setTier] = useState("tier_1");
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
          name,
          dot_number: dotNumber,
          mc_number: mcNumber || undefined,
          contact_email: contactEmail || undefined,
          tier,
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
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <div>
            <h2
              className="font-bold text-[#1A1A1A] text-base"
             
            >
              Add new client
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Create a new SafeScore client record
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-[#1A1A1A] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Company Name */}
            <div>
              <label
                htmlFor="new-client-name"
                className="block text-sm font-medium text-[#1A1A1A] mb-1"
              >
                Company name <span className="text-[#DC362E]">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="new-client-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nationwide Carrier Inc"
                  className="w-full pl-9 pr-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
                />
              </div>
            </div>

            {/* DOT Number */}
            <div>
              <label
                htmlFor="new-client-dot"
                className="block text-sm font-medium text-[#1A1A1A] mb-1"
              >
                DOT number <span className="text-[#DC362E]">*</span>
              </label>
              <input
                id="new-client-dot"
                type="text"
                required
                value={dotNumber}
                onChange={(e) => setDotNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="2533650"
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
              />
            </div>

            {/* MC Number */}
            <div>
              <label
                htmlFor="new-client-mc"
                className="block text-sm font-medium text-[#1A1A1A] mb-1"
              >
                MC number{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="new-client-mc"
                type="text"
                value={mcNumber}
                onChange={(e) => setMcNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="880750"
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
              />
            </div>

            {/* Contact Email */}
            <div>
              <label
                htmlFor="new-client-email"
                className="block text-sm font-medium text-[#1A1A1A] mb-1"
              >
                Contact email{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="new-client-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@carrier.com"
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
              />
            </div>

            {/* Tier */}
            <div>
              <label
                htmlFor="new-client-tier"
                className="block text-sm font-medium text-[#1A1A1A] mb-1"
              >
                Service tier
              </label>
              <select
                id="new-client-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
              >
                <option value="tier_1">Tier 1</option>
                <option value="tier_2">Tier 2</option>
                <option value="tier_3">Tier 3</option>
              </select>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-[#DC362E]">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-[#E5E5E5] rounded-lg hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim() || !dotNumber.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#DC362E] text-white rounded-lg hover:bg-[#c42d26] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {loading ? "Adding…" : "Add client"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
