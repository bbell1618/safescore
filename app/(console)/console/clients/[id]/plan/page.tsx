import { Suspense } from "react";
import RemediationSection from "@/components/console/sections/remediation-section";
import PlaybookSection from "@/components/console/sections/playbook-section";
import ComplianceSection from "@/components/console/sections/compliance-section";
export const dynamic = "force-dynamic";
export default function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  return <div className="space-y-8 pb-8">
    <Suspense fallback={<p className="p-6" role="status">Loading remediation…</p>}><RemediationSection params={params} /></Suspense>
    <section id="playbook" className="scroll-mt-6"><Suspense fallback={<p className="p-6" role="status">Loading playbook…</p>}><PlaybookSection params={params} searchParams={searchParams} /></Suspense></section>
    <section id="compliance" className="scroll-mt-6"><Suspense fallback={<p className="p-6" role="status">Loading compliance…</p>}><ComplianceSection params={params} /></Suspense></section>
  </div>;
}
