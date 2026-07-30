"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RequestUpload({ requestId, evidenceId }: { requestId: string; evidenceId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(file: File) {
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    if (evidenceId) form.set("evidenceId", evidenceId);
    try {
      const response = await fetch(`/api/portal/requests/${requestId}/upload`, { method: "POST", body: form });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Upload failed");
      setMessage("Received. GEIA will review this file.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <label className="btn-primary inline-flex cursor-pointer text-xs focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
        {busy ? "Uploading\u2026" : "Upload file"}
        <input className="sr-only" type="file" disabled={busy} accept=".pdf,.jpg,.jpeg,.png,.txt,.doc,.docx,.xls,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submit(file); }} />
      </label>
      {message && <p className="mt-1 text-xs text-warm-mid" role="status">{message}</p>}
    </div>
  );
}
