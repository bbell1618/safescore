import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RequestUpload } from "@/components/portal/request-upload";

type EvidenceItem = { evidenceId: string; label: string; contextNote: string | null; caseType: string };

export default async function PortalRequestsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: userRow } = await supabase.from("users").select("client_id").eq("id", user.id).single();
  if (!userRow?.client_id) redirect("/portal");
  const { data: requests } = await supabase.from("client_requests").select("id, category, title, description, requested_items, status, due_at, reminder_count, created_at").eq("client_id", userRow.client_id).eq("responsibility", "client").order("created_at", { ascending: false });
  const open = (requests ?? []).filter((row) => row.status === "open");
  const completed = (requests ?? []).filter((row) => row.status === "fulfilled");
  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-bold text-[#1E1C1A]">Your requests</h1><p className="mt-1 text-sm text-gray-500">One place for records only you can provide. GEIA-obtained items are handled separately.</p></div>
      {open.length === 0 ? <div className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-8 text-center"><p className="text-sm font-medium">Nothing needed from you right now.</p><p className="mt-1 text-xs text-gray-500">We will add a request here when your team needs to provide a record.</p></div> : (
        <div className="space-y-4">{open.map((row) => {
          const items = (row.requested_items ?? []) as EvidenceItem[];
          return <section key={row.id} className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-5"><div className="flex justify-between gap-4"><div><h2 className="text-sm font-semibold text-[#1E1C1A]">{row.title}</h2>{row.description && <p className="mt-1 text-xs text-gray-500">{row.description}</p>}</div><span className="h-fit rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">Action needed</span></div>{items.length > 0 ? <div className="mt-4 divide-y divide-[#F0E8DA] rounded-lg border border-[#F0E8DA] bg-white">{items.map((item) => <div key={item.evidenceId} className="p-4"><p className="text-sm font-medium">{item.label}</p>{item.contextNote && <p className="mt-1 text-xs text-gray-500">{item.contextNote}</p>}<p className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">{item.caseType} case evidence</p><RequestUpload requestId={row.id} evidenceId={item.evidenceId} /></div>)}</div> : <RequestUpload requestId={row.id} />}</section>;
        })}</div>
      )}
      {completed.length > 0 && <section><h2 className="mb-2 text-sm font-semibold">Completed</h2><div className="rounded-xl border border-[#F0E8DA] bg-white divide-y divide-[#F0E8DA]">{completed.map((row) => <div key={row.id} className="flex items-center justify-between px-4 py-3"><span className="text-sm text-gray-600">{row.title}</span><span className="text-xs text-green-700">Received</span></div>)}</div></section>}
    </div>
  );
}
