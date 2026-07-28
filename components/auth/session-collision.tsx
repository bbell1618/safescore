"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type SessionTarget = "console" | "portal";

export function SessionCollision({ target }: { target: SessionTarget }) {
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const supabase = createClient();
  const isConsoleTarget = target === "console";

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);

    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });
    if (signOutError) {
      setError(`Unable to sign out: ${signOutError.message}`);
      setSigningOut(false);
      return;
    }

    window.location.replace("/login");
  }

  return (
    <main className="min-h-screen bg-[#FEFCF8] px-4 py-16">
      <div className="mx-auto max-w-lg rounded-2xl border border-[#F0E8DA] bg-[#FBF7F0] p-8 shadow-sm">
        <ShieldAlert className="mb-5 h-10 w-10 text-[#C67A1E]" />
        <h1 className="text-2xl font-bold text-[#1E1C1A]">
          This account uses a different SafeScore area
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#5C554E]">
          {isConsoleTarget
            ? "Signed in as a portal user — sign out to access the console."
            : "Signed in as a staff user — sign out to access the client portal."}
        </p>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-[#B83B32]/20 bg-[#FAECEB] px-3 py-2 text-sm text-[#B83B32]"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C67A1E] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#B86E18] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <Link
            href={isConsoleTarget ? "/portal" : "/console"}
            className="inline-flex items-center justify-center rounded-lg border border-[#F0E8DA] px-4 py-2.5 text-sm font-medium text-[#5C554E] hover:bg-white"
          >
            Return to {isConsoleTarget ? "portal" : "console"}
          </Link>
        </div>
      </div>
    </main>
  );
}
