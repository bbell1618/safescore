"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface TokenInfo {
  companyName: string | null;
  email: string;
  primaryContact: string | null;
}

function SetupForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenLoading, setTokenLoading] = useState(Boolean(token));
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    fetch(`/api/auth/setup?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TokenInfo | null) => {
        if (data) {
          setTokenInfo(data);
          if (data.primaryContact) setFullName(data.primaryContact);
        }
      })
      .catch(() => {})
      .finally(() => setTokenLoading(false));
  }, [token]);

  if (!token) {
    return (
      <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-4 py-3 text-sm text-[#C67A1E]">
        Invalid setup link. Please contact your GEIA representative for a new invitation.
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, fullName }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create account");
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password,
      });

      if (signInError) {
        setError(
          "Account created but sign-in failed. Please go to the login page and sign in with your new password."
        );
        setLoading(false);
        return;
      }

      router.push("/portal/onboarding");
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Company context */}
      {tokenInfo?.companyName && (
        <div className="bg-[#E8ECF2] border border-[#1B2D4F]/10 rounded-lg px-4 py-3 text-sm text-[#2A4270]">
          Setting up account for <strong>{tokenInfo.companyName}</strong>
        </div>
      )}

      {/* Full name */}
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-[#1E1C1A] mb-1">
          Full name
        </label>
        <input
          id="fullName"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent bg-[#FEFCF8]"
          placeholder="Your full name"
          disabled={tokenLoading}
        />
      </div>

      {/* Email — read-only */}
      <div>
        <label className="block text-sm font-medium text-[#1E1C1A] mb-1">
          Email address
        </label>
        {tokenLoading ? (
          <div className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-[#F5F3F0] text-[#8B8178] animate-pulse h-9" />
        ) : (
          <input
            type="email"
            value={tokenInfo?.email ?? ""}
            readOnly
            className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm bg-[#F5F3F0] text-[#8B8178] cursor-not-allowed select-all"
            tabIndex={-1}
          />
        )}
        <p className="text-xs text-gray-400 mt-1">This is the email your invitation was sent to.</p>
      </div>

      {/* Password */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[#1E1C1A] mb-1">
          Create password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent bg-[#FEFCF8]"
          placeholder="At least 8 characters"
        />
      </div>

      {/* Confirm password */}
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#1E1C1A] mb-1">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent bg-[#FEFCF8]"
          placeholder="Re-enter your password"
        />
      </div>

      {error && (
        <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-3 py-2 text-sm text-[#B83B32]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || tokenLoading}
        className="w-full py-2.5 px-4 bg-[#C67A1E] text-white rounded-lg font-medium text-sm hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Setting up your account..." : "Create account"}
      </button>
    </form>
  );
}

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-[#FEFCF8] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#C67A1E] flex items-center justify-center">
              <span className="text-white font-bold text-lg">GE</span>
            </div>
            <div className="text-left">
              <p className="text-xs text-gray-500 uppercase tracking-widest leading-none">
                Golden Era
              </p>
              <p className="font-bold text-[#1E1C1A] leading-none">SafeScore</p>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#1E1C1A]">Set up your account</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create your password to access your safety dashboard
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#FBF7F0] rounded-xl shadow-sm border border-[#F0E8DA] p-8">
          <Suspense fallback={<div className="text-center text-sm text-gray-500">Loading...</div>}>
            <SetupForm />
          </Suspense>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Golden Era Insurance Agency — SafeScore Portal
        </p>
      </div>
    </div>
  );
}
