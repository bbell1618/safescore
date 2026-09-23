"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { defaultResponseDue, pacificDateOnly, responseClock, responseClockText, type AgencyRequest, type AgencyCaseKind } from "@/lib/cases/agency-request-clock";

export function AgencyWaitingStatus({ requests, filed }: { requests: AgencyRequest[]; filed: boolean }) {
  return requests.some(row => row.status === "open")
    ? <p className="mt-2 font-semibold text-error" role="status">Agency is waiting on us</p>
    : filed ? <p className="mt-2 text-sm text-warm-mid">Waiting on the agency</p> : null;
}

const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-sand bg-warm-white px-3 py-2 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-amber";

export function AgencyRequestsCard({ caseKind, caseId, requests, onChange }: {
  caseKind: AgencyCaseKind; caseId: string; requests: AgencyRequest[];
  onChange: (rows: AgencyRequest[]) => void;
}) {
  const router = useRouter();
  const [today] = useState(() => pacificDateOnly());
  const [logging, setLogging] = useState(false);
  const [requestedOn, setRequestedOn] = useState(today);
  const [due, setDue] = useState(() => defaultResponseDue(today));
  const [closing, setClosing] = useState<{ id: string; action: "responded" | "lapsed" } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>, requestId?: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const body = Object.fromEntries(form.entries());
      const response = await fetch(`/api/cases/${caseKind}/${caseId}/agency-requests${requestId ? `/${requestId}` : ""}`, {
        method: requestId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestId ? { ...body, action: closing!.action } : body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Agency request failed (HTTP ${response.status})`);
      const row = payload.request as AgencyRequest;
      onChange(requestId ? requests.map(value => value.id === row.id ? row : value) : [row, ...requests]);
      setLogging(false);
      setClosing(null);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  }

  return <section className="space-y-4 rounded-xl border border-sand bg-warm-white p-5" aria-label="Agency requests">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-heading text-xl text-navy">Agency requests</h2>
      <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => { setLogging(!logging); setClosing(null); setError(null); }}>Log agency request</button>
    </div>
    {error && <p role="alert" className="break-words text-sm text-error">{error}</p>}
    {logging && <form onSubmit={save} className="space-y-4 rounded-lg border border-sand bg-cream p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Requested on<input type="date" name="requested_on" required value={requestedOn} className={fieldClass} onChange={event => { setRequestedOn(event.target.value); if (event.target.value) setDue(defaultResponseDue(event.target.value)); }} /></label>
        <label className="text-sm">Respond by<input type="date" name="response_due" required min={requestedOn} value={due} onChange={event => setDue(event.target.value)} className={fieldClass} /></label>
      </div>
      <label className="block text-sm">Agency<input name="requesting_agency" required maxLength={500} className={fieldClass} /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">Contact name (optional)<input name="contact_name" className={fieldClass} /></label>
        <label className="text-sm">Contact phone (optional)<input name="contact_phone" type="tel" className={fieldClass} /></label>
        <label className="text-sm">Contact email (optional)<input name="contact_email" type="email" className={fieldClass} /></label>
      </div>
      <label className="block text-sm">What they asked for<textarea name="request_text" required rows={5} className={fieldClass} /></label>
      <div className="flex gap-3"><button className="btn-primary min-h-11" disabled={pending}>{pending ? "Saving…" : "Save agency request"}</button><button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => setLogging(false)}>Cancel</button></div>
    </form>}
    {requests.length === 0 && <p className="text-sm leading-6 text-warm-mid">No agency has asked for anything on this case. If DataQs or the agency emails asking for information, log it here — the case auto-closes in about two weeks if nobody answers.</p>}
    <ul className="space-y-4">{requests.map(row => {
      const clock = responseClock(row, today);
      return <li key={row.id} className="space-y-3 rounded-lg border border-sand p-4">
        <h3 className="font-semibold text-navy">{row.requesting_agency}</h3>
        <p className="whitespace-pre-wrap break-words text-sm text-warm-dark">{row.request_text}</p>
        <p className="break-words text-sm text-warm-mid">{[row.contact_name, row.contact_phone, row.contact_email].filter(Boolean).join(" · ")}</p>
        <p className="text-xs text-warm-mid">Requested on {row.requested_on}</p>
        <p className={`inline-block rounded-lg px-3 py-2 text-sm font-semibold ${row.status !== "open" ? "bg-cream text-warm-mid" : clock.state === "overdue" ? "bg-error-light text-error" : clock.state === "due_soon" ? "bg-amber-subtle text-amber-dark" : "bg-info-light text-info"}`}>
          {row.status === "open" ? responseClockText(row, today) : row.status === "responded" ? `Answered ${row.responded_on}` : "Lapsed — no response"}
        </p>
        {row.response_notes && <p className="whitespace-pre-wrap break-words text-sm text-warm-mid">{row.response_notes}</p>}
        {row.status === "open" && <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => { setClosing({ id: row.id, action: "responded" }); setLogging(false); }}>Mark answered</button>
          <button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => { setClosing({ id: row.id, action: "lapsed" }); setLogging(false); }}>Mark lapsed</button>
        </div>}
        {closing?.id === row.id && <form onSubmit={event => save(event, row.id)} className="space-y-3">
          {closing.action === "responded" && <label className="block text-sm">Answered on<input name="date" type="date" required defaultValue={today} className={fieldClass} /></label>}
          <label className="block text-sm">{closing.action === "responded" ? "What you sent" : "Why the request lapsed"}<textarea name="notes" required minLength={10} rows={3} className={fieldClass} /></label>
          <div className="flex gap-3"><button className="btn-primary min-h-11" disabled={pending}>{pending ? "Saving…" : closing.action === "responded" ? "Save answer" : "Save lapsed status"}</button><button type="button" className="btn-secondary min-h-11" disabled={pending} onClick={() => setClosing(null)}>Cancel</button></div>
        </form>}
      </li>;
    })}</ul>
  </section>;
}
