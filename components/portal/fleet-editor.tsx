"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SetupDriver, SetupTruck } from "@/lib/autopilot/setup-checklist";
import { priceChange, type PriceChange } from "@/lib/billing/driver-pricing-math";

// QF-227: license state is picked from a list you can type into (code or name).
const STATES: Array<[string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"],
];
const STATE_CODES = new Set(STATES.map(([c]) => c));

/** "ca", "Calif", "California" -> "CA"; anything unknown stays as typed so the person sees it. */
function toStateCode(typed: string): string {
  const t = typed.trim();
  if (!t) return "";
  const up = t.toUpperCase();
  if (STATE_CODES.has(up)) return up;
  const lower = t.toLowerCase();
  const exact = STATES.find(([, n]) => n.toLowerCase() === lower);
  if (exact) return exact[0];
  const starts = STATES.filter(([, n]) => n.toLowerCase().startsWith(lower));
  return starts.length === 1 ? starts[0][0] : t;
}

/**
 * QF-223: the carrier's driver list and truck list on one page each.
 *
 * Brandon (11/23/2026): the old driver list was a long page where every driver had to be accepted
 * one at a time. Here the whole list sits in one compact table: fix what is wrong in place, untick
 * whoever is gone, add whoever is missing, and confirm the whole list with one button. The trucks
 * page works the same way. Saving also updates the agency's client file.
 */

const CELL = "h-9 w-full min-w-0 rounded-md border border-sand bg-white px-2 text-sm text-navy placeholder:text-warm-gray focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30 disabled:bg-transparent disabled:text-warm-gray";
const HEAD = "hidden px-1 text-xs font-semibold uppercase tracking-wide text-warm-gray sm:block";

class PriceNeeded extends Error { constructor(public change: PriceChange) { super("Please confirm your new monthly price."); } }

async function save(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; priceChange?: PriceChange; billingNote?: string | null };
  if (response.status === 409 && data.priceChange) throw new PriceNeeded(data.priceChange);
  if (!response.ok) throw new Error(data.error ?? "Could not save. Try again.");
  return data;
}

/** QF-227: the carrier agrees to the new monthly price before a different driver count is saved. */
function PriceDialog({ change, busy, onAgree, onCancel }: { change: PriceChange; busy: boolean; onAgree: () => void; onCancel: () => void }) {
  const money = (n: number) => `$${n.toLocaleString()}`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0F1B2D]/50 p-4" role="presentation" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="price-title" className="w-full max-w-md rounded-2xl bg-warm-white p-6 shadow-xl">
        <h2 id="price-title" className="font-heading text-xl text-navy">Your monthly price changes</h2>
        <p className="mt-2 text-sm text-warm-mid">Total Safety is $999 a month plus $29 per driver. Your list now has {change.to} driver{change.to === 1 ? "" : "s"} instead of {change.from}.</p>
        <table className="mt-4 w-full text-sm">
          <thead><tr className="text-left text-warm-gray"><th className="py-1 font-semibold"></th><th className="py-1 font-semibold">Before</th><th className="py-1 font-semibold">Now</th></tr></thead>
          <tbody className="text-navy">
            <tr className="border-t border-sand"><td className="py-2">Drivers</td><td>{change.from}</td><td className="font-semibold">{change.to}</td></tr>
            <tr className="border-t border-sand"><td className="py-2">Monthly price</td><td>{money(change.fromMonthly)}</td><td className="font-semibold">{money(change.toMonthly)}</td></tr>
            <tr className="border-t border-sand"><td className="py-2">Difference</td><td></td><td className="font-semibold">{change.difference > 0 ? "+" : "−"}{money(Math.abs(change.difference))} a month</td></tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-warm-gray">{change.difference > 0 ? "The difference for the rest of this month is added to your next bill." : "The difference for the rest of this month comes off your next bill."}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-sand bg-white px-4 text-sm font-semibold text-navy hover:border-navy/40">Go back to my list</button>
          <button type="button" autoFocus onClick={onAgree} disabled={busy} className="min-h-11 rounded-lg bg-amber px-4 text-sm font-semibold text-white hover:bg-amber-dark disabled:opacity-60">{busy ? "Saving…" : `Agree: ${money(change.toMonthly)} a month`}</button>
        </div>
      </div>
    </div>
  );
}

function Shell(props: {
  title: string; intro: string; count: number; search: string; setSearch: (v: string) => void; showSearch: boolean;
  head: React.ReactNode; children: React.ReactNode; onAdd: () => void; addLabel: string;
  summary: string; button: string; busy: boolean; error: string | null; onSave: () => void; extra?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-sand bg-warm-white shadow-sm">
      <div className="border-b border-sand p-5">
        <h1 className="font-heading text-2xl text-navy">{props.title}</h1>
        <p className="mt-1 text-sm leading-6 text-warm-mid">{props.intro}</p>
        {props.showSearch ? (
          <input type="search" value={props.search} onChange={(e) => props.setSearch(e.target.value)} placeholder="Find by name or number" aria-label="Find on this list" className={`${CELL} mt-3 max-w-xs`} />
        ) : null}
      </div>
      <div className="relative max-h-[62vh] overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-sand bg-cream/95 px-3 py-2 backdrop-blur">{props.head}</div>
        <div className="divide-y divide-sand">{props.children}</div>
      </div>
      <div className="border-t border-sand px-3 py-2">
        <button type="button" onClick={props.onAdd} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-amber-dark hover:bg-amber/10">+ {props.addLabel}</button>
      </div>
      {props.extra}
      <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-2xl border-t border-sand bg-warm-white p-4 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm text-warm-mid" aria-live="polite">{props.summary}</p>
        {props.error ? <p role="alert" className="text-sm font-semibold text-red-700">{props.error}</p> : null}
        <button type="button" disabled={props.busy} onClick={props.onSave} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-amber px-5 text-base font-semibold text-white hover:bg-amber-dark disabled:opacity-60">
          {props.busy ? "Saving…" : props.button}
        </button>
      </div>
    </section>
  );
}

/* ---------------- Drivers ---------------- */

type DriverRow = { key: string; id: string | null; active: boolean; name: string; state: string; license: string; licenseHint: string | null; licenseExpiry: string; medicalExpiry: string; dirty: boolean };

const DRIVER_COLS = "grid grid-cols-[2rem_1fr] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[2rem_minmax(10rem,1.6fr)_5.5rem_minmax(8rem,1fr)_9.5rem_9.5rem]";

export function DriverListEditor({ token, drivers, fromFile, billing }: { token: string; drivers: SetupDriver[]; fromFile: boolean; billing?: { tier: string | null; active: boolean; billedDrivers: number | null } }) {
  const router = useRouter();
  const [rows, setRows] = useState<DriverRow[]>(() => drivers.map((d) => ({
    key: d.id, id: d.id, active: true, name: d.name, state: d.state ?? "", license: "", licenseHint: d.license,
    licenseExpiry: d.licenseExpiry ?? "", medicalExpiry: d.medicalExpiry ?? "", dirty: false,
  })));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, patch: Partial<DriverRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => !r.id || r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);
  const keeping = rows.filter((r) => r.active && (r.id || r.name.trim())).length;
  const gone = rows.filter((r) => r.id && !r.active).length;
  const added = rows.filter((r) => !r.id && r.name.trim()).length;
  const changed = rows.filter((r) => r.id && r.active && r.dirty).length;
  const [pending, setPending] = useState<PriceChange | null>(null);
  const live = billing?.active ? priceChange(billing.tier, billing.billedDrivers, keeping) : null;

  async function submit(acceptPriceFor?: number) {
    const badState = rows.filter((r) => r.active && r.state.trim() && !STATE_CODES.has(toStateCode(r.state)));
    if (badState.length) {
      setError(`Pick a state from the list for ${badState.slice(0, 3).map((r) => r.name || "the new driver").join(", ")}${badState.length > 3 ? ` and ${badState.length - 3} more` : ""}.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      const result = await save(`/api/plan/${token}/drivers`, {
        acceptPriceFor,
        rows: rows.map((r) => ({ id: r.id, active: r.active, full_name: r.name, cdl_state: toStateCode(r.state), cdl_number: r.license, cdl_expiry: r.licenseExpiry, medical_cert_expiry: r.medicalExpiry })),
      });
      setPending(null);
      if (result.billingNote) { setError(result.billingNote); setBusy(false); return; }
      router.push("/portal?saved=drivers#todo");
      router.refresh();
    } catch (e) {
      if (e instanceof PriceNeeded) { setPending(e.change); setBusy(false); return; }
      setError(e instanceof Error ? e.message : String(e)); setBusy(false);
    }
  }

  return (
    <>
    {pending ? <PriceDialog change={pending} busy={busy} onAgree={() => submit(pending.to)} onCancel={() => setPending(null)} /> : null}
    <datalist id="license-states">{STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</datalist>
    <Shell
      title="Your drivers"
      intro={`${fromFile && drivers.length ? "We filled this in from your insurance file. " : ""}This should be everyone who drives under your DOT number. Fix anything that is wrong, untick anyone who no longer drives for you, add anyone missing, then confirm the list at the bottom. License numbers are optional; we only show the last 4 digits of one already on file.`}
      count={rows.length}
      search={search}
      setSearch={setSearch}
      showSearch={rows.length > 10}
      head={(
        <div className={DRIVER_COLS}>
          <span className="text-xs font-semibold uppercase tracking-wide text-warm-gray" title="Drives for you">Yes</span>
          <span className="px-1 text-xs font-semibold uppercase tracking-wide text-warm-gray">Name</span>
          <span className={HEAD}>State</span>
          <span className={HEAD}>License number</span>
          <span className={HEAD}>License expires</span>
          <span className={HEAD}>Medical card expires</span>
        </div>
      )}
      onAdd={() => setRows((all) => [...all, { key: `new-${all.length}-${Date.now()}`, id: null, active: true, name: "", state: "", license: "", licenseHint: null, licenseExpiry: "", medicalExpiry: "", dirty: true }])}
      addLabel="Add a driver"
      summary={`${keeping} driver${keeping === 1 ? "" : "s"} on your list${added ? ` · ${added} new` : ""}${changed ? ` · ${changed} changed` : ""}${gone ? ` · ${gone} no longer driving` : ""}${live ? ` · new price $${live.toMonthly.toLocaleString()} a month (was $${live.fromMonthly.toLocaleString()})` : ""}`}
      button={`Confirm my list of ${keeping} driver${keeping === 1 ? "" : "s"}`}
      busy={busy}
      error={error}
      onSave={() => submit()}
    >
      {shown.length === 0 ? <p className="px-4 py-6 text-sm text-warm-gray">No driver matches that search.</p> : shown.map((r) => (
        <div key={r.key} className={`${DRIVER_COLS} px-3 py-2 ${r.active ? "" : "bg-cream"} ${r.dirty && r.active ? "border-l-4 border-l-amber" : "border-l-4 border-l-transparent"}`}>
          <input type="checkbox" checked={r.active} onChange={(e) => set(r.key, { active: e.target.checked })} aria-label={`${r.name || "New driver"} drives for you`} className="h-5 w-5 accent-[var(--color-amber,#C67A1E)]" />
          <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} disabled={!r.active} placeholder="Full name" aria-label="Driver name" autoFocus={!r.id && !r.name} className={`${CELL} ${r.active ? "" : "line-through"}`} />
          <div className="col-start-2 grid grid-cols-2 gap-1.5 sm:contents">
            <input value={r.state} list="license-states" onChange={(e) => set(r.key, { state: e.target.value.slice(0, 30) })} onBlur={(e) => set(r.key, { state: toStateCode(e.target.value) })} disabled={!r.active} placeholder="State" aria-label="License state" autoComplete="off" aria-invalid={Boolean(r.state) && r.state.length > 2 ? true : undefined} className={CELL} />
            <input value={r.license} onChange={(e) => set(r.key, { license: e.target.value })} disabled={!r.active} placeholder={r.licenseHint ?? "License number"} aria-label="License number" className={CELL} />
            <label className="text-xs text-warm-gray sm:contents"><span className="sm:sr-only">License expires</span>
              <input type="date" value={r.licenseExpiry} onChange={(e) => set(r.key, { licenseExpiry: e.target.value })} disabled={!r.active} aria-label="License expires" className={CELL} /></label>
            <label className="text-xs text-warm-gray sm:contents"><span className="sm:sr-only">Medical card expires</span>
              <input type="date" value={r.medicalExpiry} onChange={(e) => set(r.key, { medicalExpiry: e.target.value })} disabled={!r.active} aria-label="Medical card expires" className={CELL} /></label>
          </div>
        </div>
      ))}
    </Shell>
    </>
  );
}

/* ---------------- Trucks and trailers ---------------- */

type TruckRow = { key: string; id: string | null; active: boolean; unit: string; type: "truck" | "trailer"; year: string; make: string; model: string; vin: string; plate: string; dirty: boolean };

const TRUCK_COLS = "grid grid-cols-[2rem_1fr] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[2rem_minmax(5.5rem,0.8fr)_6.5rem_4.5rem_minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(10rem,1.5fr)_minmax(6rem,0.8fr)]";

export function TruckListEditor({ token, trucks, note, fromFile }: { token: string; trucks: SetupTruck[]; note: string | null; fromFile: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<TruckRow[]>(() => trucks.map((t) => ({
    key: t.id, id: t.id, active: true, unit: t.unit ?? "", type: t.unitType, year: t.year ? String(t.year) : "", make: t.make ?? "", model: t.model ?? "",
    vin: t.vin ?? "", plate: t.plate ?? "", dirty: false,
  })));
  const [text, setText] = useState(note ?? "");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, patch: Partial<TruckRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  const filled = (r: TruckRow) => Boolean(r.unit.trim() || r.vin.trim() || r.plate.trim());
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => !r.id || [r.unit, r.vin, r.plate, r.make].some((v) => v.toLowerCase().includes(q))) : rows;
  }, [rows, search]);
  const keeping = rows.filter((r) => r.active && (r.id || filled(r)));
  const trucksKept = keeping.filter((r) => r.type === "truck").length;
  const trailersKept = keeping.length - trucksKept;
  const gone = rows.filter((r) => r.id && !r.active).length;
  const added = rows.filter((r) => !r.id && filled(r)).length;
  const changed = rows.filter((r) => r.id && r.active && r.dirty).length;
  const countText = `${trucksKept} truck${trucksKept === 1 ? "" : "s"}${trailersKept ? ` and ${trailersKept} trailer${trailersKept === 1 ? "" : "s"}` : ""}`;

  return (
    <Shell
      title="Your trucks and trailers"
      intro={`${fromFile && trucks.length ? "We filled this in from your insurance file. " : ""}This should be every truck and trailer you run under your DOT number. Fix anything that is wrong, untick any you no longer run, add any that are missing, then confirm the list at the bottom. The VIN helps us match inspections to the right truck.`}
      count={rows.length}
      search={search}
      setSearch={setSearch}
      showSearch={rows.length > 10}
      head={(
        <div className={TRUCK_COLS}>
          <span className="text-xs font-semibold uppercase tracking-wide text-warm-gray" title="You run it">Yes</span>
          <span className="px-1 text-xs font-semibold uppercase tracking-wide text-warm-gray">Unit #</span>
          <span className={HEAD}>Type</span>
          <span className={HEAD}>Year</span>
          <span className={HEAD}>Make</span>
          <span className={HEAD}>Model</span>
          <span className={HEAD}>VIN</span>
          <span className={HEAD}>Plate</span>
        </div>
      )}
      onAdd={() => setRows((all) => [...all, { key: `new-${all.length}-${Date.now()}`, id: null, active: true, unit: "", type: "truck", year: "", make: "", model: "", vin: "", plate: "", dirty: true }])}
      addLabel="Add a truck or trailer"
      summary={`${countText} on your list${added ? ` · ${added} new` : ""}${changed ? ` · ${changed} changed` : ""}${gone ? ` · ${gone} no longer run` : ""}`}
      button={`Confirm my list (${countText})`}
      busy={busy}
      error={error}
      extra={(
        <div className="border-t border-sand px-4 py-3">
          <label className="block text-sm"><span className="mb-1 block text-warm-gray">Anything we should know about your trucks? (optional)</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: two trucks are leased from another company" className={CELL} /></label>
        </div>
      )}
      onSave={async () => {
        setBusy(true); setError(null);
        try {
          await save(`/api/plan/${token}/trucks`, {
            rows: rows.map((r) => ({ id: r.id, active: r.active, unit_number: r.unit, unit_type: r.type, year: r.year, make: r.make, model: r.model, vin: r.vin, license_plate: r.plate })),
            note: text,
          });
          router.push("/portal?saved=trucks#todo");
          router.refresh();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
      }}
    >
      {shown.length === 0 ? <p className="px-4 py-6 text-sm text-warm-gray">Nothing matches that search.</p> : shown.map((r) => (
        <div key={r.key} className={`${TRUCK_COLS} px-3 py-2 ${r.active ? "" : "bg-cream"} ${r.dirty && r.active ? "border-l-4 border-l-amber" : "border-l-4 border-l-transparent"}`}>
          <input type="checkbox" checked={r.active} onChange={(e) => set(r.key, { active: e.target.checked })} aria-label={`${r.unit ? `Unit ${r.unit}` : "This unit"}: you run it`} className="h-5 w-5 accent-[var(--color-amber,#C67A1E)]" />
          <input value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} disabled={!r.active} placeholder="Unit #" aria-label="Unit number" autoFocus={!r.id && !filled(r)} className={`${CELL} ${r.active ? "" : "line-through"}`} />
          <div className="col-start-2 grid grid-cols-2 gap-1.5 sm:contents">
            <select value={r.type} onChange={(e) => set(r.key, { type: e.target.value === "trailer" ? "trailer" : "truck" })} disabled={!r.active} aria-label="Truck or trailer" className={CELL}>
              <option value="truck">Truck</option>
              <option value="trailer">Trailer</option>
            </select>
            <input value={r.year} onChange={(e) => set(r.key, { year: e.target.value.replace(/\D/g, "").slice(0, 4) })} disabled={!r.active} inputMode="numeric" placeholder="Year" aria-label="Year" className={CELL} />
            <input value={r.make} onChange={(e) => set(r.key, { make: e.target.value })} disabled={!r.active} placeholder="Make" aria-label="Make" className={CELL} />
            <input value={r.model} onChange={(e) => set(r.key, { model: e.target.value })} disabled={!r.active} placeholder="Model" aria-label="Model" className={CELL} />
            <input value={r.vin} onChange={(e) => set(r.key, { vin: e.target.value.toUpperCase().slice(0, 17) })} disabled={!r.active} placeholder="VIN" aria-label="VIN" className={`${CELL} col-span-2 font-mono sm:col-span-1`} />
            <input value={r.plate} onChange={(e) => set(r.key, { plate: e.target.value.toUpperCase() })} disabled={!r.active} placeholder="Plate" aria-label="Plate" className={CELL} />
          </div>
        </div>
      ))}
    </Shell>
  );
}
