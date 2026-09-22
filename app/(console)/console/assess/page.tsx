import { QuickAssessment } from "@/components/console/quick-assessment";
export default function AssessPage() {
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <header><h1 className="font-heading text-3xl text-navy">Assess a prospect</h1>
    <p className="mt-2 text-warm-mid">Enter any USDOT number to see where a carrier stands before you talk to them.</p></header>
    <QuickAssessment />
  </div>;
}
