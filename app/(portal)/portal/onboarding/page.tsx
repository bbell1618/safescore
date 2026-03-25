"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";

interface ClientData {
  id: string;
  name: string;
  dot_number: string;
  status: string;
}

interface CarrierData {
  legalName?: string;
  dotNumber?: string;
  totalPowerUnits?: number;
  totalDrivers?: number;
  usdotStatus?: string;
  statusCode?: string;
}

type Tier = "monitor" | "remediate" | "total_safety";

const TIERS: {
  value: Tier;
  name: string;
  price: string;
  priceNote?: string;
  features: string[];
  highlight?: boolean;
}[] = [
  {
    value: "monitor",
    name: "Monitor",
    price: "$199/mo",
    features: [
      "BASIC score monitoring",
      "Monthly safety reports",
      "Alert notifications",
      "Portal access",
    ],
  },
  {
    value: "remediate",
    name: "Remediate",
    price: "$599/mo",
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
    value: "total_safety",
    name: "Total Safety",
    price: "$999/mo",
    priceNote: "+ $29/driver/mo",
    features: [
      "Everything in Remediate",
      "Dedicated safety specialist",
      "MCS-150 compliance support",
      "Priority case handling",
      "Quarterly strategic review",
    ],
  },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [client, setClient] = useState<ClientData | null>(null);
  const [carrier, setCarrier] = useState<CarrierData | null>(null);
  const [selectedTier, setSelectedTier] = useState<Tier>("remediate");
  const [loadingClient, setLoadingClient] = useState(true);
  const [loadingCarrier, setLoadingCarrier] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchClient() {
      try {
        const res = await fetch("/api/portal/me");
        const data = await res.json();
        setClient(data.client ?? null);
      } catch {
        // fail silently
      } finally {
        setLoadingClient(false);
      }
    }
    fetchClient();
  }, []);

  useEffect(() => {
    if (step === 3 && client?.dot_number && !carrier) {
      setLoadingCarrier(true);
      fetch(`/api/fmcsa/carrier/${client.dot_number}`)
        .then((r) => r.json())
        .then((data) => setCarrier(data.carrier ?? data ?? null))
        .catch(() => null)
        .finally(() => setLoadingCarrier(false));
    }
  }, [step, client, carrier]);

  async function handleSubscribe() {
    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const res = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selectedTier }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCheckoutError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setCheckoutError("Network error. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  const totalSteps = 4;
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  const selectedTierData = TIERS.find((t) => t.value === selectedTier)!;

  return (
    <div className="min-h-screen bg-[#F8F8F8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {steps.map((s) => (
            <div key={s} className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  s < step
                    ? "bg-[#DC362E] text-white"
                    : s === step
                    ? "bg-[#DC362E] text-white ring-4 ring-[#DC362E]/20"
                    : "bg-[#E5E5E5] text-gray-400"
                }`}
              >
                {s < step ? <Check className="w-4 h-4" /> : s}
              </div>
              {s < totalSteps && (
                <div className={`w-16 h-0.5 ${s < step ? "bg-[#DC362E]" : "bg-[#E5E5E5]"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E5E5] shadow-sm overflow-hidden">

          {/* ── Step 1: Welcome ── */}
          {step === 1 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2">
                  Step 1 of {totalSteps}
                </p>
                <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">
                  Welcome to SafeScore
                </h1>
                <p className="text-gray-600 leading-relaxed">
                  We&apos;re going to walk you through your current DOT safety profile and get your
                  account set up.
                </p>
              </div>

              {loadingClient ? (
                <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
              ) : client ? (
                <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-4 mb-6">
                  <p className="text-xs text-gray-400 mb-1">Your company</p>
                  <p className="text-base font-bold text-[#1A1A1A]">{client.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">DOT {client.dot_number}</p>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-6">
                  <p className="text-sm text-amber-700">
                    Your account is still being set up. Contact your GEIA account manager.
                  </p>
                </div>
              )}

              <button
                onClick={() => setStep(2)}
                disabled={loadingClient}
                className="w-full py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#A3221C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          )}

          {/* ── Step 2: Choose your tier ── */}
          {step === 2 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2">
                  Step 2 of {totalSteps}
                </p>
                <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">
                  Choose your plan
                </h1>
                <p className="text-gray-600 leading-relaxed">
                  Select the tier that fits your needs. You can upgrade at any time.
                </p>
              </div>

              <div className="space-y-3 mb-6">
                {TIERS.map((tier) => (
                  <button
                    key={tier.value}
                    type="button"
                    onClick={() => setSelectedTier(tier.value)}
                    className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                      selectedTier === tier.value
                        ? "border-[#DC362E] bg-[#F9E0DF]"
                        : "border-[#E5E5E5] hover:border-gray-300 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selectedTier === tier.value
                              ? "border-[#DC362E] bg-[#DC362E]"
                              : "border-gray-300"
                          }`}
                        >
                          {selectedTier === tier.value && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <span className="font-bold text-[#1A1A1A]">{tier.name}</span>
                        {tier.highlight && (
                          <span className="text-xs font-medium bg-[#DC362E] text-white px-2 py-0.5 rounded-full">
                            Most popular
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-[#1A1A1A]">{tier.price}</span>
                        {tier.priceNote && (
                          <p className="text-xs text-gray-500">{tier.priceNote}</p>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-1 pl-6">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                          <Check className="w-3 h-3 text-[#DC362E] shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 border border-[#E5E5E5] text-gray-600 font-medium rounded-xl hover:border-gray-300 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#A3221C] transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Safety Profile review ── */}
          {step === 3 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2">
                  Step 3 of {totalSteps}
                </p>
                <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">
                  Your safety profile
                </h1>
                <p className="text-gray-600 leading-relaxed">
                  Here is a snapshot of your carrier data from FMCSA. Your full BASIC score
                  analysis will be available in your dashboard within 24 hours of subscribing.
                </p>
              </div>

              {loadingCarrier ? (
                <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-5 space-y-3 mb-6">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex justify-between animate-pulse">
                      <div className="h-3 bg-gray-200 rounded w-1/3" />
                      <div className="h-3 bg-gray-100 rounded w-1/4" />
                    </div>
                  ))}
                </div>
              ) : carrier ? (
                <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-5 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    {carrier.legalName && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Legal name</p>
                        <p className="text-sm font-medium text-[#1A1A1A]">{carrier.legalName}</p>
                      </div>
                    )}
                    {carrier.dotNumber && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">DOT number</p>
                        <p className="text-sm font-medium text-[#1A1A1A]">{carrier.dotNumber}</p>
                      </div>
                    )}
                    {(carrier.usdotStatus || carrier.statusCode) && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Operating status</p>
                        <span
                          className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                            carrier.usdotStatus === "ACTIVE" || carrier.statusCode === "A"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {carrier.usdotStatus ?? carrier.statusCode}
                        </span>
                      </div>
                    )}
                    {carrier.totalPowerUnits !== undefined && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Power units</p>
                        <p className="text-sm font-medium text-[#1A1A1A]">{carrier.totalPowerUnits}</p>
                      </div>
                    )}
                    {carrier.totalDrivers !== undefined && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Drivers</p>
                        <p className="text-sm font-medium text-[#1A1A1A]">{carrier.totalDrivers}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-5 mb-6 text-center">
                  <p className="text-sm text-gray-500">
                    Carrier data could not be loaded. You can continue — your profile will be
                    pulled after activation.
                  </p>
                </div>
              )}

              <div className="rounded-xl bg-[#F5EDDB] border border-[#D9C48F] px-4 py-3 mb-6">
                <p className="text-xs text-[#8E7340]">
                  Your full BASIC score analysis will be available in your dashboard within 24
                  hours of subscribing.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-3 border border-[#E5E5E5] text-gray-600 font-medium rounded-xl hover:border-gray-300 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#A3221C] transition-colors"
                >
                  Continue to subscribe
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Subscribe ── */}
          {step === 4 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2">
                  Step 4 of {totalSteps}
                </p>
                <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">
                  Activate your account
                </h1>
                <p className="text-gray-600">
                  You selected the <strong>{selectedTierData.name}</strong> plan.
                </p>
              </div>

              {/* Plan summary */}
              <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-5 mb-6">
                <div className="flex items-baseline justify-between mb-4">
                  <p className="text-sm font-semibold text-[#1A1A1A]">{selectedTierData.name}</p>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-[#1A1A1A]">
                      {selectedTierData.price}
                    </span>
                    {selectedTierData.priceNote && (
                      <p className="text-xs text-gray-500">{selectedTierData.priceNote}</p>
                    )}
                  </div>
                </div>
                <ul className="space-y-2">
                  {selectedTierData.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-[#DC362E]/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 text-[#DC362E]" />
                      </div>
                      <span className="text-sm text-gray-700">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {checkoutError && (
                <div className="rounded-lg bg-[#F9E0DF] border border-[#DC362E]/20 px-4 py-3 mb-4">
                  <p className="text-sm text-[#DC362E]">{checkoutError}</p>
                </div>
              )}

              <button
                onClick={handleSubscribe}
                disabled={checkoutLoading}
                className="w-full py-3.5 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#A3221C] transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-base"
              >
                {checkoutLoading ? "Processing..." : "Subscribe and activate"}
              </button>

              <p className="text-xs text-center text-gray-400 mt-3">
                You&apos;ll be redirected to Stripe&apos;s secure checkout. Cancel anytime.
              </p>

              <button
                onClick={() => setStep(3)}
                className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
