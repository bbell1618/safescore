import type { SetupChecklist } from "./setup-checklist";

/**
 * QF-223: one place that says which items on a carrier's setup list are done. Used by the list
 * itself, by the "finish your setup list" email and by its reminders, so all three agree.
 * Pure: no database, safe to import from the browser.
 */
export type SetupItemState = { key: string; title: string; done: boolean };

export function setupItemStates(data: SetupChecklist): SetupItemState[] {
  const drivers = data.drivers.list;
  const trucks = data.trucks.list;
  return [
    { key: "drivers", title: "Check your driver list", done: drivers.length ? drivers.every((d) => d.confirmed) : Boolean(data.drivers.submittedAt) },
    { key: "trucks", title: "Check your truck list", done: Boolean(data.trucks.confirmedAt) && trucks.every((t) => t.confirmed) },
    { key: "eld", title: "Give us access to your ELD", done: data.eld.connected },
    { key: "operation", title: "Tell us how you run", done: Boolean(data.operation.radius) },
    { key: "fmcsa", title: "Let us see your FMCSA account", done: Boolean(data.fmcsa.method) },
    { key: "safety", title: "Tell us who handles safety day to day", done: Boolean(data.safetyContact.confirmedAt) },
    ...data.requests.map((r) => ({ key: `request:${r.id}`, title: r.title, done: r.state !== "open" })),
  ];
}

/**
 * For the email and its reminders: is an item Brandon asked about still open? Same as the list,
 * except FMCSA access, which stays open until the carrier says they approved our request.
 */
export function nudgeItemOpen(key: string, data: SetupChecklist, states: SetupItemState[]): boolean {
  if (key === "fmcsa") return data.fmcsa.method !== "approved";
  const state = states.find((s) => s.key === key);
  return state ? !state.done : false;
}

/** The wording the carrier sees for an item in the email. */
export function nudgeItemLabel(key: string, data: SetupChecklist, states: SetupItemState[]): string | null {
  if (key === "fmcsa") {
    return data.fmcsa.method === "will_approve" || data.fmcsa.method === "approved"
      ? "Approve our FMCSA Portal access request (FMCSA emails it to your company official)"
      : "Let us see your FMCSA account (tell us if you have an FMCSA Portal login)";
  }
  return states.find((s) => s.key === key)?.title ?? null;
}
