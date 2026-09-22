import { Suspense } from "react";
import RemediationSection from "@/components/console/sections/remediation-section";
import PlaybookSection from "@/components/console/sections/playbook-section";
import ComplianceSection from "@/components/console/sections/compliance-section";
export const dynamic = "force-dynamic";
export default function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  return <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6"><header className="portal-navy-texture rounded-2xl p-6 text-warm-white"><p className="font-mono text-xs uppercase tracking-widest text-gold-light">Safety improvement</p><h1 className="mt-2 font-heading text-4xl">Plan</h1><p className="mt-3 max-w-2xl text-sm text-warm-white/75">Resolve the current work, coach the recurring causes, and build the compliance record.</p><nav aria-label="Plan sections" className="mt-5 flex flex-wrap gap-4 text-sm text-gold-light"><a className="inline-flex min-h-11 items-center" href="#remediation">Remediation</a><a className="inline-flex min-h-11 items-center" href="#playbook">Programs</a><a className="inline-flex min-h-11 items-center" href="#compliance">Compliance</a></nav></header>
    <section id="remediation" className="scroll-mt-24"><Suspense fallback={<p className="p-6" role="status">Loading remediation…</p>}><RemediationSection params={params} /></Suspense></section>
    <section id="playbook" className="scroll-mt-24"><Suspense fallback={<p className="p-6" role="status">Loading playbook…</p>}><PlaybookSection params={params} searchParams={searchParams} /></Suspense></section>
    <section id="compliance" className="scroll-mt-24"><Suspense fallback={<p className="p-6" role="status">Loading compliance…</p>}><ComplianceSection params={params} /></Suspense></section>
  </div>;
}
