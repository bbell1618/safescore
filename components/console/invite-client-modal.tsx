"use client";

import { useState } from "react";
import { X, Mail, Send, CheckCircle, AlertTriangle, Copy } from "lucide-react";

interface InviteClientModalProps {
  clientId: string;
  clientName: string;
  contactEmail?: string;
  onClose: () => void;
}

export function InviteClientModal({
  clientId,
  clientName,
  contactEmail,
  onClose,
}: InviteClientModalProps) {
  const [email, setEmail] = useState(contactEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ emailSent: boolean; setupUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

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
        setResult({ emailSent: data.emailSent, setupUrl: data.setupUrl });
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!result?.setupUrl) return;
    navigator.clipboard.writeText(result.setupUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#FBF7F0] rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0E8DA]">
          <div>
            <h2 className="font-bold text-[#1E1C1A] text-base">Invite client to portal</h2>
            <p className="text-xs text-gray-500 mt-0.5">{clientName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1E1C1A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {result ? (
            <div className="space-y-4">
              {/* Status banner */}
              {result.emailSent ? (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">Invite sent to {email}</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="text-sm">
                    Invite created, but email could not be sent. Share the link below directly with the client.
                  </span>
                </div>
              )}

              {/* Always show copy link */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Invite link</p>
                <div className="bg-white border border-[#F0E8DA] rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <span className="text-xs text-gray-600 break-all flex-1 font-mono">
                    {result.setupUrl}
                  </span>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex items-center gap-1 text-xs font-medium text-[#C67A1E] shrink-0 hover:underline"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium bg-[#1B2D4F] text-white rounded-lg hover:bg-[#2A4270] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">
                Enter the email address of the contact at{" "}
                <span className="font-medium text-[#1E1C1A]">{clientName}</span>. They will receive
                a link to create their account and access the client portal.
              </p>

              <div>
                <label htmlFor="invite-email" className="block text-sm font-medium text-[#1E1C1A] mb-1">
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
                    className="w-full pl-9 pr-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent"
                  />
                </div>
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
                  disabled={loading || !email}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#C67A1E] text-white rounded-lg hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
