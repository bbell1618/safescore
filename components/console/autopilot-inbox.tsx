"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { InboxCard, InboxPayload } from "@/lib/autopilot/inbox-server";

function ago(value: string | null) {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
  superseded: "No longer needed",
};

export function AutopilotInbox({ initial }: { initial: InboxPayload }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [draft, setDraft] = useState({ subject: "", bodyText: "", toAddress: "", cc: "", note: "", value: "" });

  const pending = data.pending;
  const card: InboxCard | undefined = pending[Math.min(index, Math.max(0, pending.length - 1))];

  function startEdit() {
    if (!card) return;
    setDraft((d) => ({ ...d, subject: card.subject ?? "", bodyText: card.body_text ?? "", toAddress: card.to_address ?? "", cc: card.cc ?? "" }));
    setEditing(true);
    setRejecting(false);
  }

  async function reload() {
    const response = await fetch("/api/autopilot/inbox", { cache: "no-store" });
    if (response.ok) setData((await response.json()) as InboxPayload);
    router.refresh();
  }

  async function decide(action: "approve" | "reject" | "answer") {
    if (!card) return;
    setBusy(true);
    setMessage(null);
    const body: Record<string, unknown> = { action };
    if (action === "approve" && editing) Object.assign(body, { subject: draft.subject, bodyText: draft.bodyText, toAddress: draft.toAddress, cc: draft.cc });
    if (action === "reject") body.note = draft.note;
    if (action === "answer") body.value = draft.value;
    const response = await fetch(`/api/autopilot/inbox/${card.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; status?: string; dryRun?: boolean };
    setBusy(false);
    if (!response.ok) {
      setMessage({ tone: "error", text: result.error ?? "Something went wrong." });
      return;
    }
    setMessage({
      tone: result.status === "failed" ? "error" : "ok",
      text:
        action === "reject" ? "Rejected. Nothing was sent."
        : action === "answer" ? (result.status === "filed" ? "Recorded as filed. SafeScore now watches for FMCSA's decision." : "Saved. The next step was drafted for you.")
        : result.status === "failed" ? `Approved, but delivery failed: ${result.error ?? "unknown error"}`
        : result.dryRun ? "Approved. Live email is off, so it was recorded instead of delivered."
        : "Approved and sent.",
    });
    setEditing(false);
    setRejecting(false);
    setDraft({ subject: "", bodyText: "", toAddress: "", cc: "", note: "", value: "" });
    await reload();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="portal-navy-texture relative overflow-hidden rounded-2xl px-6 py-7 text-warm-white shadow-sm sm:px-8">
        <div className="relative z-10">
          <p className="font-mono text-xs uppercase tracking-widest text-gold-light">SafeScore Autopilot</p>
          <h1 className="mt-2 font-heading text-4xl">Inbox</h1>
          <p className="mt-2 max-w-2xl text-sm text-warm-white/85">
            Everything SafeScore wants to send to a carrier or the outside world waits here for you. Approve it, fix it, or reject it. Everything else runs on its own.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Stat value={pending.length} label="Waiting for you" />
            <Stat value={data.counts.carriers} label="Carriers" />
            <Stat value={data.counts.plansPublished} label="Plans sent" />
            <Stat value={data.counts.plansViewed} label="Plans opened" />
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Pill tone={data.liveEmail ? "ok" : "warn"}>
          {data.liveEmail ? "Live email is ON" : "Live email is OFF: approvals are recorded, not delivered"}
        </Pill>
        <Pill tone={data.goldenDeskConnected ? "ok" : "warn"}>
          {data.goldenDeskConnected ? "GoldenDesk contacts connected" : "GoldenDesk contacts not connected: using FMCSA census"}
        </Pill>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <AddCarrier onDone={reload} />
        <RunWeekly onDone={reload} />
      </div>

      {message && (
        <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${message.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
          {message.text}
        </p>
      )}

      {!card ? (
        <section className="rounded-xl border border-sand bg-warm-white p-8 text-center shadow-sm">
          <h2 className="font-heading text-2xl text-navy">Nothing needs you right now</h2>
          <p className="mt-2 text-sm text-warm-mid">Autopilot is running. New cards show up here when something is ready to go out.</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm" aria-live="polite">
          <header className="flex flex-wrap items-center gap-3 border-b border-sand bg-cream px-5 py-4">
            <span className="font-mono text-xs text-warm-gray">{Math.min(index, pending.length - 1) + 1} of {pending.length}</span>
            <h2 className="min-w-0 flex-1 font-heading text-xl text-navy">{card.title}</h2>
            {card.client_name && <span className="text-sm text-warm-mid">{card.client_name} · DOT {card.client_dot}</span>}
          </header>
          <div className="space-y-4 px-5 py-5">
            {card.why && <p className="rounded-lg bg-amber-subtle px-4 py-3 text-sm text-navy"><span className="font-semibold">Why: </span>{card.why}</p>}

            {card.kind === "needs_info" || card.kind === "filing_packet" ? (
              <div className="space-y-3">
                {card.body_text && <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border border-sand bg-cream p-4 text-sm leading-6">{card.body_text}</pre>}
                <label className="block text-sm font-medium text-navy" htmlFor="answer">
                  {card.kind === "filing_packet" ? "DataQs request number (after you file)" : "Contact email"}
                </label>
                <input id="answer" type={card.kind === "filing_packet" ? "text" : "email"} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-sm" placeholder={card.kind === "filing_packet" ? "e.g. 6123719" : "owner@company.com"} />
                {!rejecting && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => decide("answer")} disabled={busy || !draft.value.trim()} primary>
                      {card.kind === "filing_packet" ? "I filed it" : "Save and draft the email"}
                    </Button>
                    <Button onClick={() => setRejecting(true)} disabled={busy}>{card.kind === "filing_packet" ? "Don't file" : "Dismiss"}</Button>
                    {pending.length > 1 && <Button onClick={() => setIndex((i) => (i + 1) % pending.length)} disabled={busy}>Skip for now</Button>}
                  </div>
                )}
              </div>
            ) : (
              <>
                {(card.kind === "email" || card.kind === "report_send") && (
                  <dl className="grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                    <dt className="text-warm-gray">From</dt><dd>{card.from_identity === "sunny" ? "Sunny Kapoor (AI assistant) · sunnykapoor@" : card.from_identity}</dd>
                    <dt className="text-warm-gray">To</dt>
                    <dd>{editing ? <input className="w-full rounded border border-sand px-2 py-1" value={draft.toAddress} onChange={(e) => setDraft({ ...draft, toAddress: e.target.value })} /> : card.to_address}</dd>
                    <dt className="text-warm-gray">CC</dt>
                    <dd>{editing ? <input className="w-full rounded border border-sand px-2 py-1" value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} /> : card.cc || "None"}</dd>
                    <dt className="text-warm-gray">Subject</dt>
                    <dd>{editing ? <input className="w-full rounded border border-sand px-2 py-1" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /> : card.subject}</dd>
                  </dl>
                )}
                {editing ? (
                  card.editable ? (
                    <textarea value={draft.bodyText} onChange={(e) => setDraft({ ...draft, bodyText: e.target.value })}
                      rows={16} className="w-full rounded-lg border border-sand p-3 font-mono text-sm leading-6" />
                  ) : (
                    <p className="text-sm text-warm-mid">This is a fixed system message. You can change the recipients and subject, or reject it.</p>
                  )
                ) : card.body_html ? (
                  <iframe title="Email preview" srcDoc={card.body_html} sandbox="" className="h-[32rem] w-full rounded-lg border border-sand bg-white" />
                ) : card.body_text ? (
                  <pre className="whitespace-pre-wrap rounded-lg border border-sand bg-cream p-4 text-sm">{card.body_text}</pre>
                ) : null}
                {card.kind === "report_send" && typeof card.payload?.reportPreview === "string" && (
                  <details className="rounded-lg border border-sand p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-navy">Read the report</summary>
                    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{card.payload.reportPreview}</pre>
                  </details>
                )}
                {rejecting ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => decide("approve")} disabled={busy} primary>{editing ? "Save and approve" : "Approve"}</Button>
                    {!editing && <Button onClick={startEdit} disabled={busy}>Edit</Button>}
                    {editing && <Button onClick={() => setEditing(false)} disabled={busy}>Cancel edit</Button>}
                    <Button onClick={() => { setRejecting(true); setEditing(false); }} disabled={busy}>Reject</Button>
                    {pending.length > 1 && <Button onClick={() => { setIndex((i) => (i + 1) % pending.length); setEditing(false); }} disabled={busy}>Skip for now</Button>}
                  </div>
                )}
              </>
            )}
            {rejecting && (
              <div className="space-y-2 rounded-lg border border-sand p-4">
                <label className="block text-sm font-medium text-navy" htmlFor="note">Why? (optional, helps Autopilot learn)</label>
                <input id="note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="w-full rounded border border-sand px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <Button onClick={() => decide("reject")} disabled={busy} primary>Confirm reject</Button>
                  <Button onClick={() => setRejecting(false)} disabled={busy}>Back</Button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <RecentList cards={data.recent} />
    </div>
  );
}

function RecentList({ cards }: { cards: InboxCard[] }) {
  const rows = useMemo(() => cards.slice(0, 15), [cards]);
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm">
      <h2 className="font-heading text-xl text-navy">Recently decided</h2>
      <ul className="mt-3 divide-y divide-sand">
        {rows.map((card) => (
          <li key={card.id} className="flex flex-wrap items-baseline gap-2 py-3 text-sm">
            <span className="font-medium text-navy">{card.title}</span>
            {card.client_name && <span className="text-warm-mid">· {card.client_name}</span>}
            <span className="ml-auto font-mono text-xs text-warm-gray">
              {STATUS_LABEL[card.status] ?? card.status}
              {card.send_result && (card.send_result as { delivery?: { dryRun?: boolean } }).delivery?.dryRun ? " (recorded, live email off)" : ""}
              {" · "}{ago(card.decided_at)}
            </span>
            {card.error && <span className="basis-full text-xs text-red-700">{card.error}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddCarrier({ onDone }: { onDone: () => Promise<void> }) {
  const [dot, setDot] = useState("");
  const [email, setEmail] = useState("");
  const [geiaInsured, setGeiaInsured] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    const response = await fetch("/api/autopilot/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot, email: email || null, geiaInsured }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; steps?: string[] };
    setRunning(false);
    setResult(response.ok ? { ok: true, lines: body.steps ?? [] } : { ok: false, lines: [body.error ?? "Intake failed."] });
    if (response.ok) {
      setDot("");
      setEmail("");
      setGeiaInsured(false);
      await onDone();
    }
  }

  return (
    <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm">
      <h2 className="font-heading text-xl text-navy">Add a carrier</h2>
      <p className="mt-1 text-sm text-warm-mid">Just the DOT number. SafeScore finds the contact, pulls the record, writes the plan, and drafts the first email for you to approve.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (dot.trim()) void run(); }}>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-warm-gray">USDOT number</span>
          <input value={dot} onChange={(e) => setDot(e.target.value)} inputMode="numeric" className="w-44 rounded-lg border border-sand px-3 py-2" placeholder="2533650" disabled={running} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-warm-gray">Contact email (optional)</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-64 rounded-lg border border-sand px-3 py-2" placeholder="Found automatically if blank" disabled={running} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={geiaInsured} onChange={(e) => setGeiaInsured(e.target.checked)} disabled={running} className="h-4 w-4" />
          GEIA insured (CC Daven + info@)
        </label>
        <Button type="submit" disabled={running || !dot.trim()} primary>{running ? "Working… (about a minute)" : "Run"}</Button>
      </form>
      {result && (
        <ul className={`mt-4 space-y-1 rounded-lg border px-4 py-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
          {result.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </section>
  );
}

function RunWeekly({ onDone }: { onDone: () => Promise<void> }) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm">
      <h2 className="font-heading text-xl text-navy">Weekly check-ins</h2>
      <p className="mt-1 text-sm text-warm-mid">Runs by itself every Monday morning. Run it now to draft this week&apos;s carrier updates and Daven&apos;s summary.</p>
      <div className="mt-4">
        <Button disabled={running} onClick={async () => {
          setRunning(true);
          setNote(null);
          const response = await fetch("/api/autopilot/weekly", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const body = (await response.json().catch(() => ({}))) as { error?: string; weekly?: { cardsQueued: number; skipped: unknown[]; errors: Array<{ client: string; error: string }> } };
          setRunning(false);
          setNote(response.ok ? `${body.weekly?.cardsQueued ?? 0} card(s) drafted${body.weekly?.errors.length ? `, ${body.weekly.errors.length} error(s): ${body.weekly.errors.map((e) => `${e.client}: ${e.error}`).join("; ")}` : ""}.` : body.error ?? "Failed.");
          if (response.ok) await onDone();
        }}>{running ? "Drafting…" : "Run now"}</Button>
      </div>
      {note && <p className="mt-3 text-sm text-warm-mid">{note}</p>}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-gold/30 bg-amber/15 px-4 py-3">
      <span className="mr-3 font-mono text-2xl text-gold-light">{value}</span>
      <span className="text-xs text-warm-white/85">{label}</span>
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      {children}
    </span>
  );
}

function Button({ children, primary, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${primary ? "bg-amber text-white hover:bg-amber-dark" : "border border-sand bg-white text-navy hover:bg-cream"}`}
    >
      {children}
    </button>
  );
}
