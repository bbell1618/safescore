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

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [client, setClient] = useState<ClientData | null>(null);
  const [carrier, setCarrier] = useState<CarrierData | null>(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [loadingCarrier, setLoadingCarrier] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Load client data on mount
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

  // Load carrier data when moving to step 2
  useEffect(() => {
    if (step === 2 && client?.dot_number && !carrier) {
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

  const steps = [1, 2, 3];

  return (
    <div className="min-h-screen bg-[#F8F8F8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Progress indicators */}
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
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                {s < step ? <Check className="w-4 h-4" /> : s}
              </div>
              {s < steps.length && (
                <div
                  className={`w-16 h-0.5 ${
                    s < step ? "bg-[#DC362E]" : "bg-[#E5E5E5]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[#E5E5E5] shadow-sm overflow-hidden">
          {/* Step 1 — Welcome */}
          {step === 1 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2"
                   style={{ fontFamily: "var(--font-montserrat)" }}>
                  Step 1 of 3
                </p>
                <h1
                  className="text-2xl font-bold text-[#222222] mb-3"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  Welcome to SafeScore
                </h1>
                <p className="text-gray-600 leading-relaxed">
                  We're going to walk you through your current DOT safety
                  profile and get your account set up.
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
                  <p
                    className="text-base font-bold text-[#222222]"
                    style={{ fontFamily: "var(--font-montserrat)" }}
                  >
                    {client.name}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    DOT {client.dot_number}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-6">
                  <p className="text-sm text-amber-700">
                    Your account is still being set up. Contact your GEIA
                    account manager if you need assistance.
                  </p>
                </div>
              )}

              <button
                onClick={() => setStep(2)}
                disabled={loadingClient}
                className="w-full py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#b52a23] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                Continue
              </button>
            </div>
          )}

          {/* Step 2 — Safety Profile */}
          {step === 2 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2"
                   style={{ fontFamily: "var(--font-montserrat)" }}>
                  Step 2 of 3
                </p>
                <h1
                  className="text-2xl font-bold text-[#222222] mb-3"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  Your Safety Profile
                </h1>
                <p className="text-gray-600 leading-relaxed">
                  Here is a snapshot of your carrier data from FMCSA. Your
                  full BASIC score analysis will be available in your dashboard
                  within 24 hours of subscribing.
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
                        <p className="text-sm font-medium text-[#222222]">
                          {carrier.legalName}
                        </p>
                      </div>
                    )}
                    {carrier.dotNumber && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">DOT number</p>
                        <p className="text-sm font-medium text-[#222222]">
                          {carrier.dotNumber}
                        </p>
                      </div>
                    )}
                    {(carrier.usdotStatus || carrier.statusCode) && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">
                          Operating status
                        </p>
                        <span
                          className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                            carrier.usdotStatus === "ACTIVE" ||
                            carrier.statusCode === "A"
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
                        <p className="text-xs text-gray-400 mb-0.5">
                          Power units
                        </p>
                        <p className="text-sm font-medium text-[#222222]">
                          {carrier.totalPowerUnits}
                        </p>
                      </div>
                    )}
                    {carrier.totalDrivers !== undefined && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Drivers</p>
                        <p className="text-sm font-medium text-[#222222]">
                          {carrier.totalDrivers}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-5 mb-6 text-center">
                  <p className="text-sm text-gray-500">
                    Carrier data could not be loaded. You can continue to
                    subscribe — your profile will be pulled after activation.
                  </p>
                </div>
              )}

              <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 mb-6">
                <p className="text-xs text-blue-700">
                  Your full BASIC score analysis will be available in your
                  dashboard within 24 hours of subscribing.
                </p>
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
                  className="flex-1 py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#b52a23] transition-colors"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  Continue to Subscribe
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Subscribe */}
          {step === 3 && (
            <div className="p-8">
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#DC362E] uppercase tracking-widest mb-2"
                   style={{ fontFamily: "var(--font-montserrat)" }}>
                  Step 3 of 3
                </p>
                <h1
                  className="text-2xl font-bold text-[#222222] mb-3"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  Activate Your SafeScore Account
                </h1>
                <p className="text-gray-600">
                  Everything you need to manage your DOT safety score.
                </p>
              </div>

              {/* What's included */}
              <div className="rounded-xl bg-[#F8F8F8] border border-[#E5E5E5] p-5 mb-6">
                <p
                  className="text-xs font-semibold text-[#222222] uppercase tracking-widest mb-4"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  What's included
                </p>
                <ul className="space-y-2.5">
                  {[
                    "Full BASIC score monitoring and analysis",
                    "AI-powered violation challengeability assessment",
                    "DataQ case management and filing support",
                    "CPDP crash preventability review",
                    "Monthly safety reports",
                    "Direct support from GEIA safety specialists",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-[#DC362E]/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 text-[#DC362E]" />
                      </div>
                      <span className="text-sm text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Pricing */}
              <div className="flex items-baseline gap-1 mb-6">
                <span
                  className="text-4xl font-bold text-[#222222]"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  $299
                </span>
                <span className="text-gray-500 text-sm">/month</span>
              </div>

              {checkoutError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mb-4">
                  <p className="text-sm text-[#DC362E]">{checkoutError}</p>
                </div>
              )}

              <button
                onClick={handleSubscribe}
                disabled={checkoutLoading}
                className="w-full py-3.5 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#b52a23] transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-base"
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                {checkoutLoading ? "Processing..." : "Subscribe Now"}
              </button>

              <p className="text-xs text-center text-gray-400 mt-3">
                You'll be redirected to Stripe's secure checkout. Cancel
                anytime.
              </p>

              <button
                onClick={() => setStep(2)}
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
