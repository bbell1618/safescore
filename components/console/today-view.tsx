import { portalCopy } from "@/lib/portal/copy";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { QuickAssessment } from "@/components/console/quick-assessment";
import { WorkItemRow, workItemHref } from "@/components/console/work-item-row";
import { tierDisplayLabel, tierBadgeVariant } from "@/lib/tiers";
import { loadConsoleToday } from "@/lib/console-today-server";
import { formatDate } from "@/lib/utils";

function age(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  return days === 0 ? "Today" : `${days}d ago`;
}

export async function TodayView() {
  const { now, unreadAlertCount, clients, groups, alerts, requests, activity, gates } = await loadConsoleToday();
  const names = new Map(clients.map(client => [client.id, client.name]));
  const workCount = groups.reduce((count, group) => count + group.items.length + group.manualItems.length, 0);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">
    <header className="portal-navy-texture relative overflow-hidden rounded-2xl px-6 py-8 text-warm-white shadow-sm sm:px-8">
      <div className="relative z-10"><p className="font-mono text-xs uppercase tracking-widest text-gold-light">Operator · {date}</p>
        <h1 className="mt-2 font-heading text-4xl sm:text-5xl">Today</h1>
        <div className="mt-6 flex flex-wrap gap-3">{[
          [workCount, "Open work items"], [unreadAlertCount, "Alerts unread"], [requests.length, "Waiting on clients"],
        ].map(([count, label]) => <div key={label} className="rounded-lg border border-gold/30 bg-amber/15 px-4 py-3"><span className="mr-3 font-mono text-2xl text-gold-light">{count}</span><span className="text-xs text-warm-white/85">{label}</span></div>)}</div>
      </div>
    </header>
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="work-queue-heading"><h2 id="work-queue-heading" className="mb-4 font-heading text-2xl text-navy">Work queue</h2>
          {workCount === 0 ? <Empty title="Queue is clear" copy="There are no open work items for active subscription clients." /> : <div className="space-y-5">{groups.filter(group => group.items.length || group.manualItems.length).map(group => <article key={group.client.id} className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm">
            <header className="flex flex-wrap items-center gap-3 border-b border-sand bg-cream px-5 py-4"><h3 className="min-w-0 basis-full break-words font-heading text-xl text-navy sm:flex-1 sm:basis-auto">{group.client.name}</h3><Badge variant={tierBadgeVariant(group.client.tier)}>{tierDisplayLabel(group.client.tier)}</Badge><span className="font-mono text-sm text-amber-dark">{group.burden == null ? "No snapshot" : `${group.burden} weighted violation pts`}</span></header>
            <ul>{group.items.map(item => <WorkItemRow key={item.id} title={portalCopy(item.title)} priority={item.priority} href={workItemHref(item.href, group.client.id)} timing={item.timing} />)}
              {group.manualItems.map(item => <WorkItemRow key={item.id} title={portalCopy(item.title)} href={`/console/clients/${group.client.id}/work#manual-items-heading`} timing={item.dueDate ? `Due ${formatDate(item.dueDate)}` : age(item.createdAt)} />)}</ul>
          </article>)}</div>}
        </section>
        <section><h2 className="mb-4 font-heading text-2xl text-navy">Alerts <span className="font-mono text-base text-warm-gray">{alerts.length}</span></h2>
          {alerts.length ? <ul className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm">{alerts.map(alert => <WorkItemRow key={alert.id} title={`${names.get(alert.client_id) ?? "Client"} · ${alert.title}`} href={`/console/clients/${alert.client_id}/work#monitoring`} timing={age(alert.created_at)} priority={alert.read_at ? 3 : 2} detail={alert.message} />)}</ul> : <Empty title="No recent alerts" copy="No alerts were recorded in the last 14 days." />}
        </section>
        <section><h2 className="mb-4 font-heading text-2xl text-navy">Waiting on clients <span className="font-mono text-base text-warm-gray">{requests.length}</span></h2>
          {requests.length ? <ul className="overflow-hidden rounded-xl border border-sand bg-warm-white shadow-sm">{requests.map(request => <WorkItemRow key={request.id} title={`${names.get(request.client_id) ?? "Client"} · ${request.title}`} href={`/console/clients/${request.client_id}/work#requests`} timing={`${Math.max(0, Math.floor((now - new Date(request.created_at).getTime()) / 86400000))}d waiting`} />)}</ul> : <Empty title="Nothing outstanding" copy="There are no open requests waiting on clients." />}
        </section>
        {gates.length > 0 && <section className="rounded-xl border border-gold/30 bg-amber-subtle p-5"><h2 className="font-heading text-xl text-navy">System gates</h2><ul className="mt-3 space-y-3">{gates.map(gate => <li key={gate.id}><p className="text-sm font-semibold">{gate.title}</p><p className="mt-1 text-xs text-warm-mid">{gate.why}</p></li>)}</ul></section>}
      </div>
      <aside className="min-w-0 space-y-6"><QuickAssessment /><section className="rounded-xl border border-sand bg-warm-white p-5 shadow-sm"><h2 className="font-heading text-xl text-navy">Recent activity</h2><ul className="mt-4 divide-y divide-sand">{activity.map(log => <li key={log.id} className="py-3"><p className="text-sm text-warm-mid">{log.description}</p><p className="mt-1 font-mono text-xs text-warm-gray">{age(log.created_at)}</p></li>)}</ul><Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-amber-dark" href="/console/activity">View all activity →</Link></section></aside>
    </div>
  </div>;
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="rounded-xl border border-sand bg-warm-white p-6 shadow-sm"><h3 className="font-heading text-lg text-navy">{title}</h3><p className="mt-1 text-sm text-warm-mid">{copy}</p></div>;
}

