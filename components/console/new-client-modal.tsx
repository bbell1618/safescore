"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Building2, UserPlus, User } from "lucide-react";

interface NewClientModalProps {
  onClose: () => void;
}

export function NewClientModal({ onClose }: NewClientModalProps) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [dotNumber, setDotNumber] = useState("");
  const [mcNumber, setMcNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [tier, setTier] = useState("monitor");
  const [driverCount, setDriverCount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimatedMonthly =
    tier === "total_safety" && driverCount
      ? 999 + parseInt(driverCount, 10) * 29
      : null;

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
          contact_name: contactName || undefined,
          contact_email: contactEmail || undefined,
          driver_count: driverCount ? parseInt(driverCount, 10) : undefined,
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
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#FBF7F0] rounded-xl shadow-lg w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0E8DA]">
          <div>
            <h2 className="font-bold text-[#1E1C1A] text-base">Add new client</h2>
            <p className="text-xs text-gray-500 mt-0.5">Create a new SafeScore client record</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-[#1E1C1A] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[80vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Company Name */}
            <div>
              <label htmlFor="new-client-name" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                Company name <span className="text-[#C67A1E]">*</span>
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
                  className="w-full pl-9 pr-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
                />
              </div>
            </div>

            {/* DOT Number */}
            <div>
              <label htmlFor="new-client-dot" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                DOT number <span className="text-[#C67A1E]">*</span>
              </label>
              <input
                id="new-client-dot"
                type="text"
                required
                value={dotNumber}
                onChange={(e) => setDotNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="2533650"
                className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
              />
            </div>

            {/* MC Number */}
            <div>
              <label htmlFor="new-client-mc" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                MC number <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="new-client-mc"
                type="text"
                value={mcNumber}
                onChange={(e) => setMcNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="880750"
                className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
              />
            </div>

            {/* Contact Name */}
            <div>
              <label htmlFor="new-client-contact-name" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                Contact name <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="new-client-contact-name"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Mike Johnson"
                  className="w-full pl-9 pr-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
                />
              </div>
            </div>

            {/* Contact Email */}
            <div>
              <label htmlFor="new-client-email" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                Contact email <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="new-client-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@carrier.com"
                className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
              />
            </div>

            {/* Tier */}
            <div>
              <label htmlFor="new-client-tier" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                Service tier
              </label>
              <select
                id="new-client-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
              >
                <option value="monitor">Monitor ($199/mo)</option>
                <option value="remediate">Remediate ($599/mo)</option>
                <option value="total_safety">Total Safety ($999/mo + $29/driver/mo)</option>
              </select>
            </div>

            {/* Number of Drivers */}
            <div>
              <label htmlFor="new-client-drivers" className="block text-sm font-medium text-[#1E1C1A] mb-1">
                Number of drivers <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="new-client-drivers"
                type="number"
                min="0"
                value={driverCount}
                onChange={(e) => setDriverCount(e.target.value)}
                placeholder="e.g. 12"
                className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
              />
              {tier === "total_safety" && driverCount && (
                <p className="text-xs text-gray-500 mt-1">
                  Estimated monthly: $999 + ({driverCount} drivers × $29) ={" "}
                  <span className="font-semibold text-[#1E1C1A]">
                    ${estimatedMonthly?.toLocaleString()}/mo
                  </span>
                </p>
              )}
              {tier === "total_safety" && !driverCount && (
                <p className="text-xs text-gray-400 mt-1">
                  Enter driver count to see estimated monthly total.
                </p>
              )}
            </div>

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
                disabled={loading || !name.trim() || !dotNumber.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
