import { QuickAssessment } from "@/components/console/quick-assessment";
export default function AssessPage() {
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <header className="portal-navy-texture rounded-2xl bg-navy p-6 text-warm-white sm:p-8"><h1 className="font-heading text-3xl text-warm-white">Assess a prospect</h1>
    <p className="mt-2 text-warm-white/75">Enter any USDOT number to see where a carrier stands before you talk to them.</p></header>
    <QuickAssessment />
  </div>;
}
