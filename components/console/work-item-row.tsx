import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/** Preserve details and existing anchors when mapping retired collection URLs. */
export function workItemHref(href: string, clientId: string) {
  const base = `/console/clients/${clientId}`;
  if (!href.trim()) return `${base}/work`;
  const [pathnameAndQuery, hash] = href.split("#");
  const [pathname, query] = pathnameAndQuery.split("?");
  const routes: Record<string, string> = { checklist: "work", requests: "work#requests", monitoring: "work#monitoring", remediation: "plan", "remediation/playbook": "plan#playbook", compliance: "plan#compliance", reports: "account#reports" };
  if (!pathname.startsWith(`${base}/`)) return href;
  const destination = routes[pathname.slice(base.length + 1)];
  if (!destination) return href;
  const [route, anchor] = destination.split("#");
  return `${base}/${route}${query ? `?${query}` : ""}${hash || anchor ? `#${hash || anchor}` : ""}`;
}

export function WorkItemRow({ title, href, priority = 3, timing, detail }: { title: string; href: string; priority?: 1 | 2 | 3; timing: string; detail?: string }) {
  return <li className="flex min-w-0 flex-wrap items-center gap-3 border-b border-sand px-5 py-4 last:border-0">
    <span aria-label={`Priority ${priority}`} className={`h-2 w-2 shrink-0 rounded-full ${priority === 1 ? "bg-error" : priority === 2 ? "bg-amber" : "bg-info"}`} />
    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-warm-dark">{title}</p>{detail && <p className="mt-1 text-xs text-warm-mid">{detail}</p>}</div>
    <span className="font-mono text-xs text-warm-gray">{timing}</span>
    <Link href={href} aria-label={`Open ${title}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-amber-dark hover:bg-amber-subtle focus-visible:outline-2 focus-visible:outline-gold">Open <ArrowUpRight className="h-4 w-4" /></Link>
  </li>;
}
