"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function SetupForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-[#DC362E]">
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
      // Step 1: Create the account via our API
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

      // Step 2: Sign in with the credentials they just created
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

      // Step 3: Redirect to onboarding (new users never have a subscription yet)
      router.push("/portal/onboarding");
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-[#1A1A1A] mb-1">
          Full name
        </label>
        <input
          id="fullName"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent bg-white"
          placeholder="Your full name"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[#1A1A1A] mb-1">
          Create password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent bg-white"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#1A1A1A] mb-1">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E] focus:border-transparent bg-white"
          placeholder="Re-enter your password"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-[#DC362E]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-[#DC362E] text-white rounded-lg font-medium text-sm hover:bg-[#b52a23] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Setting up your account..." : "Create account"}
      </button>
    </form>
  );
}

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-[#F4F4F4] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#DC362E] flex items-center justify-center">
              <span className="text-white font-bold text-lg">GE</span>
            </div>
            <div className="text-left">
              <p className="text-xs text-gray-500 uppercase tracking-widest leading-none">
                Golden Era
              </p>
              <p className="font-bold text-[#1A1A1A] leading-none">SafeScore</p>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Set up your account</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create your password to access your safety dashboard
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-[#E5E5E5] p-8">
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
