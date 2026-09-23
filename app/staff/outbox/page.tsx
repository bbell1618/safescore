import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffOnboardingUser, OnboardingRouteFailure } from "@/lib/onboarding/server";
import type { OutboxActionLink } from "@/lib/email/outbox";

export const dynamic = "force-dynamic";

export default async function StaffOutboxPage() {
  // The global middleware matcher covers /staff/*; authorize here BEFORE reading any outbox row.
  const access = await requireStaffOnboardingUser().catch(error => {
    if (error instanceof OnboardingRouteFailure && error.status === 401) redirect("/login");
    if (error instanceof OnboardingRouteFailure && error.status === 403) redirect("/access-mismatch?target=console");
    throw error;
  });
  const { data, error } = await access.service.from("email_dry_run_outbox")
    .select("id,created_at,to_address,template,subject,action_links")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
  return <main className="mx-auto max-w-6xl space-y-5 p-6">
    <Link href="/console" className="underline">Back to Today</Link>
    <h1 className="text-2xl font-semibold">Dry-run email outbox</h1>
    <p>Last 50 suppressed emails. Nothing here was sent. Account links are private: open only the intended test account.</p>
    {error ? <p role="alert">Unable to load outbox: {error.message}</p> : !data?.length ? <p>No dry-run emails saved yet.</p> :
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{["Time (UTC)", "To", "Template", "Subject", "Action links"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{data.map(row => <tr key={row.id} id={`email-${row.id}`} className="border-t align-top">
          <td className="p-3">{row.created_at}</td><td className="break-all p-3">{row.to_address}</td>
          <td className="p-3">{row.template}</td><td className="p-3">{row.subject}</td>
          <td className="p-3">{(Array.isArray(row.action_links) ? row.action_links : []).filter((link: OutboxActionLink) => {
            try { const url = new URL(link.href); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
          }).map((link: OutboxActionLink, index: number) => <a key={index} className="block underline" href={link.href} rel="noreferrer" referrerPolicy="no-referrer">{link.label || "Open link"}</a>)}</td>
        </tr>)}</tbody>
      </table></div>}
  </main>;
}
