import type { ReactNode } from "react";
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

export function WorkItemRow({ title, href, priority = 3, timing, detail, action, children, id }: { title: string; href?: string; priority?: 1 | 2 | 3; timing: string; detail?: string; action?: ReactNode; children?: ReactNode; id?: string }) {
  const label = <><span aria-label={`Priority ${priority}`} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priority === 1 ? "bg-error" : priority === 2 ? "bg-amber" : "bg-info"}`} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-warm-dark">{title}</span>{detail && <span className="mt-1 block text-xs text-warm-mid">{detail}</span>}</span><span className="shrink-0 font-mono text-xs text-warm-gray">{timing}</span></>;
  return <li id={id} className="scroll-mt-24 border-b border-sand px-4 py-3 last:border-0 sm:px-5">
    <div className="flex flex-wrap items-start gap-3">
      {children ? <details className="group min-w-0 flex-1"><summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded py-2 focus-visible:outline-2 focus-visible:outline-gold">{label}<span className="text-amber-dark group-open:rotate-90" aria-hidden="true">›</span></summary><div className="mt-3 border-t border-sand py-4 text-sm text-warm-mid">{children}</div></details> : <div className="flex min-h-11 min-w-0 flex-1 items-start gap-3 py-2">{label}</div>}
      {action ?? (href ? <Link href={href} aria-label={`Open ${title}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-amber-dark hover:bg-amber-subtle focus-visible:outline-2 focus-visible:outline-gold">Open <ArrowUpRight className="h-4 w-4" /></Link> : null)}
    </div>
  </li>;
}
