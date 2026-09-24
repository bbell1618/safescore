"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STAFF_TEST_RECIPIENTS } from "@/lib/email/staff-test-policy";

export function StaffEmailTest({ dryRun }: { dryRun: boolean }) {
  const router = useRouter();
  const [to, setTo] = useState<string>(STAFF_TEST_RECIPIENTS[0]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function send() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/staff/email-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.mode === "dry_run" ? `Saved to outbox ${result.outboxId}. No email sent.` : `SMTP accepted message ${result.messageId}. Check the recipient inbox to confirm delivery.`);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="space-y-3 rounded border p-4" aria-labelledby="email-test-title">
    <h2 id="email-test-title" className="font-semibold">Internal email test</h2>
    <p>{dryRun ? "Dry-run mode: the fixed test email will be saved here. Nothing will be sent." : "SMTP mode: this sends one fixed test email to the selected internal inbox."}</p>
    <label className="block">Test recipient
      <select className="ml-2 max-w-full rounded border p-2" value={to} disabled={busy} onChange={event => setTo(event.target.value)}>
        {STAFF_TEST_RECIPIENTS.map(recipient => <option key={recipient} value={recipient}>{recipient}</option>)}
      </select>
    </label>
    <button type="button" className="rounded bg-[#1B2D4F] px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={send}>{busy ? "Working…" : "Send test email"}</button>
    {message && <p role="status" className="break-words">{message}</p>}
    {error && <p role="alert" className="break-words">{error}</p>}
  </section>;
}
