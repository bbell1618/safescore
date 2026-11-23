"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { humanEnteredNameOrEmpty } from "@/lib/onboarding/validation";

interface TokenInfo {
  companyName: string | null;
  email: string;
  primaryContact: string | null;
  onboardingRequired: boolean;
}

function SetupForm() {
  const searchParams = useSearchParams();
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
      .then(async (response) => {
        const data = await response.json();
        if (response.status === 410 && data.error === "Invite already used") {
          // The account already exists: the same email button now just takes them to sign-in.
          window.location.replace("/login");
          return new Promise<TokenInfo>(() => undefined);
        }
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to validate the setup link");
        }
        return data as TokenInfo;
      })
      .then((data) => {
        setTokenInfo(data);
        setFullName(humanEnteredNameOrEmpty(data.primaryContact));
      })
      .catch((tokenError) =>
        setError(
          tokenError instanceof Error
            ? tokenError.message
            : "Unable to validate the setup link"
        )
      )
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

      window.location.replace(
        typeof data.nextPath === "string" ? data.nextPath : "/portal"
      );
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Company context */}
      {tokenInfo?.companyName && (
        <div className="rounded-lg border border-navy/10 bg-cream px-4 py-3 text-sm text-navy">
          Setting up the account for <strong>{tokenInfo.companyName}</strong>
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
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-amber px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Setting up your account..." : "Create account and go to step 2"}
      </button>
    </form>
  );
}

export default function SetupPage() {
  // QF-223: making the account is step 1 of the same 5-step sign-up the carrier finishes next,
  // so this page wears the same frame as the steps that follow it.
  return (
    <main className="portal-brand-root portal-warm-texture min-h-screen text-warm-dark">
      <header className="portal-navy-texture border-b border-gold/20 text-warm-white shadow-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold/35 bg-warm-white/5 font-heading text-sm font-bold text-gold-light">SS</span>
          <div className="min-w-0">
            <p className="font-heading text-base font-semibold">Golden Era SafeScore</p>
            <p className="truncate text-xs text-warm-white/70">Set up your account</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <section className="rounded-2xl border border-sand bg-warm-white p-6 shadow-sm">
          <h1 className="font-heading text-2xl text-navy">Set up SafeScore in 5 short steps</h1>
          <p className="mt-1 text-sm text-warm-mid">Step 1 of 5. About 5 minutes in all. Your progress saves.</p>
          <div className="mt-3 flex gap-1.5" aria-hidden>
            {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-2 flex-1 rounded-full ${n === 1 ? "bg-amber" : "bg-sand"}`} />)}
          </div>
        </section>

        <article className="rounded-2xl border-2 border-amber/40 bg-warm-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">1</span>
            <h2 className="font-heading text-xl text-navy"><span className="sr-only">Step 1: </span>Create your account</h2>
          </div>
          <p className="mt-3 text-base leading-7 text-warm-mid">Make a password. Your email and this password sign you back in any time: to upload documents, check your drivers and trucks, and see your reports.</p>
          <div className="mt-4">
            <Suspense fallback={<div className="text-sm text-warm-gray">Loading...</div>}>
              <SetupForm />
            </Suspense>
          </div>
        </article>

        {[
          [2, "Confirm your details"],
          [3, "Choose your service"],
          [4, "Sign so we can work for you"],
          [5, "Pay and start"],
        ].map(([n, title]) => (
          <article key={n} className="rounded-2xl border border-sand bg-warm-white/60 p-5 opacity-70">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-sand text-sm font-semibold text-warm-gray">{n}</span>
              <div>
                <h2 className="font-heading text-lg text-navy"><span className="sr-only">Step {n}: </span>{title}</h2>
                <p className="text-xs text-warm-gray">Opens after step {Number(n) - 1}.</p>
              </div>
            </div>
          </article>
        ))}

        <p className="px-1 pb-8 text-center text-xs leading-5 text-warm-gray">
          Golden Era Insurance Agency {"\u00b7"} 200 Brown Rd, Suite 203, Fremont, CA 94539 {"\u00b7"}{" "}
          <Link href="/terms" className="underline underline-offset-4">Terms of Service</Link>
        </p>
      </div>
    </main>
  );
}
