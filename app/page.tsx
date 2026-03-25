import Link from "next/link";
import { ShieldCheck, TrendingDown, Check, ArrowRight } from "lucide-react";

const TIERS = [
  {
    name: "Monitor",
    price: "$199/mo",
    priceNote: null,
    description: "Continuous visibility into your DOT safety profile.",
    highlight: false,
    features: [
      "BASIC score monitoring",
      "Monthly safety reports",
      "Alert notifications",
      "Carrier portal access",
    ],
  },
  {
    name: "Remediate",
    price: "$599/mo",
    priceNote: null,
    description: "Active case management and violation challenges.",
    highlight: true,
    features: [
      "Everything in Monitor",
      "DataQ challenge management",
      "CPDP crash preventability review",
      "AI violation assessment",
      "Action item tracking",
    ],
  },
  {
    name: "Total Safety",
    price: "$999/mo",
    priceNote: "+ $29/driver/mo",
    description: "Full-service safety management with a dedicated specialist.",
    highlight: false,
    features: [
      "Everything in Remediate",
      "Dedicated safety specialist",
      "MCS-150 compliance support",
      "Priority case handling",
      "Quarterly strategic review",
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F4F4F4]">
      {/* Nav */}
      <header className="bg-white border-b border-[#E5E5E5] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-[#DC362E] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest leading-none">
                  Golden Era
                </p>
                <p className="text-[#1A1A1A] font-bold text-sm leading-tight">SafeScore</p>
              </div>
            </div>
            <Link
              href="/login"
              className="text-sm text-gray-500 hover:text-[#1A1A1A] font-medium transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[#1A1A1A] text-white">
        <div className="max-w-6xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-[#DC362E]/20 text-[#DC362E] text-xs font-semibold px-3 py-1.5 rounded-full mb-6 uppercase tracking-widest">
            Golden Era Insurance Agency
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-6 max-w-3xl mx-auto">
            Lower your DOT safety scores.{" "}
            <span className="text-[#C5A059]">Lower your insurance premiums.</span>
          </h1>
          <p className="text-white/60 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            SafeScore monitors your CSA BASIC scores, challenges faulty violations, and helps you
            avoid costly interventions — so you can focus on the road.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="flex items-center gap-2 px-6 py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#A3221C] transition-colors"
            >
              Get free assessment
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="flex items-center gap-2 text-white/60 hover:text-white text-sm font-medium transition-colors"
            >
              Already a client? Sign in
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white py-16 border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-[#1A1A1A] text-center mb-12">
            How SafeScore works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "We pull your BASIC scores",
                body: "SafeScore connects to FMCSA to pull your current safety data — inspections, violations, crashes, and all 7 BASIC percentiles.",
              },
              {
                step: "02",
                title: "We identify what can be fixed",
                body: "Our AI assesses each violation for challengeability. Faulty or dismissible violations are flagged for DataQ challenges.",
              },
              {
                step: "03",
                title: "We manage the remediation",
                body: "Your GEIA specialist files DataQ challenges and CPDP crash preventability petitions on your behalf — and tracks every case.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center sm:text-left">
                <div className="text-[#DC362E] font-bold text-3xl mb-3">{item.step}</div>
                <h3 className="font-bold text-[#1A1A1A] mb-2">{item.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why it matters */}
      <section className="py-16 border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl font-bold text-[#1A1A1A] mb-4">
                Your CSA score affects more than compliance
              </h2>
              <p className="text-gray-600 leading-relaxed mb-6">
                High BASIC percentiles trigger FMCSA interventions, drive up insurance premiums, and
                put your authority at risk. Many violations on your record are faulty — and can be
                removed through the DataQ system if challenged correctly.
              </p>
              <div className="space-y-3">
                {[
                  "FMCSA DataQ challenges can remove errors from inspection records",
                  "CPDP petitions can reclassify crashes as non-preventable",
                  "Lower scores lead directly to lower commercial auto premiums",
                ].map((fact) => (
                  <div key={fact} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#DC362E]/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-[#DC362E]" />
                    </div>
                    <p className="text-sm text-gray-700">{fact}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#1A1A1A] rounded-2xl p-8 text-white">
              <TrendingDown className="w-8 h-8 text-[#C5A059] mb-4" />
              <p className="font-bold text-xl mb-2">Pilot result</p>
              <p className="text-white/60 text-sm leading-relaxed">
                SafeScore reduced a client&apos;s Vehicle Maintenance BASIC percentile from the
                81st to the 64th percentile in 90 days by successfully challenging 4 out of 7
                eligible violations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-white py-16 border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-[#1A1A1A] text-center mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-xl mx-auto">
            Choose the level of service that fits your fleet. No setup fees. Cancel anytime.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl border-2 p-6 ${
                  tier.highlight
                    ? "border-[#DC362E] bg-[#1A1A1A] text-white"
                    : "border-[#E5E5E5] bg-white"
                }`}
              >
                {tier.highlight && (
                  <div className="text-[10px] font-bold text-[#DC362E] uppercase tracking-widest mb-3">
                    Most popular
                  </div>
                )}
                <h3
                  className={`font-bold text-xl mb-1 ${
                    tier.highlight ? "text-white" : "text-[#1A1A1A]"
                  }`}
                >
                  {tier.name}
                </h3>
                <div className="mb-1">
                  <span
                    className={`text-3xl font-bold ${
                      tier.highlight ? "text-white" : "text-[#1A1A1A]"
                    }`}
                  >
                    {tier.price}
                  </span>
                  {tier.priceNote && (
                    <p
                      className={`text-xs mt-0.5 ${
                        tier.highlight ? "text-white/60" : "text-gray-400"
                      }`}
                    >
                      {tier.priceNote}
                    </p>
                  )}
                </div>
                <p
                  className={`text-sm mb-5 ${
                    tier.highlight ? "text-white/60" : "text-gray-500"
                  }`}
                >
                  {tier.description}
                </p>
                <ul className="space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          tier.highlight ? "text-[#C5A059]" : "text-[#DC362E]"
                        }`}
                      />
                      <span
                        className={`text-sm ${
                          tier.highlight ? "text-white/80" : "text-gray-700"
                        }`}
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#DC362E] py-14">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">
            Get your free DOT safety assessment
          </h2>
          <p className="text-white/70 mb-8">
            Enter your DOT number and a GEIA safety specialist will review your BASIC scores and
            show you exactly what can be improved.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#1A1A1A] text-white font-semibold rounded-xl hover:bg-[#2a2a2a] transition-colors"
          >
            Request free assessment
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1A1A1A] py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#DC362E] flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm text-white/60">Golden Era Insurance Agency — SafeScore</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-white/40">
            <span>Commercial trucking insurance specialists</span>
            <Link href="/login" className="hover:text-white/60 transition-colors">
              Client login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
