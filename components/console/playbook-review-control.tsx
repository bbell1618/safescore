"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlaybookReviewControl({ id, status }: { id: string; status: "draft" | "reviewed" | "published" | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = status === "draft" ? "review" : "publish";
  async function save() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/playbooks/${id}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Playbook action failed (${response.status})`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save playbook review");
    } finally { setBusy(false); }
  }
  return <div className="mt-4 space-y-2">
    <p className="text-sm font-semibold text-navy" role="status">
      {status === null ? "Published before review tracking" : status === "published" ? "Published to client" : status === "reviewed" ? "Reviewed — not yet visible to client" : "Draft — not visible to client"}
    </p>
    {(status === "draft" || status === "reviewed") && <>
      <p className="text-sm text-gray-600">{status === "draft" ? "Read the full playbook and check its facts before marking it reviewed." : "Publish this reviewed version to make it visible in the client's Plan. This does not send an email."}</p>
      <button type="button" disabled={busy} onClick={save} className="inline-flex min-h-11 items-center rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy">
        {busy ? "Saving…" : status === "draft" ? "Mark reviewed" : "Publish to client"}
      </button>
    </>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </div>;
}
