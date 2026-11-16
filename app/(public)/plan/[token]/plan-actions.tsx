"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FILING_AUTHORIZATION_WORDING, SERVICE_AGREEMENT_AFTER_LINK, SERVICE_AGREEMENT_BEFORE_LINK, SERVICE_AGREEMENT_LINK_TEXT, TERMS_NOT_READY_MESSAGE } from "@/lib/legal/wording";
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
    primaryContactTitle: string | null;
    phone: string | null;
    email: string | null;
    driverCount: number | null;
    fleetSize: number | null;
    recommendedTier: string | null;
    detailsConfirmedAt: string | null;
    operatingRadius: string | null;
    operatingStates: string[];
    vehicleTypes: string[];
    fromClientFile: boolean;
  };
  groups: Array<{
    key: string;
    title: string;
    why: string;
    requests: Array<{ id: string; title: string; why: string | null; question: boolean; items: Array<{ key: string; label: string }> }>;
  }>;
  rosterUrl: string | null;
  rosterDriverCount: number;
  vehicleCount: number;
  eldConnected: boolean;
  /** False while the owner has not approved the terms (real carriers cannot sign yet). */
  termsReady: boolean;
};

const SUNNY = "sunnykapoor@goldenerainsurance.com";
const TIER_KEYS = PLAN_TIERS.map((t) => t.tier) as readonly string[];
const BASE_PRICE: Record<string, number> = { monitor: 199, remediate: 599, total_safety: 999 };
const PER_DRIVER = 29;

function monthly(tier: string, drivers: number | null): string {
  const base = BASE_PRICE[tier] ?? 0;
  if (tier !== "total_safety") return `$${base.toLocaleString("en-US")} / month`;
  if (!drivers) return `$${base} / month + $${PER_DRIVER} per driver`;
  return `$${(base + PER_DRIVER * drivers).toLocaleString("en-US")} / month ($${base} + ${drivers} drivers x $${PER_DRIVER})`;
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
  return data;
}

/**
 * QF-215: sign-up is four short steps in order (confirm details, choose service, sign, pay).
 * Everything else we need (driver list, ELD access, how they run, documents) is asked after they start.
 */
export function PlanActions(props: Props) {
  const c = props.client;
  const signed = Boolean(c.signedBy);
  const hasTier = Boolean(c.tier && TIER_KEYS.includes(c.tier));
  const suggested = c.recommendedTier && TIER_KEYS.includes(c.recommendedTier) ? c.recommendedTier : null;
  const [tier, setTier] = useState<string>(hasTier ? (c.tier as string) : suggested ?? "remediate");
  const [tierPicked, setTierPicked] = useState(hasTier);
  const [editDetails, setEditDetails] = useState(false);

  if (c.status === "active") {
    const operationDone = Boolean(c.operatingRadius);
    const tasks = [props.rosterDriverCount > 0, props.eldConnected, operationDone];
    const done = tasks.filter(Boolean).length;
    return (
      <section id="needs" className="space-y-4">
        <div className="rounded-2xl border border-success/40 bg-success-light p-6">
          <h2 className="font-heading text-2xl text-navy">You are set up. Thank you.</h2>
          <p className="mt-1 text-sm text-warm-mid">Your service has started. We are already watching your DOT record.</p>
        </div>
        <div className="px-1">
          <h2 className="font-heading text-2xl text-navy">What we need next</h2>
          <p className="mt-1 text-sm text-warm-mid">{done} of {tasks.length} done. Each one takes a few minutes. Your progress saves.</p>
        </div>
        <DriversCard token={props.token} rosterUrl={props.rosterUrl} count={props.rosterDriverCount} fromFile={c.fromClientFile} />
        <EldCard token={props.token} provider={c.eldProvider} connected={props.eldConnected} />
        <OperationCard token={props.token} client={c} />
        {props.groups.map((group) => <RequestGroupCard key={group.key} token={props.token} group={group} />)}
      </section>
    );
  }

  const detailsDone = Boolean(c.detailsConfirmedAt) && !editDetails;
  const stepsDone = [detailsDone, detailsDone && tierPicked, detailsDone && tierPicked && signed];
  const done = stepsDone.filter(Boolean).length;
  const current = done + 1;
  const tierName = PLAN_TIERS.find((t) => t.tier === tier)?.name ?? "your service";
  return (
    <section id="needs" className="space-y-4">
      <div className="px-1">
        <h2 className="font-heading text-2xl text-navy">Start in 4 short steps</h2>
        <p className="mt-1 text-sm text-warm-mid">{done} of 4 done. About 5 minutes in all. Your progress saves.</p>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((n) => <span key={n} className={`h-2 flex-1 rounded-full ${n <= done ? "bg-success" : n === current ? "bg-amber" : "bg-sand"}`} />)}
        </div>
      </div>

      {detailsDone ? (
        <Card step={1} title="Confirm your details" done>
          <p className="text-warm-mid">{c.primaryContact} · {c.phone} · {c.driverCount} driver{c.driverCount === 1 ? "" : "s"}{c.fleetSize ? ` · ${c.fleetSize} truck${c.fleetSize === 1 ? "" : "s"}` : ""}</p>
          <button type="button" onClick={() => setEditDetails(true)} className="text-sm font-semibold text-amber-dark underline">Change</button>
        </Card>
      ) : (
        <DetailsCard token={props.token} client={c} onSaved={() => setEditDetails(false)} />
      )}

      {current < 2 ? <Locked step={2} title="Choose your service" after={1} /> : stepsDone[1] ? (
        <Card step={2} title="Choose your service" done>
          <p className="text-warm-mid">{tierName} · {monthly(tier, c.driverCount)}</p>
          <button type="button" onClick={() => setTierPicked(false)} className="text-sm font-semibold text-amber-dark underline">Change</button>
        </Card>
      ) : (
        <ServiceCard tier={tier} setTier={setTier} suggested={suggested} drivers={c.driverCount} onPicked={() => setTierPicked(true)} />
      )}

      {current < 3 && !signed ? <Locked step={3} title="Sign so we can work for you" after={2} /> : (
        <SignCard token={props.token} signedBy={c.signedBy} signedAt={c.signedAt} defaultName={c.primaryContact} defaultTitle={c.primaryContactTitle} termsReady={props.termsReady} />
      )}

      {current < 4 ? <Locked step={4} title="Pay and start" after={3} /> : (
        <PayCard token={props.token} tier={tier} tierName={tierName} drivers={c.driverCount} />
      )}

      <article className="rounded-2xl border border-sand bg-cream p-6">
        <h3 className="font-heading text-xl text-navy">After you start</h3>
        <p className="mt-1 text-sm text-warm-mid">Nothing below is needed to sign up. We will ask for these once your service has started:</p>
        <ul className="mt-3 space-y-2 text-sm leading-6">
          <li>· Your driver list{props.rosterDriverCount > 0 ? ` (we already have ${props.rosterDriverCount} on file${c.fromClientFile ? " from your insurance file" : ""}, so you only check it)` : ""}</li>
          <li>· Read-only access to your ELD</li>
          <li>· A few questions about how you run: distance, states, truck types</li>
        </ul>
      </article>
      {props.groups.map((group) => <RequestGroupCard key={group.key} token={props.token} group={group} />)}
    </section>
  );
}

function Card({ title, done, step, children }: { title: string; done?: boolean; step?: number; children: React.ReactNode }) {
  return (
    <article className={`rounded-2xl border bg-warm-white p-6 shadow-sm ${done ? "border-success/40" : step ? "border-2 border-amber/40" : "border-sand"}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-success text-white" : step ? "bg-navy text-white" : "border-2 border-sand"}`}>{done ? "✓" : step ?? ""}</span>
        <h3 className="font-heading text-xl text-navy">{step ? <span className="sr-only">Step {step}: </span> : null}{title}</h3>
      </div>
      <div className="mt-3 space-y-3 text-base leading-7">{children}</div>
    </article>
  );
}

function Locked({ step, title, after }: { step: number; title: string; after: number }) {
  return (
    <article className="rounded-2xl border border-sand bg-warm-white/60 p-5 opacity-70">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-sand text-sm font-semibold text-warm-gray">{step}</span>
        <div>
          <h3 className="font-heading text-lg text-navy"><span className="sr-only">Step {step}: </span>{title}</h3>
          <p className="text-xs text-warm-gray">Opens after step {after}.</p>
        </div>
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm"><span className="mb-1 block text-warm-gray">{label}</span>{children}</label>;
}

const INPUT = "w-full rounded-lg border border-sand px-3 py-3 text-base";

function DetailsCard({ token, client, onSaved }: { token: string; client: Props["client"]; onSaved: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(client.primaryContact ?? "");
  const [title, setTitle] = useState(client.primaryContactTitle ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [drivers, setDrivers] = useState(client.driverCount ? String(client.driverCount) : "");
  const [trucks, setTrucks] = useState(client.fleetSize ? String(client.fleetSize) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card step={1} title="Confirm your details">
      <p className="text-warm-mid">We filled this in from your DOT record{client.fromClientFile ? " and your insurance file" : ""}. Fix anything that is wrong.</p>
      <p className="text-sm font-semibold text-navy">{client.name}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who should we talk to?"><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="name" /></Field>
        <Field label="Their title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Owner" className={INPUT} /></Field>
        <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" className={INPUT} /></Field>
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" className={INPUT} /></Field>
        <Field label="How many drivers?"><input value={drivers} onChange={(e) => setDrivers(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={INPUT} /></Field>
        <Field label="How many trucks?"><input value={trucks} onChange={(e) => setTrucks(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={INPUT} /></Field>
      </div>
      <ErrorText text={error} />
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await post(`/api/plan/${token}/profile`, { section: "details", contactName: name, contactTitle: title, phone, email, driverCount: Number(drivers), truckCount: trucks === "" ? null : Number(trucks) });
          onSaved(); router.refresh();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        setBusy(false);
      }}>{busy ? "Saving…" : "These are right"}</Button>
    </Card>
  );
}

function ServiceCard({ tier, setTier, suggested, drivers, onPicked }: { tier: string; setTier: (t: string) => void; suggested: string | null; drivers: number | null; onPicked: () => void }) {
  const name = PLAN_TIERS.find((t) => t.tier === tier)?.name ?? "this service";
  return (
    <Card step={2} title="Choose your service">
      <p className="text-warm-mid">You can change or cancel any time.</p>
      <div className="grid gap-3">
        {PLAN_TIERS.map((option) => (
          <label key={option.tier} className={`cursor-pointer rounded-xl border-2 p-4 ${tier === option.tier ? "border-amber bg-amber-subtle" : "border-sand"}`}>
            <input type="radio" name="tier" value={option.tier} checked={tier === option.tier} onChange={() => setTier(option.tier)} className="sr-only" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-heading text-lg text-navy">{option.name}{suggested === option.tier ? <span className="ml-2 rounded-full bg-navy px-2 py-0.5 align-middle font-sans text-xs font-semibold text-white">Suggested for you</span> : null}</span>
              <span className="font-mono text-sm text-amber-dark">{option.price}</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-warm-mid">{option.points.map((p) => <li key={p}>· {p}</li>)}</ul>
            {option.tier === "total_safety" && drivers ? <p className="mt-2 text-sm text-navy">For you: {monthly("total_safety", drivers)}</p> : null}
          </label>
        ))}
      </div>
      <Button onClick={onPicked}>Continue with {name}</Button>
    </Card>
  );
}

function PayCard({ token, tier, tierName, drivers }: { token: string; tier: string; tierName: string; drivers: number | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <article id="start" className="rounded-2xl border-2 border-amber/40 bg-warm-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">4</span>
        <h3 className="font-heading text-xl text-navy"><span className="sr-only">Step 4: </span>Pay and start</h3>
      </div>
      <div className="mt-3 space-y-3">
        <p className="text-base leading-7"><span className="font-semibold text-navy">{tierName}</span> · {monthly(tier, drivers)}</p>
        <ErrorText text={error} />
        <Button disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            const result = await post(`/api/plan/${token}/checkout`, { tier });
            window.location.href = String(result.url);
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
        }}>{busy ? "Opening secure checkout…" : "Continue to secure checkout"}</Button>
        <p className="text-xs text-warm-gray">Payment is handled by Stripe. We never see your card number. Your service starts as soon as you pay.</p>
      </div>
    </article>
  );
}

function OperationCard({ token, client }: { token: string; client: Props["client"] }) {
  const router = useRouter();
  const [radius, setRadius] = useState(client.operatingRadius ?? "");
  const [states, setStates] = useState<string[]>(client.operatingStates);
  const [vehicles, setVehicles] = useState<string[]>(client.vehicleTypes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  if (client.operatingRadius && !edit) {
    return (
      <Card title="Tell us how you run" done>
        <p className="text-warm-mid">{PLAN_RADIUS.find((r) => r.value === client.operatingRadius)?.label} · {client.operatingStates.join(", ")} · {client.vehicleTypes.join(", ")}</p>
        <button type="button" onClick={() => setEdit(true)} className="text-sm font-semibold text-amber-dark underline">Change</button>
      </Card>
    );
  }
  return (
    <Card title="Tell us how you run">
      <p className="text-warm-mid">Three quick questions so the weekly plan fits your trucks and routes.</p>
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
      <ErrorText text={error} />
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await post(`/api/plan/${token}/profile`, { section: "operation", operatingRadius: radius, operatingStates: states, vehicleTypes: vehicles });
          setEdit(false); router.refresh();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        setBusy(false);
      }}>{busy ? "Saving…" : "Save"}</Button>
    </Card>
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

function SignCard({ token, signedBy, signedAt, defaultName, defaultTitle, termsReady }: { token: string; signedBy: string | null; signedAt: string | null; defaultName: string | null; defaultTitle: string | null; termsReady: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName ?? "");
  const [title, setTitle] = useState(defaultTitle?.trim() || "Owner");
  const [agreeService, setAgreeService] = useState(false);
  const [agreeFiling, setAgreeFiling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (signedBy) {
    return <Card step={3} title="Sign so we can work for you" done><p className="text-warm-mid">Signed by {signedBy}{signedAt ? ` on ${new Date(signedAt).toLocaleDateString("en-US")}` : ""}. Thank you.</p></Card>;
  }
  if (!termsReady) {
    return <Card step={3} title="Sign so we can work for you"><p className="text-warm-mid">{TERMS_NOT_READY_MESSAGE}</p></Card>;
  }
  return (
    <Card step={3} title="Sign so we can work for you">
      <p className="text-warm-mid">This lets us look at your FMCSA record and ask FMCSA to fix mistakes for you.</p>
      <label className="flex gap-3 text-sm leading-6">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={agreeService} onChange={(e) => setAgreeService(e.target.checked)} />
        <span>{SERVICE_AGREEMENT_BEFORE_LINK}<Link href="/terms" target="_blank" className="text-amber-dark underline">{SERVICE_AGREEMENT_LINK_TEXT}</Link>{SERVICE_AGREEMENT_AFTER_LINK}</span>
      </label>
      <label className="flex gap-3 text-sm leading-6">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={agreeFiling} onChange={(e) => setAgreeFiling(e.target.checked)} />
        <span>{FILING_AUTHORIZATION_WORDING}</span>
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

function DriversCard({ token, rosterUrl, count, fromFile }: { token: string; rosterUrl: string | null; count: number; fromFile: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Send us your driver list" done={count > 0}>
      <p className="text-warm-mid">
        {count > 0 ? `We have ${count} driver${count === 1 ? "" : "s"} on file${fromFile ? " from your insurance file" : ""}. Check the list and add anyone who is missing.` : "Add each driver's name and license number. A phone photo of the license works. This lets us coach the right drivers."}
      </p>
      <ErrorText text={error} />
      <Button secondary={count > 0} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const url = rosterUrl ?? String((await post(`/api/plan/${token}/roster`, {})).url);
          window.location.href = url;
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
      }}>{busy ? "Opening…" : count > 0 ? "Check your driver list" : "Add your drivers"}</Button>
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
        <li>Add a new user with this email:<strong className="mt-0.5 block break-all">{SUNNY}</strong></li>
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
