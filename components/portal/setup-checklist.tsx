"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EldCard, ErrorText, INPUT, OperationCard, RequestRow, post } from "@/app/(public)/plan/[token]/plan-actions";
import { PLAN_RADIUS } from "@/lib/autopilot/plan-options";
import type { SetupChecklist as Data, SetupDriver, SetupRequest, SetupTruck } from "@/lib/autopilot/setup-checklist";

/**
 * QF-221: the carrier's "What we still need from you" list, first thing on their account home.
 *
 * Brandon (11/23/2026): the list must make it obvious what is left and when you are done, without
 * scrolling to find out. So: open items come first, finished items drop into a short Done list,
 * a bar at the bottom of the screen always shows the count and the next item, and when the last
 * item is finished the whole list is replaced by one "all done" panel that is scrolled into view.
 * Every item can be skipped: the rest of the account is open the whole time.
 */


type Item = { key: string; title: string; done: boolean; summary: string; canChange: boolean; body: React.ReactNode };

export function SetupChecklist({ data }: { data: Data }) {
  const token = data.planToken;
  const [reopened, setReopened] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const driversDone = Boolean(data.drivers.submittedAt) || (data.drivers.list.length > 0 && data.drivers.list.every((d) => d.confirmed));
  const items: Item[] = [
    {
      key: "drivers", title: "Check your driver list", done: driversDone, canChange: true,
      summary: `${data.drivers.list.length} driver${data.drivers.list.length === 1 ? "" : "s"} confirmed`,
      body: <DriversPanel token={token} drivers={data.drivers.list} rosterUrl={data.drivers.rosterUrl} fromFile={data.fromClientFile} done={driversDone} />,
    },
    {
      key: "trucks", title: "Check your truck list", done: Boolean(data.trucks.confirmedAt), canChange: true,
      summary: `${data.trucks.list.length} truck${data.trucks.list.length === 1 ? "" : "s"} confirmed`,
      body: <TrucksPanel token={token} trucks={data.trucks.list} note={data.trucks.note} fromFile={data.fromClientFile} confirmed={Boolean(data.trucks.confirmedAt)} onSaved={() => setReopened(null)} />,
    },
    {
      key: "eld", title: "Give us access to your ELD", done: data.eld.connected, canChange: false,
      summary: data.eld.provider ?? "Done",
      body: <EldCard token={token} provider={data.eld.provider} connected={data.eld.connected} />,
    },
    {
      key: "operation", title: "Tell us how you run", done: Boolean(data.operation.radius), canChange: true,
      summary: [PLAN_RADIUS.find((r) => r.value === data.operation.radius)?.label, data.operation.states.join(", ")].filter(Boolean).join(" · "),
      body: <OperationCard token={token} client={{ operatingRadius: reopened === "operation" ? null : data.operation.radius, operatingStates: data.operation.states, vehicleTypes: data.operation.vehicleTypes }} />,
    },
    {
      key: "fmcsa", title: "Let us see your FMCSA account", done: Boolean(data.fmcsa.method), canChange: true,
      summary: data.fmcsa.method === "approved" ? "You approved our request" : data.fmcsa.method === "need_help" ? "We will email you to help" : "We will send the request for you to approve",
      body: <FmcsaPanel token={token} method={data.fmcsa.method} onSaved={() => setReopened(null)} />,
    },
    {
      key: "safety", title: "Who handles safety day to day?", done: Boolean(data.safetyContact.confirmedAt), canChange: true,
      summary: [data.safetyContact.name, data.safetyContact.phone].filter(Boolean).join(" · "),
      body: <SafetyContactPanel token={token} contact={data.safetyContact} onSaved={() => setReopened(null)} />,
    },
    ...data.requests.map((request): Item => ({
      key: `request:${request.id}`, title: request.title, done: request.state !== "open", canChange: false,
      summary: request.state === "skipped" ? "You said you do not have this" : "Received",
      body: <RequestPanel token={token} request={request} />,
    })),
  ];

  const open = items.filter((item) => !item.done);
  const finished = items.filter((item) => item.done);
  const allDone = open.length === 0;
  // Progress made since this page was opened: drives the "Saved" line without extra state.
  const [startCount] = useState(finished.length);
  const justSaved = finished.length > startCount && !allDone ? `Saved. ${open.length} left.` : null;
  const wasDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasDone.current) topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    wasDone.current = allDone;
  }, [allDone]);

  return (
    <section id="todo" ref={topRef} className="scroll-mt-24 space-y-4" aria-label="What we still need from you">
      {allDone ? (
        <div role="status" className="rounded-2xl border-2 border-success/50 bg-success-light p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-widest text-success">All {items.length} done</p>
          <h2 className="mt-1 font-heading text-3xl text-navy">You are all done. Thank you.</h2>
          <p className="mt-2 text-base leading-7 text-warm-mid">We have everything we asked for. Nothing else is needed from you right now. We will email you if that changes, and anything new will show up here.</p>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-amber/40 bg-warm-white p-6 shadow-sm">
          <p className="font-mono text-xs uppercase tracking-widest text-amber-dark">Your to-do list</p>
          <h2 className="mt-1 font-heading text-3xl text-navy">What we still need from you</h2>
          <p className="mt-2 text-base font-semibold text-navy" aria-live="polite">{finished.length} of {items.length} done · {open.length} left</p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-sand" aria-hidden>
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round((finished.length / items.length) * 100)}%` }} />
          </div>
          <p className="mt-3 text-sm leading-6 text-warm-mid">Do these in any order. Each one takes a few minutes and your progress saves. You can skip any of them and come back later: the rest of your account is open now.</p>
        </div>
      )}

      {justSaved && !allDone ? <p role="status" className="rounded-xl bg-success-light px-4 py-3 text-sm font-semibold text-success">{justSaved}</p> : null}

      {open.map((item) => <div key={item.key} id={`todo-${item.key}`} className="scroll-mt-24">{item.body}</div>)}

      {finished.length > 0 && (
        <div className="rounded-2xl border border-sand bg-warm-white p-5">
          <h3 className="font-heading text-lg text-navy">Done ({finished.length})</h3>
          <ul className="mt-2 divide-y divide-sand">
            {finished.map((item) => (
              <li key={item.key} className="py-3">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-white">✓</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-navy">{item.title}</p>
                    {item.summary ? <p className="text-sm text-warm-mid">{item.summary}</p> : null}
                  </div>
                  {item.canChange ? (
                    <button type="button" onClick={() => setReopened(reopened === item.key ? null : item.key)} className="text-sm font-semibold text-amber-dark underline">
                      {reopened === item.key ? "Close" : "Change"}
                    </button>
                  ) : null}
                </div>
                {reopened === item.key ? <div className="mt-3">{item.body}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <NotesPanel token={token} text={data.notes.text} />

      {!allDone && (
        <div className="sticky bottom-3 z-20 flex items-center gap-3 rounded-2xl border border-navy/10 bg-navy px-4 py-3 text-warm-white shadow-lg">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{finished.length} of {items.length} done.</span>{" "}
            <span className="text-warm-white/80">Next: {open[0].title}</span>
          </p>
          <a href={`#todo-${open[0].key}`} className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-white">Go</a>
        </div>
      )}
    </section>
  );
}

/* ---------- Drivers ---------- */

export function DriversPanel({ token, drivers, rosterUrl, fromFile, done }: { token: string; drivers: SetupDriver[]; rosterUrl: string | null; fromFile: boolean; done: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unconfirmed = drivers.filter((d) => !d.confirmed).length;
  return (
    <Card title="Check your driver list" done={done}>
      <p className="text-warm-mid">
        {drivers.length === 0
          ? "Add each driver's name and license number. A phone photo of the license works. This lets us match inspections to the right driver and coach the right people."
          : done
          ? `You confirmed ${drivers.length} driver${drivers.length === 1 ? "" : "s"}. Open the list any time a driver joins or leaves.`
          : `We have ${drivers.length} driver${drivers.length === 1 ? "" : "s"} on file${fromFile ? " from your insurance file" : ""}. Open the list, fix anything that is wrong, add license numbers and anyone who is missing, then press submit at the bottom.`}
      </p>
      {drivers.length > 0 && (
        <ul className="divide-y divide-sand rounded-lg border border-sand text-sm">
          {drivers.slice(0, 8).map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-warm-gray">{d.license ?? "No license number yet"}</span>
              <span className={d.confirmed ? "text-success" : "text-amber-dark"}>{d.confirmed ? "Confirmed ✓" : "Not checked"}</span>
            </li>
          ))}
          {drivers.length > 8 ? <li className="px-3 py-2 text-warm-gray">and {drivers.length - 8} more</li> : null}
        </ul>
      )}
      <ErrorText text={error} />
      <Button secondary={done} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const url = rosterUrl ?? String((await post(`/api/plan/${token}/roster`, {})).url);
          window.location.href = url;
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
      }}>{busy ? "Opening…" : drivers.length === 0 ? "Add your drivers" : done ? "Add or correct a driver" : `Check your ${unconfirmed || drivers.length} driver${(unconfirmed || drivers.length) === 1 ? "" : "s"}`}</Button>
    </Card>
  );
}

/* ---------- Trucks ---------- */

type NewTruck = { unit: string; year: string; make: string; vin: string; plate: string };
const EMPTY_TRUCK: NewTruck = { unit: "", year: "", make: "", vin: "", plate: "" };

export function TrucksPanel({ token, trucks, note, fromFile, confirmed, onSaved }: { token: string; trucks: SetupTruck[]; note: string | null; fromFile: boolean; confirmed: boolean; onSaved?: () => void }) {
  const router = useRouter();
  const [remove, setRemove] = useState<string[]>([]);
  const [added, setAdded] = useState<NewTruck[]>([]);
  const [draft, setDraft] = useState<NewTruck>(EMPTY_TRUCK);
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = trucks.filter((t) => !remove.includes(t.id)).length + added.length;
  const draftFilled = Boolean(draft.unit.trim() || draft.vin.trim() || draft.plate.trim());
  const set = (field: keyof NewTruck, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  return (
    <Card title="Check your truck list" done={confirmed && remove.length === 0 && added.length === 0}>
      <p className="text-warm-mid">
        {trucks.length === 0
          ? "Add each truck you run under this DOT number. Unit number, year and make are enough. The VIN helps us match inspections to the right truck."
          : `We have ${trucks.length} truck${trucks.length === 1 ? "" : "s"} on file${fromFile ? " from your insurance file" : ""}. Take off any you no longer run, add any that are missing, then press the button.`}
      </p>
      {trucks.length > 0 && (
        <ul className="divide-y divide-sand rounded-lg border border-sand text-sm">
          {trucks.map((t) => {
            const off = remove.includes(t.id);
            return (
              <li key={t.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${off ? "bg-cream text-warm-gray line-through" : ""}`}>
                <span className="font-semibold">{t.unit ? `Unit ${t.unit}` : "No unit number"}</span>
                <span className="min-w-0 flex-1">{[t.year, t.make, t.model].filter(Boolean).join(" ") || "Year and make not on file"}{t.vin ? ` · VIN …${t.vin.slice(-6)}` : ""}{t.plate ? ` · ${t.plateState ?? ""} ${t.plate}` : ""}</span>
                <button type="button" className="text-sm font-semibold text-amber-dark underline"
                  onClick={() => setRemove(off ? remove.filter((id) => id !== t.id) : [...remove, t.id])}>{off ? "Keep" : "We no longer run this"}</button>
              </li>
            );
          })}
        </ul>
      )}
      {added.length > 0 && (
        <ul className="divide-y divide-sand rounded-lg border border-success/40 text-sm">
          {added.map((t, i) => (
            <li key={`${t.unit}-${t.vin}-${i}`} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">New: {[t.unit && `Unit ${t.unit}`, t.year, t.make, t.vin && `VIN ${t.vin}`, t.plate].filter(Boolean).join(" · ")}</span>
              <button type="button" className="text-sm font-semibold text-amber-dark underline" onClick={() => setAdded(added.filter((_, n) => n !== i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="rounded-lg border border-sand p-3">
        <legend className="px-1 text-sm text-warm-gray">Add a truck</legend>
        <div className="grid gap-2 sm:grid-cols-5">
          <input aria-label="Unit number" placeholder="Unit #" value={draft.unit} onChange={(e) => set("unit", e.target.value)} className={INPUT} />
          <input aria-label="Year" placeholder="Year" inputMode="numeric" value={draft.year} onChange={(e) => set("year", e.target.value)} className={INPUT} />
          <input aria-label="Make" placeholder="Make" value={draft.make} onChange={(e) => set("make", e.target.value)} className={INPUT} />
          <input aria-label="VIN" placeholder="VIN" value={draft.vin} onChange={(e) => set("vin", e.target.value)} className={INPUT} />
          <input aria-label="Plate" placeholder="Plate" value={draft.plate} onChange={(e) => set("plate", e.target.value)} className={INPUT} />
        </div>
        <button type="button" disabled={!draftFilled} onClick={() => { setAdded([...added, draft]); setDraft(EMPTY_TRUCK); }}
          className="mt-2 min-h-11 rounded-lg border border-sand bg-white px-4 text-sm font-semibold text-navy disabled:opacity-50">Add this truck</button>
      </fieldset>
      <label className="block text-sm"><span className="mb-1 block text-warm-gray">Anything we should know about your trucks? (optional)</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: two trucks are leased from another company" className={INPUT} /></label>
      <ErrorText text={error} />
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await post(`/api/plan/${token}/trucks`, { remove, add: draftFilled ? [...added, draft] : added, note: text });
          setRemove([]); setAdded([]); setDraft(EMPTY_TRUCK); onSaved?.(); router.refresh();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        setBusy(false);
      }}>{busy ? "Saving…" : `This list is right (${kept + (draftFilled ? 1 : 0)} truck${kept + (draftFilled ? 1 : 0) === 1 ? "" : "s"})`}</Button>
    </Card>
  );
}

/* ---------- FMCSA Portal ---------- */

function FmcsaPanel({ token, method, onSaved }: { token: string; method: string | null; onSaved: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function answer(value: "will_approve" | "need_help" | "approved") {
    setBusy(true); setError(null);
    try { await post(`/api/plan/${token}/setup`, { section: "fmcsa", method: value }); onSaved(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <Card title="Let us see your FMCSA account" done={Boolean(method)}>
      <p className="text-warm-mid">Your public record shows only part of the picture. Your real scores, and the place where wrong violations are challenged, are inside your company&apos;s FMCSA Portal account. You never give us your password. This is how it works:</p>
      <ol className="list-decimal space-y-1 pl-6 text-sm leading-6">
        <li>We send an access request for your DOT number from our own FMCSA account.</li>
        <li>FMCSA emails your company official (usually the owner).</li>
        <li>The company official signs in to the FMCSA Portal and approves the request.</li>
      </ol>
      <p className="text-sm text-warm-mid">Does your company have an FMCSA Portal login?</p>
      <ErrorText text={error} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button disabled={busy} onClick={() => answer("will_approve")}>Yes. Send the request</Button>
        <Button secondary disabled={busy} onClick={() => answer("need_help")}>No, or I am not sure</Button>
        {method === "will_approve" ? <Button secondary disabled={busy} onClick={() => answer("approved")}>I approved your request</Button> : null}
      </div>
    </Card>
  );
}

/* ---------- Safety contact ---------- */

function SafetyContactPanel({ token, contact, onSaved }: { token: string; contact: Data["safetyContact"]; onSaved: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(values: { name: string; phone: string; email: string }) {
    setBusy(true); setError(null);
    try { await post(`/api/plan/${token}/setup`, { section: "safety_contact", ...values }); onSaved(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <Card title="Who handles safety day to day?" done={Boolean(contact.confirmedAt)}>
      <p className="text-warm-mid">The person we call about a driver, a truck or an inspection. Often the owner, a dispatcher or a safety manager.</p>
      {contact.ownerName && contact.ownerPhone && !contact.confirmedAt ? (
        <Button secondary disabled={busy} onClick={() => save({ name: contact.ownerName ?? "", phone: contact.ownerPhone ?? "", email: contact.ownerEmail ?? "" })}>
          It is {contact.ownerName} ({contact.ownerPhone})
        </Button>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm"><span className="mb-1 block text-warm-gray">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} /></label>
        <label className="text-sm"><span className="mb-1 block text-warm-gray">Phone</span><input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} className={INPUT} /></label>
        <label className="text-sm"><span className="mb-1 block text-warm-gray">Email (optional)</span><input value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} className={INPUT} /></label>
      </div>
      <ErrorText text={error} />
      <Button disabled={busy || !name.trim() || !phone.trim()} onClick={() => save({ name, phone, email })}>{busy ? "Saving…" : "Save"}</Button>
    </Card>
  );
}

/* ---------- Documents ---------- */

function RequestPanel({ token, request }: { token: string; request: SetupRequest }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={request.title} done={request.state !== "open"}>
      {request.why ? <p className="text-warm-mid">{request.why}</p> : null}
      {request.hint && !request.question ? <p className="text-sm text-warm-gray">{request.hint}</p> : null}
      {request.state === "open" ? (
        <>
          <RequestRow token={token} request={{ id: request.id, title: request.question ? request.title : "Upload the file", why: request.why, question: request.question, items: request.items }} />
          {!request.question && (
            <>
              <ErrorText text={error} />
              <button type="button" disabled={busy} className="text-sm font-semibold text-amber-dark underline disabled:opacity-50" onClick={async () => {
                setBusy(true); setError(null);
                try { await post(`/api/plan/${token}/requests/${request.id}/skip`, {}); router.refresh(); }
                catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                setBusy(false);
              }}>{busy ? "Saving…" : "I do not have this"}</button>
            </>
          )}
        </>
      ) : <p className="text-sm text-success">{request.state === "skipped" ? "You said you do not have this." : "Received. Thank you."}</p>}
    </Card>
  );
}

/* ---------- Notes (optional, never counted) ---------- */

function NotesPanel({ token, text }: { token: string; text: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(text ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <article className="rounded-2xl border border-sand bg-cream p-6">
      <h3 className="font-heading text-xl text-navy">Anything else we should know? <span className="text-sm font-normal text-warm-gray">(optional)</span></h3>
      <p className="mt-1 text-sm text-warm-mid">In your own words: what you think is hurting your score, a crash that was not your fault, an inspection you think was wrong, a driver who left.</p>
      <textarea value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} rows={4} className={`${INPUT} mt-3`} placeholder="Type here" />
      <ErrorText text={error} />
      <div className="mt-2 flex items-center gap-3">
        <Button secondary disabled={busy || value === (text ?? "")} onClick={async () => {
          setBusy(true); setError(null);
          try { await post(`/api/plan/${token}/setup`, { section: "notes", text: value }); setSaved(true); router.refresh(); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          setBusy(false);
        }}>{busy ? "Saving…" : "Save note"}</Button>
        {saved ? <span role="status" className="text-sm text-success">Saved ✓</span> : null}
      </div>
    </article>
  );
}

