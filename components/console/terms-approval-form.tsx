"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TermsApprovalForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <label className="flex gap-3 text-base leading-7">
        <input type="checkbox" className="mt-1.5 h-5 w-5 shrink-0" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <span>I am Daven Loomba, owner of Golden Era Insurance Agency. I have read the terms and the two statements above, and I approve them for use with SafeScore customers.</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-warm-gray">Type your full name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daven Loomba" autoComplete="off"
          className="w-full max-w-sm rounded-lg border border-sand bg-white px-3 py-3 text-base" />
      </label>
      {error && <p role="alert" className="rounded-lg bg-error-light px-3 py-2 text-sm text-error">{error}</p>}
      <button type="button" disabled={busy || !confirm || name.trim().length < 3}
        className="min-h-12 rounded-xl bg-amber px-6 py-3 text-base font-semibold text-white hover:bg-amber-dark disabled:opacity-50"
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            const response = await fetch("/api/autopilot/terms-approval", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, confirm }),
            });
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) throw new Error(data.error ?? "Could not save the approval. Try again.");
            router.refresh();
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          setBusy(false);
        }}>
        {busy ? "Saving…" : "Approve"}
      </button>
      <p className="text-sm text-warm-mid">Not ready to approve? Close this page. Nothing changes, and no customer is asked to sign.</p>
    </div>
  );
}
