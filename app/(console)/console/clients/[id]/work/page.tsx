import { Suspense } from "react";
import { ClientWorkQueue } from "@/components/console/client-work-queue";
import { loadClientWork } from "@/lib/console-work-server";
import RequestsSection from "@/components/console/sections/requests-section";
import MonitoringSection from "@/components/console/sections/monitoring-section";
export const dynamic = "force-dynamic";
export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadClientWork(id);
  return <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">
    <ClientWorkQueue clientId={id} data={data} />
    <details className="rounded-xl border border-sand bg-warm-white p-5"><summary className="min-h-11 cursor-pointer font-heading text-xl">Request history</summary><Suspense fallback={<p role="status">Loading history…</p>}><RequestsSection params={params} /></Suspense></details>
    <details className="rounded-xl border border-sand bg-warm-white p-5"><summary className="min-h-11 cursor-pointer font-heading text-xl">Watch status and monitoring history</summary><Suspense fallback={<p role="status">Loading monitoring…</p>}><MonitoringSection params={params} /></Suspense></details>
  </div>;
}
