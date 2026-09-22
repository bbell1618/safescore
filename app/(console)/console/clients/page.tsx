import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { QuickAssessment } from "@/components/console/quick-assessment";
import { NewClientButton } from "@/components/console/new-client-button";
import { loadConsoleClients } from "@/lib/console-clients-server";
import { tierBadgeVariant, tierDisplayLabel } from "@/lib/tiers";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [data, params] = await Promise.all([loadConsoleClients(), searchParams]);
  const query = (params.q ?? "").trim();
  const matches = (client: { name: string; dot_number: string | number | null }) => `${client.name} ${client.dot_number ?? ""}`.toLowerCase().includes(query.toLowerCase());
  const active = data.active.filter(matches);
  const other = data.other.filter(matches);
  return (
    <div className="space-y-6">
      <header className="portal-navy-texture rounded-2xl bg-navy p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-white/65">Client portfolio</p><h1 className="mt-2 font-heading text-3xl">Clients</h1><p className="mt-2 text-sm text-white/75">Active clients, ordered by open work. Open a client to see what needs you next.</p></div><NewClientButton /></div>
        <dl className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">{[["Active clients", data.active.length], ["Open work", data.active.reduce((n, c) => n + c.openWork, 0)], ["Waiting on client", data.active.reduce((n, c) => n + c.waiting, 0)], ["Unread alerts", data.active.reduce((n, c) => n + c.alerts, 0)]].map(([label, value]) => <div key={label}><dt className="text-xs text-white/65">{label}</dt><dd className="mt-1 font-mono text-2xl">{value}</dd></div>)}</dl>
      </header>
      <form className="flex flex-wrap items-end gap-3"><label className="flex-1 text-sm font-medium text-navy">Search name or USDOT<input name="q" defaultValue={query} className="mt-2 block min-h-11 w-full rounded-lg border border-sand bg-warm-white px-3" placeholder="Carrier name or DOT number" /></label><button className="min-h-11 rounded-lg bg-navy px-5 text-sm font-medium text-white">Search</button>{query && <Link href="/console/clients" className="inline-flex min-h-11 items-center text-sm text-navy underline">Clear</Link>}</form>
      <section aria-label="Active clients"><ul className="divide-y divide-sand overflow-hidden rounded-xl border border-sand bg-warm-white">{active.map(client => <li key={client.id}><Link href={`/console/clients/${client.id}/work`} className="grid gap-4 p-5 transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-amber md:grid-cols-2 xl:grid-cols-[minmax(12rem,1.8fr)_repeat(6,minmax(0,1fr))] xl:items-center"><div><h2 className="font-heading text-lg text-navy">{client.name}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">USDOT {client.dot_number ?? "Not recorded"}</p></div><div><Badge variant={tierBadgeVariant(client.tier)}>{tierDisplayLabel(client.tier)}</Badge></div><Cell label="Violation burden" value={client.burden?.toLocaleString() ?? "Not available"}><span className="text-xs text-muted-foreground">{client.delta === null ? "No comparison yet" : client.delta === 0 ? "Unchanged" : `${client.delta > 0 ? "+" : ""}${client.delta} since last snapshot`}</span></Cell><Cell label="Open work" value={client.openWork} /><Cell label="Waiting on client" value={client.waiting} /><Cell label="Last refresh" value={client.lastRefresh ? formatDate(client.lastRefresh) : "Not yet"} /><Cell label="Unread alerts" value={client.alerts} /></Link></li>)}</ul>{active.length === 0 && <p className="rounded-xl border border-sand bg-warm-white p-6 text-sm text-muted-foreground">{query ? "No active clients match this search." : "No active clients yet. Add a client or assess a prospect to get started."}</p>}</section>
      <details open={!!query} className="rounded-xl border border-sand bg-warm-white p-5"><summary className="min-h-11 cursor-pointer font-heading text-lg text-navy">Other clients and prospects · {other.length}</summary><ul className="divide-y divide-sand">{other.map(client => <li key={client.id}><Link href={`/console/clients/${client.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{client.name} <span className="font-mono text-xs text-muted-foreground">USDOT {client.dot_number ?? "Not recorded"}</span></span><span className="text-muted-foreground">{client.status.replaceAll("_", " ")} · {tierDisplayLabel(client.tier)}</span></Link></li>)}</ul></details>
      <details className="rounded-xl border border-sand bg-warm-white p-5"><summary className="min-h-11 cursor-pointer font-heading text-lg text-navy">Assess a prospect</summary><QuickAssessment /></details>
    </div>
  );
}

function Cell({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm text-navy">{value}</p>{children}</div>;
}
