import { Suspense } from "react";
import ChecklistSection from "@/components/console/sections/checklist-section";
import RequestsSection from "@/components/console/sections/requests-section";
import MonitoringSection from "@/components/console/sections/monitoring-section";
export const dynamic = "force-dynamic";
export default function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  return <div className="space-y-8 pb-8">
    <Suspense fallback={<p className="p-6" role="status">Loading work…</p>}><ChecklistSection params={params} /></Suspense>
    <section id="requests" className="scroll-mt-6"><Suspense fallback={<p className="p-6" role="status">Loading requests…</p>}><RequestsSection params={params} /></Suspense></section>
    <section id="monitoring" className="scroll-mt-6"><Suspense fallback={<p className="p-6" role="status">Loading monitoring…</p>}><MonitoringSection params={params} /></Suspense></section>
  </div>;
}
