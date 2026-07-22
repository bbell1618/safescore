"use client";

import { useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const errorCode = searchParams.get("error_code");
  const errorParam = searchParams.get("error");
  const linkExpired = errorCode === "otp_expired" || errorParam === "access_denied";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const { data: userRecord, error: roleError } = await supabase
      .from("users")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (roleError || !userRecord) {
      await supabase.auth.signOut();
      setError(
        `Unable to verify your SafeScore role: ${roleError?.message ?? "profile not found"}`
      );
      setLoading(false);
      return;
    }

    router.push(userRecord.role === "client_user" ? "/portal" : "/console");
  }

  return (
    <>
      {linkExpired && (
        <div className="mb-4 bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-4 py-3 text-sm text-[#C67A1E]">
          Your sign-in link has expired or was already used. Please contact your GEIA representative to request a new invitation.
        </div>
      )}
      <div className="bg-[#FBF7F0] rounded-xl shadow-sm border border-[#F0E8DA] p-8">
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[#1E1C1A] mb-1"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent bg-[#FEFCF8]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#1E1C1A] mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-[#F0E8DA] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C67A1E] focus:border-transparent bg-[#FEFCF8]"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-3 py-2 text-sm text-[#B83B32]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-[#C67A1E] text-white rounded-lg font-medium text-sm hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#FEFCF8] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#C67A1E] flex items-center justify-center">
              <span className="text-white font-bold text-lg">
                GE
              </span>
            </div>
            <div className="text-left">
              <p className="text-xs text-gray-500 uppercase tracking-widest leading-none">
                Golden Era
              </p>
              <p className="font-bold text-[#1E1C1A] leading-none">
                SafeScore
              </p>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-[#1E1C1A]">Sign in</h1>
          <p className="text-sm text-gray-500 mt-1">
            CSA/DOT safety score improvement platform
          </p>
        </div>

        {/* Card */}
        <Suspense fallback={<div className="bg-[#FBF7F0] rounded-xl shadow-sm border border-[#F0E8DA] p-8" />}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-gray-400 mt-6">
          Golden Era Insurance Agency — Internal platform
        </p>
      </div>
    </div>
  );
}
