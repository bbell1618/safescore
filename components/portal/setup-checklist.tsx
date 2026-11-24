"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EldCard, ErrorText, INPUT, OperationCard, RequestRow, post } from "@/app/(public)/plan/[token]/plan-actions";
import { PLAN_RADIUS } from "@/lib/autopilot/plan-options";
import type { SetupChecklist as Data, SetupDriver, SetupRequest, SetupTruck } from "@/lib/autopilot/setup-checklist";
import { pendingPriceChange, setupItemStates } from "@/lib/autopilot/setup-items";
import type { PriceChange } from "@/lib/billing/driver-pricing-math";

/**
 * QF-221: the carrier's setup list ("Your setup list" since QF-223), first thing on their account home.
 *
 * Brandon (11/23/2026): the list must make it obvious what is left and when you are done, without
 * scrolling to find out. So: open items come first, finished items drop into a short Done list,
 * a bar at the bottom of the screen always shows the count and the next item, and when the last
 * item is finished the whole list is replaced by one "all done" panel that is scrolled into view.
 * Every item can be skipped: the rest of the account is open the whole time.
 */


type Item = { key: string; title: string; short: string; done: boolean; summary: string; canChange: boolean; optional?: boolean; body: React.ReactNode };

/** A label short enough for the strip: "Court paperwork · Dec 18, 2025", "Police report · May 1, 2026". */
function shortLabel(title: string): string {
  const dash = title.split(" — ");
  if (dash.length > 1) {
    const date = dash[dash.length - 1].split(", ").slice(-2).join(", ");
    const head = dash[0].replace(/ showing how the ticket ended$/i, "");
    return `${head} · ${date}`;
  }
  const crash = title.match(/^Police report for the crash on (.+?) in /i);
  if (crash) return `Police report · ${crash[1]}`;
  return title.length > 34 ? `${title.slice(0, 32).trimEnd()}…` : title;
}

/**
 * QF-225 (Brandon, 11/23/2026): the list took so much room the carrier would never know there is
 * a home page under it. Now it is one card: a horizontal strip of every item (tap any one), and
 * the one item you are on underneath. About a screen tall, so the rest of home shows below.
 * Finishing an item moves you to the next open one.
 */
export function SetupChecklist({ data, saved }: { data: Data; saved?: string | null }) {
  const token = data.planToken;
  // QF-223: done/not done comes from the same rules the email and its reminders use.
  const states = setupItemStates(data);
  const state = Object.fromEntries(states.map((x) => [x.key, x.done]));
  const title = Object.fromEntries(states.map((x) => [x.key, x.title]));
  const [editing, setEditing] = useState<string | null>(null);

  const driversDone = Boolean(state.drivers);
  const trucksDone = Boolean(state.trucks);
  const fmcsaSummary = data.fmcsa.method === "approved" ? "You approved our request"
    : data.fmcsa.method === "will_approve" ? "We will send our request for you to approve" : "";
  const price = pendingPriceChange(data);
  const items: Item[] = [
    ...(price ? [{
      key: "price", title: title.price ?? "Confirm your new price", short: "Confirm your price", done: false, canChange: false, summary: "",
      body: <PricePanel token={token} change={price} />,
    } satisfies Item] : []),
    {
      key: "drivers", title: "Check your driver list", short: "Drivers", done: driversDone, canChange: true,
      summary: `${data.drivers.list.length} driver${data.drivers.list.length === 1 ? "" : "s"} confirmed`,
      body: <DriversPanel drivers={data.drivers.list} fromFile={data.fromClientFile} done={driversDone} />,
    },
    {
      key: "trucks", title: "Check your truck list", short: "Trucks and trailers", done: trucksDone, canChange: true,
      summary: `${data.trucks.list.length} truck${data.trucks.list.length === 1 ? "" : "s"} and trailer${data.trucks.list.length === 1 ? "" : "s"} confirmed`,
      body: <TrucksPanel trucks={data.trucks.list} fromFile={data.fromClientFile} confirmed={trucksDone} />,
    },
    {
      key: "eld", title: "Give us access to your ELD", short: "ELD access", done: Boolean(state.eld), canChange: false,
      summary: data.eld.provider ?? "Done",
      body: <EldCard token={token} provider={data.eld.provider} connected={data.eld.connected} email={data.eldLoginEmail} />,
    },
    {
      key: "operation", title: "Tell us how you run", short: "How you run", done: Boolean(state.operation), canChange: true,
      summary: [PLAN_RADIUS.find((r) => r.value === data.operation.radius)?.label, data.operation.states.join(", ")].filter(Boolean).join(" · "),
      body: <OperationCard token={token} client={{ operatingRadius: editing === "operation" ? null : data.operation.radius, operatingStates: data.operation.states, vehicleTypes: data.operation.vehicleTypes }} />,
    },
    {
      key: "fmcsa", title: title.fmcsa ?? "Your FMCSA Portal login", short: "FMCSA login", done: Boolean(state.fmcsa), canChange: true,
      summary: fmcsaSummary,
      body: <FmcsaPanel token={token} method={data.fmcsa.method} requestSentAt={data.fmcsa.requestSentAt} title={title.fmcsa ?? "Your FMCSA Portal login"} onSaved={() => setEditing(null)} />,
    },
    {
      key: "safety", title: "Who handles safety day to day?", short: "Safety contact", done: Boolean(state.safety), canChange: true,
      summary: [data.safetyContact.name, data.safetyContact.phone].filter(Boolean).join(" · "),
      body: <SafetyContactPanel token={token} contact={data.safetyContact} onSaved={() => setEditing(null)} />,
    },
    ...data.requests.map((request): Item => ({
      key: `request:${request.id}`, title: request.title, short: shortLabel(request.title), done: Boolean(state[`request:${request.id}`]), canChange: false,
      summary: request.state === "skipped" ? "You said you do not have this" : "Received. Thank you.",
      body: <RequestPanel token={token} request={request} />,
    })),
    {
      key: "notes", title: "Anything else we should know?", short: "Anything else (optional)", done: Boolean(data.notes.text), canChange: true, optional: true,
      summary: data.notes.text ? "Your note is saved" : "",
      body: <NotesPanel token={token} text={data.notes.text} />,
    },
  ];

  const counted = items.filter((item) => !item.optional);
  const openItems = counted.filter((item) => !item.done);
  const doneCount = counted.length - openItems.length;
  const allDone = openItems.length === 0;

  const [selected, setSelected] = useState<string>(openItems[0]?.key ?? items[0].key);
  const [showList, setShowList] = useState(!allDone);
  const current = items.find((item) => item.key === selected) ?? items[0];
  const index = items.indexOf(current);

  // Finishing the item you are on moves you to the next open one (after it, then from the top).
  const doneKeys = items.filter((i) => i.done).map((i) => i.key).join("|");
  const [prevDoneKeys, setPrevDoneKeys] = useState(doneKeys);
  if (prevDoneKeys !== doneKeys) {
    // Adjusting state while rendering (React's pattern for "state follows new props").
    setPrevDoneKeys(doneKeys);
    const nowDone = items.find((i) => i.key === selected)?.done;
    const wasDone = prevDoneKeys.split("|").includes(selected);
    if (nowDone && !wasDone) {
      const after = items.slice(index + 1).find((i) => !i.done && !i.optional) ?? items.find((i) => !i.done && !i.optional);
      if (after) { setSelected(after.key); setEditing(null); }
    }
  }

  // Keep the chosen item visible in the strip without moving the page.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected)}"]`);
    if (!strip || !chip) return;
    const left = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [selected, showList]);

  function go(step: number) {
    const next = items[(index + step + items.length) % items.length];
    setSelected(next.key); setEditing(null);
  }

  // QF-227 (Brandon, 11/24/2026): once everything is done the list leaves the home page. It comes
  // back on its own when something new opens (a new ask from us, a price to confirm).
  if (allDone) return null;

  const savedName = saved === "drivers" ? "Driver list saved." : saved === "trucks" ? "Truck list saved." : null;
  const percent = Math.round((doneCount / counted.length) * 100);

  return (
    <section id="todo" className="scroll-mt-24 space-y-3" aria-label="Your setup list">
      <div className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-5">
          <h2 className="font-heading text-2xl font-bold text-navy">{allDone ? "Your setup list is done" : "Your setup list"}</h2>
          <p className="text-sm font-semibold text-navy" aria-live="polite">
            {allDone ? `All ${counted.length} done. Thank you.` : `${doneCount} of ${counted.length} done · ${openItems.length} left`}
          </p>
          {savedName && !allDone ? <p role="status" className="text-sm font-semibold text-success">{savedName}</p> : null}
          {allDone ? (
            <button type="button" onClick={() => setShowList((v) => !v)} className="ml-auto text-sm font-semibold text-navy underline decoration-amber decoration-2 underline-offset-4">
              {showList ? "Hide your answers" : "Review your answers"}
            </button>
          ) : null}
        </div>
        <div className="mx-5 mt-3 h-2 overflow-hidden rounded-full bg-sand" aria-hidden>
          <div className="h-full rounded-full bg-success transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
        {allDone && !showList ? (
          <p className="px-5 pb-5 pt-3 text-sm text-warm-mid">We have everything we asked for. Anything new we need will show up here, and we will email you.</p>
        ) : (
          <div className="relative mt-3 flex items-stretch border-t border-sand">
            <button type="button" onClick={() => go(-1)} aria-label="Previous item" className="hidden w-10 shrink-0 items-center justify-center border-r border-sand text-navy hover:bg-sand/50 sm:flex">‹</button>
            <div ref={stripRef} role="tablist" aria-label="Setup items" className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {items.map((item, i) => {
                const active = item.key === selected;
                return (
                  <button
                    key={item.key}
                    data-key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={item.title}
                    onClick={() => { setSelected(item.key); setEditing(null); }}
                    className={`flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors duration-200 ${
                      active ? "border-navy bg-navy text-white" : item.done ? "border-sand bg-white text-warm-mid hover:border-navy/30" : "border-sand bg-white text-navy hover:border-navy/40"
                    }`}
                  >
                    <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                      item.done ? "bg-success text-white" : active ? "bg-white text-navy" : "border border-navy/30 text-navy"
                    }`}>{item.done ? "✓" : item.optional ? "+" : i + 1}</span>
                    <span className="max-w-[15rem] truncate">{item.short}</span>
                    <span className="sr-only">{item.done ? " (done)" : item.optional ? " (optional)" : " (to do)"}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => go(1)} aria-label="Next item" className="hidden w-10 shrink-0 items-center justify-center border-l border-sand text-navy hover:bg-sand/50 sm:flex">›</button>
          </div>
        )}
      </div>

      {showList || !allDone ? (
        <div role="tabpanel" id={`todo-${current.key}`} aria-label={current.title} className="scroll-mt-24">
          {current.done && current.key !== "notes" && editing !== current.key ? (
            <article className="rounded-xl border border-success/40 bg-warm-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start gap-3">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-sm font-semibold text-white">✓</span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-heading text-xl text-navy">{current.title}</h3>
                  {current.summary ? <p className="mt-1 text-sm text-warm-mid">{current.summary}</p> : null}
                </div>
                {current.canChange ? (
                  <button type="button" onClick={() => setEditing(current.key)} className="min-h-11 rounded-lg border border-sand bg-white px-4 text-sm font-semibold text-navy hover:border-navy/40">Change</button>
                ) : null}
              </div>
            </article>
          ) : current.body}
          <div className="mt-2 flex items-center justify-between px-1">
            <button type="button" onClick={() => go(-1)} className="min-h-11 text-sm font-semibold text-navy">‹ Previous</button>
            {!allDone ? (
              <button type="button" onClick={() => { const nextOpen = items.slice(index + 1).find((i) => !i.done && !i.optional) ?? openItems.find((i) => i.key !== current.key) ?? items[(index + 1) % items.length]; setSelected(nextOpen.key); setEditing(null); }} className="min-h-11 text-sm font-semibold text-navy">
                {current.done ? "Next open item ›" : "Skip for now ›"}
              </button>
            ) : (
              <button type="button" onClick={() => go(1)} className="min-h-11 text-sm font-semibold text-navy">Next ›</button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Price (QF-227) ---------- */

function PricePanel({ token, change }: { token: string; change: PriceChange }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const up = change.difference > 0;
  return (
    <Card title={`Confirm ${change.to} drivers and your new price`}>
      <p className="text-warm-mid">Your driver list was updated. Total Safety is $999 a month plus $29 per driver, so your price changes once you confirm. Nothing changes on your bill until you do.</p>
      <PriceTable change={change} />
      <ErrorText text={error} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await post(`/api/plan/${token}/drivers/price`, { drivers: change.to }); router.refresh(); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          setBusy(false);
        }}>{busy ? "Saving…" : `Confirm ${change.to} drivers, $${change.toMonthly.toLocaleString()} a month`}</Button>
        <a href="/portal/fleet/drivers" className="min-h-11 px-2 py-3 text-sm font-semibold text-navy underline decoration-amber decoration-2 underline-offset-4">The list is wrong: fix it first</a>
      </div>
      <p className="text-xs text-warm-gray">{up ? "The difference is added to your next bill for the rest of this month." : "The difference comes off your next bill for the rest of this month."}</p>
    </Card>
  );
}

export function PriceTable({ change }: { change: PriceChange }) {
  const money = (n: number) => `$${n.toLocaleString()}`;
  return (
    <table className="w-full max-w-md text-sm">
      <thead><tr className="text-left text-warm-gray"><th className="py-1 font-semibold"></th><th className="py-1 font-semibold">Before</th><th className="py-1 font-semibold">Now</th></tr></thead>
      <tbody className="text-navy">
        <tr className="border-t border-sand"><td className="py-2">Drivers</td><td>{change.from}</td><td className="font-semibold">{change.to}</td></tr>
        <tr className="border-t border-sand"><td className="py-2">Monthly price</td><td>{money(change.fromMonthly)}</td><td className="font-semibold">{money(change.toMonthly)}</td></tr>
        <tr className="border-t border-sand"><td className="py-2">Difference</td><td></td><td className="font-semibold">{change.difference > 0 ? "+" : "−"}{money(Math.abs(change.difference))} a month</td></tr>
      </tbody>
    </table>
  );
}

/* ---------- Drivers and trucks: summaries that open the one-page lists (QF-223) ---------- */

export function DriversPanel({ drivers, fromFile, done }: { drivers: SetupDriver[]; fromFile: boolean; done: boolean }) {
  const unconfirmed = drivers.filter((d) => !d.confirmed).length;
  return (
    <Card title="Check your driver list" done={done}>
      <p className="text-warm-mid">
        {drivers.length === 0
          ? "Add everyone who drives under your DOT number. This lets us match inspections to the right driver and coach the right people."
          : done
          ? `You confirmed ${drivers.length} driver${drivers.length === 1 ? "" : "s"}. Open the list any time a driver joins or leaves.`
          : `We have ${drivers.length} driver${drivers.length === 1 ? "" : "s"} on file${fromFile ? " from your insurance file" : ""}. It is one page: fix anything wrong, untick anyone who left, add anyone missing, and confirm once.`}
      </p>
      <a href="/portal/fleet/drivers" className={`inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-base font-semibold sm:w-auto ${done ? "border border-sand bg-white text-navy" : "bg-amber text-white hover:bg-amber-dark"}`}>
        {drivers.length === 0 ? "Add your drivers" : done ? "Open your driver list" : `Check your ${unconfirmed || drivers.length} driver${(unconfirmed || drivers.length) === 1 ? "" : "s"}`}
      </a>
    </Card>
  );
}

export function TrucksPanel({ trucks, fromFile, confirmed }: { trucks: SetupTruck[]; fromFile: boolean; confirmed: boolean }) {
  const trailers = trucks.filter((t) => t.unitType === "trailer").length;
  const count = `${trucks.length - trailers} truck${trucks.length - trailers === 1 ? "" : "s"}${trailers ? ` and ${trailers} trailer${trailers === 1 ? "" : "s"}` : ""}`;
  return (
    <Card title="Check your truck list" done={confirmed}>
      <p className="text-warm-mid">
        {trucks.length === 0
          ? "Add every truck and trailer you run under your DOT number. Unit number, year and make are enough; the VIN helps us match inspections."
          : confirmed
          ? `You confirmed ${count}. Open the list any time one is added or sold.`
          : `We have ${count} on file${fromFile ? " from your insurance file" : ""}. Same one-page list: fix, untick, add, and confirm once.`}
      </p>
      <a href="/portal/fleet/trucks" className={`inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-base font-semibold sm:w-auto ${confirmed ? "border border-sand bg-white text-navy" : "bg-amber text-white hover:bg-amber-dark"}`}>
        {trucks.length === 0 ? "Add your trucks" : confirmed ? "Open your truck list" : "Check your truck list"}
      </a>
    </Card>
  );
}

/* ---------- FMCSA Portal ---------- */

/**
 * QF-225 (Brandon, 11/23/2026): every carrier needs a Portal login (FMCSA requires it), so "no"
 * leads straight to making one. "Yes" now says exactly what happens next, and once we have sent
 * our request the item comes back as "Approve our request".
 */
function FmcsaPanel({ token, method, requestSentAt, title, onSaved }: { token: string; method: string | null; requestSentAt: string | null; title: string; onSaved: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function answer(value: "will_approve" | "no_login" | "approved") {
    setBusy(true); setError(null);
    try { await post(`/api/plan/${token}/setup`, { section: "fmcsa", method: value }); onSaved(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  const noLogin = method === "no_login" || method === "need_help";
  const sent = requestSentAt ? new Date(requestSentAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" }) : null;

  if (method === "will_approve" && sent) {
    return (
      <Card title={title}>
        <p className="text-warm-mid">We sent our access request on {sent}. FMCSA emails it to your company official (usually the owner).</p>
        <ol className="list-decimal space-y-1 pl-6 text-sm leading-6">
          <li>Sign in at portal.fmcsa.dot.gov.</li>
          <li>Open the pending request from Golden Era Insurance Agency.</li>
          <li>Approve it. Then press the button below so we can pull your scores.</li>
        </ol>
        <ErrorText text={error} />
        <Button disabled={busy} onClick={() => answer("approved")}>{busy ? "Saving…" : "I approved it"}</Button>
      </Card>
    );
  }

  return (
    <Card title={title} done={method === "approved" || method === "will_approve"}>
      <p className="text-warm-mid">FMCSA requires every carrier to have an FMCSA Portal login, and its new registration system uses it. It is also where your real scores are kept and where wrong violations are challenged. You never give us your password.</p>
      {method === "will_approve" ? (
        <div className="rounded-lg bg-cream p-3 text-sm leading-6">
          <p className="font-semibold text-navy">Thank you. Here is what happens next:</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>Within one business day we send an access request for your DOT number from Golden Era&apos;s FMCSA account.</li>
            <li>FMCSA emails your company official, and this item comes back as &quot;Approve our request&quot;.</li>
            <li>Your company official signs in and approves it. That is all.</li>
          </ol>
        </div>
      ) : method === "approved" ? (
        <p className="text-sm text-success">You approved our request. Thank you.</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-navy">Does your company have an FMCSA Portal login?</p>
          {noLogin ? (
            <div className="rounded-lg border border-amber/40 bg-cream p-4 text-sm leading-6">
              <p className="font-semibold text-navy">Please make one now. We strongly encourage it: FMCSA requires it, and without it we cannot see your official scores or challenge violations on your record.</p>
              <p className="mt-2">It takes three steps for your company official (usually the owner):</p>
              <ol className="mt-1 list-decimal pl-5">
                <li>Request your USDOT PIN at safer.fmcsa.dot.gov. FMCSA sends it by email, text or mail.</li>
                <li>Make a free account at login.gov.</li>
                <li>Sign in at portal.fmcsa.dot.gov and register as the Company Official with the PIN.</li>
              </ol>
              <p className="mt-2 text-warm-mid">Stuck? Reply to any of our emails and we will walk you through it.</p>
            </div>
          ) : null}
        </>
      )}
      <ErrorText text={error} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {method !== "will_approve" && method !== "approved" ? (
          <>
            <Button disabled={busy} onClick={() => answer("will_approve")}>{noLogin ? "I made our login" : "Yes, we have one"}</Button>
            {!noLogin ? <Button secondary disabled={busy} onClick={() => answer("no_login")}>No, not yet</Button> : null}
          </>
        ) : (
          <Button secondary disabled={busy} onClick={() => answer("no_login")}>We do not have a login after all</Button>
        )}
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
    <Card title="Anything else we should know?">
      <p className="text-warm-mid">Optional. In your own words: what you think is hurting your score, a crash that was not your fault, an inspection you think was wrong, a driver who left.</p>
      <textarea value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} rows={4} className={INPUT} placeholder="Type here" />
      <ErrorText text={error} />
      <div className="flex items-center gap-3">
        <Button secondary disabled={busy || value === (text ?? "")} onClick={async () => {
          setBusy(true); setError(null);
          try { await post(`/api/plan/${token}/setup`, { section: "notes", text: value }); setSaved(true); router.refresh(); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          setBusy(false);
        }}>{busy ? "Saving…" : "Save note"}</Button>
        {saved ? <span role="status" className="text-sm text-success">Saved</span> : null}
      </div>
    </Card>
  );
}
