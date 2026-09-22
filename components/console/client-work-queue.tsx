"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OperatorChecklist, ManualItems, type ChecklistRenderState } from "./operator-checklist";
import { WorkItemRow, workItemHref } from "./work-item-row";
import { RosterLinkCopy } from "./roster-link-copy";
import type { ClientWorkData } from "@/lib/console-work-types";

const button = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-navy px-3 text-xs font-semibold text-warm-white hover:bg-amber-dark disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-gold";
const relative = (value: string, now: string) => { const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(value)) / 86400000)); return days ? `${days}d ago` : "today"; };
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles" }).format(new Date(value));

function RankedQueue({ clientId, data, state }: { clientId: string; data: ClientWorkData; state: ChecklistRenderState }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [pendingAlert, setPendingAlert] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => { const hash = decodeURIComponent(window.location.hash.slice(1)); setFilter(hash === "requests" ? "requests" : hash === "monitoring" ? "alerts" : hash === "work-list" ? "work" : "all"); };
    sync(); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync);
  }, []);
  async function acknowledge(id: string) {
    setPendingAlert(id); setAlertError(null);
    try {
      const response = await fetch(`/api/monitoring/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.alert?.acknowledged_at) throw new Error(payload.error ?? `Alert acknowledgement failed with HTTP ${response.status}`);
      setAcknowledged(current => [...current, id]); router.refresh();
    } catch (error) { setAlertError(error instanceof Error ? error.message : "Unknown alert acknowledgement failure"); }
    finally { setPendingAlert(null); }
  }
  const alerts = data.alerts.filter(alert => !acknowledged.includes(alert.id));
  const rows = [
    ...state.items.map(item => ({ id: item.id, kind: "work" as const, item, priority: item.priority, createdAt: data.timing[item.id]?.createdAt ?? null, dueAt: data.timing[item.id]?.dueAt ?? null })),
    ...state.manualItems.filter(item => item.status === "open" && !item.deletedAt).map(item => ({ id: item.id, kind: "manual" as const, item, priority: 3, createdAt: item.createdAt, dueAt: item.dueDate })),
    ...data.requests.map(item => ({ id: item.id, kind: "requests" as const, item, priority: item.escalated_at ? 1 : 3, createdAt: item.created_at, dueAt: item.due_at })),
    ...alerts.map(item => ({ id: item.id, kind: "alerts" as const, item, priority: item.severity === "critical" ? 1 : item.severity === "warning" ? 2 : 3, createdAt: item.created_at, dueAt: null })),
  ];
  const today = day(data.now);
  const rank = (row: typeof rows[number]) => row.dueAt && day(row.dueAt) < today ? 0 : row.dueAt && day(row.dueAt) === today ? 1 : row.priority === 1 ? 2 : 3;
  rows.sort((a, b) => rank(a) - rank(b) || (a.createdAt ? Date.parse(a.createdAt) : Infinity) - (b.createdAt ? Date.parse(b.createdAt) : Infinity) || a.priority - b.priority || a.id.localeCompare(b.id));
  const visible = rows.filter(row => filter === "all" || (filter === "work" ? row.kind === "work" || row.kind === "manual" : row.kind === filter));
  const error = state.error ?? alertError;
  return <div className="space-y-5">
    <header className="portal-navy-texture rounded-2xl p-6 text-warm-white"><p className="font-mono text-xs uppercase tracking-widest text-gold-light">Client work</p><h1 className="mt-2 font-heading text-4xl">What needs attention</h1><p className="mt-3 text-sm text-warm-white/75">Last refresh {data.lastRefresh ? relative(data.lastRefresh, data.now) : "not available"}</p><div className="mt-5 flex flex-wrap gap-3">{[["To do", state.items.filter(item => item.state === "needs_you").length + state.manualItems.filter(item => item.status === "open" && !item.deletedAt).length], ["Waiting on client", data.requests.length], ["Alerts", alerts.length]].map(([label, count]) => <span key={label} className="rounded-lg border border-gold/30 px-4 py-2 text-sm"><strong className="mr-2 font-mono text-xl text-gold-light">{count}</strong>{label}</span>)}</div></header>
    {error && <p role="alert" className="rounded-lg border border-error bg-error/10 p-4 text-error">{error}</p>}{state.message && <p role="status" className="rounded-lg bg-success/10 p-4 text-success">{state.message}</p>}
    <nav aria-label="Filter work" className="flex flex-wrap gap-2">{[["all", "All work"], ["work", "To do"], ["requests", "Waiting on client"], ["alerts", "Alerts"]].map(([value, label]) => <a key={value} href={value === "requests" ? "#requests" : value === "alerts" ? "#monitoring" : value === "work" ? "#work-list" : "#all"} onClick={() => setFilter(value)} aria-current={filter === value ? "true" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm ${filter === value ? "border-amber bg-amber-subtle text-amber-dark" : "border-sand bg-warm-white text-warm-mid"}`}>{label}</a>)}</nav>
    <div id="work-list" className="scroll-mt-24"><span id="all" className="block scroll-mt-24" /><span id="requests" className="block scroll-mt-24" /><span id="monitoring" className="block scroll-mt-24" /><ul className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm">{visible.map(row => {
      const timing = row.dueAt ? `${day(row.dueAt) < today ? "Overdue" : "Due"} ${day(row.dueAt)}` : row.createdAt ? relative(row.createdAt, data.now) : "Current work";
      if (row.kind === "work") {
        const item = row.item;
        const primary = item.action ? <button className={button} disabled={state.pending !== null} onClick={() => void state.runDerivedAction(item)}>{item.action.label}</button> : item.canMarkDone ? <button className={button} disabled={state.pending !== null} onClick={() => void state.acknowledge(item, "done")}>Mark done</button> : item.href ? <Link className={button} href={workItemHref(item.href, clientId)}>Open</Link> : null;
        return <WorkItemRow key={`work-${row.id}`} id={`work-item-${row.id}`} title={item.title} priority={item.priority} timing={timing} action={primary}><p>{item.why}</p><ol className="mt-3 list-decimal space-y-2 pl-5">{item.instructions.map((step, index) => <li key={index}>{step}</li>)}</ol><div className="mt-4 flex flex-wrap gap-3">{item.canSnooze && <button className={button} disabled={state.pending !== null} onClick={() => void state.acknowledge(item, "snooze")}>Snooze {item.defaultSnoozeDays ?? 14} days</button>}{item.action && item.canMarkDone && <button className={button} disabled={state.pending !== null} onClick={() => void state.acknowledge(item, "done")}>Mark done</button>}{(item.action || item.canMarkDone) && item.href && <Link className={button} href={workItemHref(item.href, clientId)}>Open related record</Link>}</div></WorkItemRow>;
      }
      if (row.kind === "manual") return <WorkItemRow key={`manual-${row.id}`} title={row.item.title} timing={timing} action={<button className={button} disabled={state.pending !== null} onClick={() => void state.updateManual(row.item, "toggle")}>Mark done</button>}><p>{row.item.details ?? "Added by the team."}</p><button className={`${button} mt-3`} disabled={state.pending !== null} onClick={() => void state.updateManual(row.item, "delete")}>Remove item</button></WorkItemRow>;
      if (row.kind === "alerts") return <WorkItemRow key={`alert-${row.id}`} title={row.item.title} detail="Monitoring alert" timing={timing} priority={row.priority as 1 | 2 | 3} action={<button className={button} disabled={pendingAlert !== null} onClick={() => void acknowledge(row.id)}>{pendingAlert === row.id ? "Acknowledging…" : "Acknowledge"}</button>}><p>{row.item.message}</p><p className="mt-2 font-mono text-xs">Raised {day(row.item.created_at)}</p></WorkItemRow>;
      return <WorkItemRow key={`request-${row.id}`} title={row.item.title} detail="Waiting on client" timing={timing} priority={row.priority as 1 | 2 | 3} action={row.item.request_type === "roster_collection" && row.item.upload_token ? <RosterLinkCopy compact url={`${data.appUrl}/roster/${row.item.upload_token}`} /> : undefined}><p>{row.item.description ?? "Awaiting the requested information."}</p><p className="mt-2">Reminders: {row.item.reminder_count} / {row.item.reminder_limit}{row.item.next_reminder_at ? ` · Next ${day(row.item.next_reminder_at)}` : ""}{row.item.escalated_at ? " · Escalated" : ""}</p></WorkItemRow>;
    })}</ul>{visible.length === 0 && <div className="rounded-xl border border-sand bg-warm-white p-8"><h2 className="font-heading text-xl">Queue is clear</h2><p className="mt-2 text-sm text-warm-mid">No open items match this view.</p></div>}</div>
    <details className="rounded-xl border border-sand bg-warm-white p-5"><summary id="manual-items-heading" className="min-h-11 cursor-pointer font-heading text-lg">Add work and manage completed items</summary><ManualItems clientId={clientId} items={state.manualItems} pending={state.pending} onCreate={state.createManual} onUpdate={state.updateManual} /></details>
  </div>;
}
export function ClientWorkQueue({ clientId, data }: { clientId: string; data: ClientWorkData }) {
  return <OperatorChecklist clientId={clientId} initialItems={data.items} initialManualItems={data.manualItems} render={state => <RankedQueue clientId={clientId} data={data} state={state} />} />;
}

