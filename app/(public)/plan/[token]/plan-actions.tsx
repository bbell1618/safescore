"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLAN_RADIUS, PLAN_TIERS, PLAN_VEHICLE_TYPES, US_STATES } from "@/lib/autopilot/plan-options";

type Props = {
  token: string;
  client: {
    name: string;
    status: string;
    tier: string | null;
    signedBy: string | null;
    signedAt: string | null;
    eldProvider: string | null;
    primaryContact: string | null;
    phone: string | null;
    driverCount: number | null;
  };
  groups: Array<{
    key: string;
    title: string;
    why: string;
    requests: Array<{ id: string; title: string; why: string | null; question: boolean; items: Array<{ key: string; label: string }> }>;
  }>;
  rosterUrl: string | null;
  rosterDriverCount: number;
  eldConnected: boolean;
};

const SUNNY = "sunnykapoor@goldenerainsurance.com";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
  return data;
}

export function PlanActions(props: Props) {
  const signed = Boolean(props.client.signedBy);
  const steps = [signed, props.rosterDriverCount > 0, props.eldConnected];
  const done = steps.filter(Boolean).length;
  return (
    <section id="needs" className="space-y-4">
      <div className="px-1">
        <h2 className="font-heading text-2xl text-navy">What we need from you</h2>
        <p className="mt-1 text-sm text-warm-mid">{done} of {steps.length} done. Each one takes a few minutes. Your progress saves.</p>
      </div>
      <SignCard token={props.token} signedBy={props.client.signedBy} signedAt={props.client.signedAt} defaultName={props.client.primaryContact} />
      <DriversCard token={props.token} rosterUrl={props.rosterUrl} count={props.rosterDriverCount} />
      <EldCard token={props.token} provider={props.client.eldProvider} connected={props.eldConnected} />
      {props.groups.map((group) => <RequestGroupCard key={group.key} token={props.token} group={group} />)}
      {props.client.status !== "active" && <StartCard token={props.token} client={props.client} signed={signed} />}
    </section>
  );
}

function Card({ title, done, children }: { title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <article className={`rounded-2xl border bg-warm-white p-6 shadow-sm ${done ? "border-success/40" : "border-sand"}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${done ? "bg-success text-white" : "border-2 border-sand"}`}>{done ? "✓" : ""}</span>
        <h3 className="font-heading text-xl text-navy">{title}</h3>
      </div>
      <div className="mt-3 space-y-3 text-base leading-7">{children}</div>
    </article>
  );
}

function Button({ children, secondary, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return (
    <button type="button" {...props}
      className={`min-h-12 w-full rounded-xl px-5 py-3 text-base font-semibold disabled:opacity-50 sm:w-auto ${secondary ? "border border-sand bg-white text-navy" : "bg-amber text-white hover:bg-amber-dark"}`}>
      {children}
    </button>
  );
}

function ErrorText({ text }: { text: string | null }) {
  return text ? <p role="alert" className="rounded-lg bg-error-light px-3 py-2 text-sm text-error">{text}</p> : null;
}

function SignCard({ token, signedBy, signedAt, defaultName }: { token: string; signedBy: string | null; signedAt: string | null; defaultName: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName ?? "");
  const [title, setTitle] = useState("Owner");
  const [agreeService, setAgreeService] = useState(false);
  const [agreeFiling, setAgreeFiling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (signedBy) {
    return <Card title="Sign so we can work for you" done><p className="text-warm-mid">Signed by {signedBy}{signedAt ? ` on ${new Date(signedAt).toLocaleDateString("en-US")}` : ""}. Thank you.</p></Card>;
  }
  return (
    <Card title="Sign so we can work for you">
      <p className="text-warm-mid">This lets us look at your FMCSA record and ask FMCSA to fix mistakes for you.</p>
      <label className="flex gap-3 text-sm leading-6">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={agreeService} onChange={(e) => setAgreeService(e.target.checked)} />
        <span>I agree to the Golden Era Insurance Agency <Link href="/terms" target="_blank" className="text-amber-dark underline">terms of service</Link> and allow GEIA to provide SafeScore services to my company.</span>
      </label>
      <label className="flex gap-3 text-sm leading-6">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={agreeFiling} onChange={(e) => setAgreeFiling(e.target.checked)} />
        <span>I authorize Golden Era Insurance Agency to access my FMCSA data and to submit Requests for Data Review (DataQs) and Crash Preventability (CPDP) requests to FMCSA for my company. I understand FMCSA tells my company&apos;s officers about any request filed on our USDOT number.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block text-warm-gray">Your full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-sand px-3 py-3 text-base" autoComplete="name" /></label>
        <label className="text-sm"><span className="mb-1 block text-warm-gray">Your title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-sand px-3 py-3 text-base" /></label>
      </div>
      <ErrorText text={error} />
      <Button disabled={busy || !agreeService || !agreeFiling || name.trim().length < 3} onClick={async () => {
        setBusy(true); setError(null);
        try { await post(`/api/plan/${token}/sign`, { name, title, agreeService, agreeFiling }); router.refresh(); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        setBusy(false);
      }}>{busy ? "Saving…" : "Sign"}</Button>
    </Card>
  );
}

function DriversCard({ token, rosterUrl, count }: { token: string; rosterUrl: string | null; count: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Send us your driver list" done={count > 0}>
      <p className="text-warm-mid">
        {count > 0 ? `We have ${count} driver${count === 1 ? "" : "s"}. Add anyone who is missing.` : "Add each driver's name and license number. A phone photo of the license works. This lets us coach the right drivers."}
      </p>
      <ErrorText text={error} />
      <Button secondary={count > 0} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const url = rosterUrl ?? String((await post(`/api/plan/${token}/roster`, {})).url);
          window.location.href = url;
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
      }}>{busy ? "Opening…" : count > 0 ? "Add more drivers" : "Add your drivers"}</Button>
    </Card>
  );
}

function EldCard({ token, provider, connected }: { token: string; provider: string | null; connected: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(provider ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpSent, setHelpSent] = useState(false);
  if (connected) {
    return <Card title="Give us access to your ELD" done><p className="text-warm-mid">Done ({provider}). We will review your logs every week and tell you which drivers need help.</p></Card>;
  }
  async function submit(method: "added_user" | "need_help") {
    setBusy(true); setError(null);
    try { await post(`/api/plan/${token}/eld`, { provider: name, method }); if (method === "need_help") setHelpSent(true); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <Card title="Give us access to your ELD">
      <p className="text-warm-mid">Your electronic logs show the problems inspectors find: unassigned driving, speeding, missed inspections. We only look. We never change your logs.</p>
      <ol className="list-decimal space-y-1 pl-6 text-sm leading-6">
        <li>Log in to your ELD website as the admin.</li>
        <li>Add a new user with the email <strong className="break-all">{SUNNY}</strong>.</li>
        <li>Give it read-only or safety-manager access (not driver).</li>
      </ol>
      <label className="block text-sm"><span className="mb-1 block text-warm-gray">Which ELD do you use?</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Synergy, Motive, Samsara" className="w-full rounded-lg border border-sand px-3 py-3 text-base" /></label>
      <ErrorText text={error} />
      {helpSent ? <p className="rounded-lg bg-success-light px-3 py-2 text-sm text-success">Got it. We will email you to help.</p> : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button disabled={busy || !name.trim()} onClick={() => submit("added_user")}>I added the user</Button>
          <Button secondary disabled={busy || !name.trim()} onClick={() => submit("need_help")}>I need help</Button>
        </div>
      )}
    </Card>
  );
}

type RequestView = Props["groups"][number]["requests"][number];

function RequestGroupCard({ token, group }: { token: string; group: Props["groups"][number] }) {
  const many = group.requests.length > 1;
  return (
    <Card title={many ? `${group.title} (${group.requests.length})` : group.title}>
      <p className="text-warm-mid">{group.why}</p>
      {many ? (
        <details className="rounded-lg border border-sand">
          <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-navy">Show the {group.requests.length} items</summary>
          <div className="space-y-2 p-3 pt-0">{group.requests.map((r) => <RequestRow key={r.id} token={token} request={r} />)}</div>
        </details>
      ) : (
        <RequestRow token={token} request={group.requests[0]} />
      )}
    </Card>
  );
}

function RequestRow({ token, request }: { token: string; request: RequestView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  async function upload(file: File, itemKey?: string) {
    setBusy(itemKey ?? "file"); setError(null);
    const form = new FormData();
    form.append("file", file);
    if (itemKey) form.append("evidenceId", itemKey);
    const response = await fetch(`/api/plan/${token}/requests/${request.id}/upload`, { method: "POST", body: form });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setError(data.error ?? "Upload failed. You can also reply to our email with the file.");
    else { setSent((s) => [...s, itemKey ?? "file"]); router.refresh(); }
    setBusy(null);
  }
  async function answer(value: "yes" | "no") {
    setBusy(value); setError(null);
    try { await post(`/api/plan/${token}/requests/${request.id}/answer`, { answer: value }); setSent(["answered"]); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }
  if (request.question) {
    return (
      <div className="space-y-2">
        {sent.includes("answered") ? <p className="text-sm text-success">Thank you. Answer saved ✓</p> : (
          <div className="flex gap-2">
            <Button disabled={busy !== null} onClick={() => answer("yes")}>Yes</Button>
            <Button secondary disabled={busy !== null} onClick={() => answer("no")}>No</Button>
          </div>
        )}
        <ErrorText text={error} />
      </div>
    );
  }
  const targets = request.items.length ? request.items : [{ key: "", label: request.title }];
  return (
    <div className="space-y-2">
      {request.items.length > 0 && request.title && <p className="text-sm font-medium text-navy">{request.title}</p>}
      <ul className="space-y-2">
        {targets.map((item) => (
          <li key={item.key || "file"} className="flex flex-col gap-2 rounded-lg border border-sand p-3 sm:flex-row sm:items-center">
            <span className="flex-1 text-sm">{item.label}</span>
            {sent.includes(item.key || "file") ? <span className="text-sm text-success">Received ✓</span> : (
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-amber px-4 text-sm font-semibold text-white">
                {busy === (item.key || "file") ? "Uploading…" : "Upload or take photo"}
                <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy !== null}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, item.key || undefined); }} />
              </label>
            )}
          </li>
        ))}
      </ul>
      <ErrorText text={error} />
    </div>
  );
}

function StartCard({ token, client, signed }: { token: string; client: Props["client"]; signed: boolean }) {
  const [tier, setTier] = useState<string>(client.tier && client.tier !== "assessment" ? client.tier : "remediate");
  const [driverCount, setDriverCount] = useState(client.driverCount ? String(client.driverCount) : "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [radius, setRadius] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [ticket, setTicket] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  return (
    <article id="start" className="rounded-2xl border-2 border-amber/40 bg-warm-white p-6 shadow-sm">
      <h3 className="font-heading text-2xl text-navy">Start your service</h3>
      <p className="mt-1 text-sm text-warm-mid">Choose a plan. You can change or cancel any time.</p>
      {!signed && <p className="mt-3 rounded-lg bg-amber-subtle px-3 py-2 text-sm">Please sign above first.</p>}
      <div className="mt-4 grid gap-3">
        {PLAN_TIERS.map((option) => (
          <label key={option.tier} className={`cursor-pointer rounded-xl border-2 p-4 ${tier === option.tier ? "border-amber bg-amber-subtle" : "border-sand"}`}>
            <input type="radio" name="tier" value={option.tier} checked={tier === option.tier} onChange={() => setTier(option.tier)} className="sr-only" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-heading text-lg text-navy">{option.name}</span>
              <span className="font-mono text-sm text-amber-dark">{option.price}</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-warm-mid">{option.points.map((p) => <li key={p}>· {p}</li>)}</ul>
          </label>
        ))}
      </div>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm"><span className="mb-1 block text-warm-gray">How many drivers?</span>
            <input value={driverCount} onChange={(e) => setDriverCount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-full rounded-lg border border-sand px-3 py-3 text-base" /></label>
          <label className="text-sm"><span className="mb-1 block text-warm-gray">Your phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" className="w-full rounded-lg border border-sand px-3 py-3 text-base" /></label>
        </div>
        <fieldset><legend className="mb-2 text-sm text-warm-gray">How far do your trucks go?</legend>
          <div className="grid gap-2 sm:grid-cols-3">{PLAN_RADIUS.map((r) => (
            <button type="button" key={r.value} onClick={() => setRadius(r.value)} className={`min-h-12 rounded-lg border-2 px-3 text-sm ${radius === r.value ? "border-amber bg-amber-subtle" : "border-sand"}`}>{r.label}</button>
          ))}</div></fieldset>
        <fieldset><legend className="mb-2 text-sm text-warm-gray">Which states do you drive in?</legend>
          <div className="flex flex-wrap gap-1.5">{US_STATES.map((s) => (
            <button type="button" key={s} onClick={() => setStates(toggle(states, s))} className={`h-10 w-12 rounded-md border text-sm ${states.includes(s) ? "border-amber bg-amber text-white" : "border-sand bg-white"}`}>{s}</button>
          ))}</div></fieldset>
        <fieldset><legend className="mb-2 text-sm text-warm-gray">What kind of trucks?</legend>
          <div className="flex flex-wrap gap-2">{PLAN_VEHICLE_TYPES.map((v) => (
            <button type="button" key={v} onClick={() => setVehicles(toggle(vehicles, v))} className={`min-h-10 rounded-full border px-4 text-sm ${vehicles.includes(v) ? "border-amber bg-amber text-white" : "border-sand bg-white"}`}>{v}</button>
          ))}</div></fieldset>
        <fieldset><legend className="mb-2 text-sm text-warm-gray">In the last 2 years, did any driver fight a roadside ticket in court and win?</legend>
          <div className="flex gap-2">{[true, false].map((v) => (
            <button type="button" key={String(v)} onClick={() => setTicket(v)} className={`min-h-12 flex-1 rounded-lg border-2 text-sm sm:flex-none sm:px-8 ${ticket === v ? "border-amber bg-amber-subtle" : "border-sand"}`}>{v ? "Yes" : "No"}</button>
          ))}</div></fieldset>
      </div>
      <div className="mt-5 space-y-3">
        <ErrorText text={error} />
        <Button disabled={busy || !signed} onClick={async () => {
          setBusy(true); setError(null);
          try {
            const result = await post(`/api/plan/${token}/checkout`, {
              tier, driverCount: Number(driverCount), phone, operatingRadius: radius, operatingStates: states, vehicleTypes: vehicles, ticketAnswer: ticket,
            });
            window.location.href = String(result.url);
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
        }}>{busy ? "Opening secure checkout…" : "Continue to secure checkout"}</Button>
        <p className="text-xs text-warm-gray">Payment is handled by Stripe. We never see your card number.</p>
      </div>
    </article>
  );
}
