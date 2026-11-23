"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** QF-225 (Brandon, 11/23/2026): sign out lives on the Account page, not in the menu bar. */
export function SignOutCard({ email }: { email?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    const { error: signOutError } = await createClient().auth.signOut({ scope: "local" });
    if (signOutError) {
      setError(`Could not sign out: ${signOutError.message}`);
      setBusy(false);
      return;
    }
    window.location.replace("/login");
  }

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-xl border border-sand bg-warm-white p-5 shadow-sm">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-navy">Signed in</h2>
        {email ? <p className="mt-0.5 truncate text-sm text-warm-mid">{email}</p> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-error">{error}</p> : null}
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-sand bg-white px-4 text-sm font-semibold text-navy transition-colors duration-200 hover:border-navy/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </section>
  );
}
