"use client";

import { useState } from "react";
import { X, Mail, Send, CheckCircle } from "lucide-react";

interface InviteClientModalProps {
  clientId: string;
  clientName: string;
  onClose: () => void;
}

export function InviteClientModal({
  clientId,
  clientName,
  onClose,
}: InviteClientModalProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/clients/${clientId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to send invite");
      } else {
        setSuccess(true);
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
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <div>
            <h2
              className="font-bold text-[#222222] text-base"
              style={{ fontFamily: "var(--font-montserrat)" }}
            >
              Invite client to portal
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{clientName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-[#222222] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="w-10 h-10 text-green-500" />
              <p className="font-medium text-[#222222]">Invite sent</p>
              <p className="text-sm text-gray-500">
                <span className="font-medium">{email}</span> will receive an email
                with a link to set up their portal account.
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 text-sm font-medium bg-[#222222] text-white rounded-lg hover:bg-black transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">
                Enter the email address of the contact at{" "}
                <span className="font-medium text-[#222222]">{clientName}</span>.
                They will receive a link to create their account and access the
                client portal.
              </p>

              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-sm font-medium text-[#222222] mb-1"
                >
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="invite-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@carrier.com"
                    className="w-full pl-9 pr-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent"
                  />
                </div>
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
                  disabled={loading || !email}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#DC362E] text-white rounded-lg hover:bg-[#b52a23] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  {loading ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
