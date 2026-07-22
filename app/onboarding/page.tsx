"use client";

import { useState, useEffect } from "react";
import { Check, ShieldCheck, ChevronRight, Eye, EyeOff } from "lucide-react";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";
import type { ClientTier } from "@/lib/supabase/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientData {
  id: string;
  name: string;
  dot_number: string;
  status: string;
  tier?: ClientTier | null;
  email?: string;
  primary_contact?: string;
  phone?: string;
  driver_count?: number | null;
  fmcsa_authorized?: boolean;
  eld_provider?: string | null;
  safety_contact_name?: string | null;
  safety_contact_email?: string | null;
  standing_authorization?: boolean;
}

interface CarrierData {
  legalName?: string;
  dotNumber?: string;
  totalPowerUnits?: number;
  totalDrivers?: number;
  usdotStatus?: string;
  statusCode?: string;
  phyCity?: string;
  phyState?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIERS: {
  value: ClientTier;
  name: string;
  price: string;
  priceNote?: string;
  features: string[];
  highlight?: boolean;
}[] = [
  {
    value: "assessment",
    name: "Assessment",
    price: "$299",
    priceNote: "one-time diagnostic",
    features: [
      "One-time FMCSA safety profile diagnostic",
      "Current violation and crash review",
      "Initial SafeScore assessment report",
    ],
  },
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

const VEHICLE_TYPES = [
  "Dry van", "Reefer", "Flatbed", "Tanker", "Auto hauler",
  "Lowboy / heavy haul", "Box truck", "Dump truck", "Other",
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STEP_LABELS = [
  "Confirm Company",
  "Fleet Profile",
  "Authorization",
  "Subscribe",
];

const TOTAL_STEPS = 4;

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [step, setStep] = useState(1);

  // Client / carrier data
  const [client, setClient] = useState<ClientData | null>(null);
  const [carrier, setCarrier] = useState<CarrierData | null>(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [loadingCarrier, setLoadingCarrier] = useState(false);

  // Step 1 — Contact info (merged with company confirm)
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Step 2 — Fleet profile
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([]);
  const [operatingStates, setOperatingStates] = useState<string[]>([]);
  const [operatingRadius, setOperatingRadius] = useState<"local" | "regional" | "otr" | "">("");
  const [driverCount, setDriverCount] = useState(0);
  const [eldProvider, setEldProvider] = useState("");
  const [safetyContactName, setSafetyContactName] = useState("");
  const [safetyContactEmail, setSafetyContactEmail] = useState("");

  // Step 3 — Authorization checkboxes
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [dataAccessChecked, setDataAccessChecked] = useState(false);
  const [dataqChecked, setDataqChecked] = useState(false);

  // Step 3 — FMCSA PIN
  const [pin, setPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);

  // Step 4 — Checkout
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Saving state
  const [savingProfile, setSavingProfile] = useState(false);

  // Assigned tier from client record (GEIA sets this)
  const assignedTier = normalizeClientTier(client?.tier);
  const assignedTierData = TIERS.find((t) => t.value === assignedTier) ?? TIERS[0];
  const hasCaseServices = tierHasFeature(assignedTier, "case_visibility");
  const hasRecurringSubscription = tierHasFeature(assignedTier, "monitoring_alerts");
  const hasDriverBilling = tierHasFeature(assignedTier, "compliance_layer");

  // ── Fetch client on mount ────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchClient() {
      try {
        const res = await fetch("/api/portal/me");
        const data = await res.json();
        if (data.client) {
          setClient(data.client);
          setContactName(data.client.primary_contact ?? "");
          setContactPhone(data.client.phone ?? "");
          setContactEmail(data.client.email ?? "");
          setDriverCount(data.client.driver_count ?? 0);
          setEldProvider(data.client.eld_provider ?? "");
          setSafetyContactName(data.client.safety_contact_name ?? data.client.primary_contact ?? "");
          setSafetyContactEmail(data.client.safety_contact_email ?? data.client.email ?? "");
          setDataAccessChecked(data.client.fmcsa_authorized === true);
          setDataqChecked(data.client.standing_authorization === true);
        }
      } catch { /* fail silently */ }
      finally { setLoadingClient(false); }
    }
    fetchClient();
  }, []);

  // ── Fetch carrier from FMCSA when client is loaded ───────────────────────────

  useEffect(() => {
    if (client?.dot_number && !carrier && !loadingCarrier) {
      setLoadingCarrier(true);
      fetch(`/api/fmcsa/carrier/${client.dot_number}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => setCarrier(data?.carrier ?? null))
        .catch(() => setCarrier(null))
        .finally(() => setLoadingCarrier(false));
    }
  }, [client, carrier, loadingCarrier]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toggleVehicleType(v: string) {
    setVehicleTypes((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }

  function toggleState(s: string) {
    setOperatingStates((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await fetch("/api/portal/onboarding-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName,
          contactTitle,
          contactPhone,
          contactEmail,
          vehicleTypes,
          operatingStates,
          operatingRadius: operatingRadius || undefined,
          driverCount,
          eldProvider,
          safetyContactName,
          safetyContactEmail,
        }),
      });
    } catch { /* non-fatal */ }
    finally { setSavingProfile(false); }
  }

  async function saveAgreement() {
    try {
      await fetch("/api/portal/onboarding-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceAgreementAccepted: true }),
      });
    } catch { /* non-fatal */ }
  }

  async function saveFilingAuthorization() {
    if (!hasCaseServices || !dataqChecked) return;
    const signer = `${contactName}${contactTitle ? ", " + contactTitle : ""}`;
    try {
      await fetch("/api/portal/onboarding-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filingAuthorized: true,
          filingAuthorizedBy: signer,
          standingAuthorization: true,
        }),
      });
    } catch { /* non-fatal */ }
  }

  async function saveFmcsaAccess() {
    try {
      await fetch("/api/portal/fmcsa-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() || undefined, authorized: dataAccessChecked }),
      });
    } catch { /* non-fatal */ }
  }

  async function handleSubscribe() {
    if (!hasRecurringSubscription) {
      setCheckoutError(
        "Assessment is a one-time diagnostic and does not use recurring subscription checkout."
      );
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: assignedTier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setCheckoutError("Network error. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  // ── Can-proceed guards ────────────────────────────────────────────────────────

  const canProceedStep1 =
    !loadingClient && !!client && contactName.trim().length > 0 && contactPhone.trim().length > 0;

  const canProceedStep2 =
    vehicleTypes.length > 0 && operatingStates.length > 0 && operatingRadius !== "";

  const canProceedStep3 =
    agreementChecked &&
    dataAccessChecked &&
    (hasCaseServices ? dataqChecked : true);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#FEFCF8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">

        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                    s < step
                      ? "bg-[#C67A1E] text-white"
                      : s === step
                      ? "bg-[#C67A1E] text-white ring-4 ring-[#C67A1E]/20"
                      : "bg-[#F0E8DA] text-[#8B8178]"
                  }`}
                >
                  {s < step ? <Check className="w-3.5 h-3.5" /> : s}
                </div>
                <span className={`text-[10px] hidden sm:block ${s === step ? "text-[#C67A1E] font-medium" : "text-[#8B8178]"}`}>
                  {STEP_LABELS[s - 1]}
                </span>
              </div>
              {s < TOTAL_STEPS && (
                <div className={`w-8 sm:w-12 h-0.5 mb-4 ${s < step ? "bg-[#C67A1E]" : "bg-[#F0E8DA]"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm overflow-hidden">

          {/* ── Step 1: Confirm Company + Contact Info ───────────────────────────── */}
          {step === 1 && (
            <div className="p-8">
              <p className="mono-label text-[#C67A1E] mb-3">Step 1 of {TOTAL_STEPS} — Confirm Company</p>
              <h1 className="text-2xl font-bold text-[#1E1C1A] mb-2">Welcome to SafeScore</h1>
              <p className="text-[#5C554E] leading-relaxed mb-6">
                Confirm your carrier and tell us who we&apos;ll be working with.
              </p>

              {/* Carrier card */}
              {loadingClient || loadingCarrier ? (
                <div className="rounded-xl bg-[#FEFCF8] border border-[#F0E8DA] p-5 mb-6 space-y-3 animate-pulse">
                  <div className="h-4 bg-[#F0E8DA] rounded w-2/3" />
                  <div className="h-3 bg-[#F0E8DA] rounded w-1/3" />
                  <div className="h-3 bg-[#F0E8DA] rounded w-1/2" />
                </div>
              ) : carrier ? (
                <div className="rounded-xl bg-[#FEFCF8] border border-[#F0E8DA] p-5 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <p className="mono-label text-[#8B8178] mb-1">Legal name</p>
                      <p className="font-bold text-[#1E1C1A] text-base">{carrier.legalName ?? client?.name}</p>
                    </div>
                    <div>
                      <p className="mono-label text-[#8B8178] mb-1">USDOT</p>
                      <p className="text-sm font-medium text-[#1E1C1A]">{carrier.dotNumber ?? client?.dot_number}</p>
                    </div>
                    {carrier.phyCity && (
                      <div>
                        <p className="mono-label text-[#8B8178] mb-1">Location</p>
                        <p className="text-sm font-medium text-[#1E1C1A]">{carrier.phyCity}, {carrier.phyState}</p>
                      </div>
                    )}
                    <div>
                      <p className="mono-label text-[#8B8178] mb-1">Power units</p>
                      <p className="text-sm font-medium text-[#1E1C1A]">{carrier.totalPowerUnits ?? "—"}</p>
                    </div>
                    <div>
                      <p className="mono-label text-[#8B8178] mb-1">Drivers</p>
                      <p className="text-sm font-medium text-[#1E1C1A]">{carrier.totalDrivers ?? "—"}</p>
                    </div>
                    <div>
                      <p className="mono-label text-[#8B8178] mb-1">Status</p>
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        carrier.usdotStatus === "ACTIVE" || carrier.statusCode === "A"
                          ? "bg-[#E8F3EC] text-[#3D7A52]"
                          : "bg-[#F0E8DA] text-[#8B8178]"
                      }`}>
                        {carrier.usdotStatus ?? carrier.statusCode ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : client ? (
                <div className="rounded-xl bg-[#FEFCF8] border border-[#F0E8DA] p-5 mb-6">
                  <p className="mono-label text-[#8B8178] mb-1">Company</p>
                  <p className="font-bold text-[#1E1C1A]">{client.name}</p>
                  <p className="text-sm text-[#8B8178] mt-1">DOT {client.dot_number}</p>
                </div>
              ) : (
                <div className="rounded-xl bg-[#FDF4E7] border border-[#C67A1E]/20 p-4 mb-6">
                  <p className="text-sm text-[#C67A1E]">
                    Your account is still being set up. Contact your GEIA account manager.
                  </p>
                </div>
              )}

              {/* Contact info */}
              <div className="space-y-4 mb-6">
                <p className="text-sm font-semibold text-[#1E1C1A]">Your contact information</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mono-label text-[#5C554E] mb-1.5">Full name *</label>
                    <input
                      type="text"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Jane Smith"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm text-[#1E1C1A] focus:outline-none focus:ring-2 focus:ring-[#C67A1E]/30 focus:border-[#C67A1E] transition-colors placeholder:text-[#8B8178]"
                    />
                  </div>
                  <div>
                    <label className="block mono-label text-[#5C554E] mb-1.5">Title / role</label>
                    <input
                      type="text"
                      value={contactTitle}
                      onChange={(e) => setContactTitle(e.target.value)}
                      placeholder="Owner / Safety Director"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm text-[#1E1C1A] focus:outline-none focus:ring-2 focus:ring-[#C67A1E]/30 focus:border-[#C67A1E] transition-colors placeholder:text-[#8B8178]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block mono-label text-[#5C554E] mb-1.5">Phone number *</label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="(555) 555-5555"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm text-[#1E1C1A] focus:outline-none focus:ring-2 focus:ring-[#C67A1E]/30 focus:border-[#C67A1E] transition-colors placeholder:text-[#8B8178]"
                  />
                </div>
                <div>
                  <label className="block mono-label text-[#5C554E] mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={contactEmail}
                    readOnly
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#F5F3F0] text-sm text-[#8B8178] cursor-not-allowed"
                    tabIndex={-1}
                  />
                  <p className="text-xs text-[#8B8178] mt-1">Used for case updates and report delivery.</p>
                </div>
              </div>

              <button
                onClick={() => {
                  // Bug 3 fix: persist carrier profile to DB on confirmation (fire-and-forget)
                  if (client?.id) {
                    void fetch(`/api/clients/${client.id}/carrier-profile`, { method: "POST" })
                      .catch(() => {}); // non-fatal — auto-fetch on creation is the primary path
                  }
                  setStep(2);
                }}
                disabled={!canProceedStep1}
                className="w-full py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                This is correct — continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── Step 2: Fleet Profile ────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="p-8">
              <p className="mono-label text-[#C67A1E] mb-3">Step 2 of {TOTAL_STEPS} — Fleet Profile</p>
              <h1 className="text-2xl font-bold text-[#1E1C1A] mb-2">Tell us about your fleet</h1>
              <p className="text-[#5C554E] leading-relaxed mb-6">
                This helps us tailor your safety reports and identify the right violations to challenge.
              </p>

              <div className="space-y-6 mb-6">
                {/* Vehicle types */}
                <div>
                  <label className="block mono-label text-[#5C554E] mb-2">Equipment types *</label>
                  <div className="flex flex-wrap gap-2">
                    {VEHICLE_TYPES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => toggleVehicleType(v)}
                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                          vehicleTypes.includes(v)
                            ? "bg-[#C67A1E] border-[#C67A1E] text-white"
                            : "bg-[#FEFCF8] border-[#F0E8DA] text-[#5C554E] hover:border-[#C67A1E]/40"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Operating radius */}
                <div>
                  <label className="block mono-label text-[#5C554E] mb-2">Operating radius *</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(["local", "regional", "otr"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setOperatingRadius(r)}
                        className={`py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                          operatingRadius === r
                            ? "border-[#C67A1E] bg-[#FDF4E7] text-[#C67A1E]"
                            : "border-[#F0E8DA] bg-[#FEFCF8] text-[#5C554E] hover:border-[#C67A1E]/40"
                        }`}
                      >
                        {r === "local" ? "Local" : r === "regional" ? "Regional" : "OTR"}
                        <p className="text-[10px] font-normal text-[#8B8178] mt-0.5">
                          {r === "local" ? "0–150 mi" : r === "regional" ? "150–500 mi" : "500+ mi"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Operating states */}
                <div>
                  <label className="block mono-label text-[#5C554E] mb-2">
                    States of operation *
                    {operatingStates.length > 0 && (
                      <span className="ml-2 text-[#C67A1E]">{operatingStates.length} selected</span>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1">
                    {US_STATES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleState(s)}
                        className={`w-10 h-8 rounded-md border text-xs font-semibold transition-all ${
                          operatingStates.includes(s)
                            ? "bg-[#C67A1E] border-[#C67A1E] text-white"
                            : "bg-[#FEFCF8] border-[#F0E8DA] text-[#5C554E] hover:border-[#C67A1E]/40"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block mono-label text-[#5C554E] mb-2">Billing driver count *</label>
                    <input type="number" min={0} max={10000} value={driverCount} onChange={(e) => setDriverCount(Math.max(0, Number.parseInt(e.target.value || "0", 10)))} className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm" />
                    <p className="mt-1 text-xs text-[#8B8178]">Your editable count drives billing. FMCSA&apos;s MCS-150 count is reference only.</p>
                  </div>
                  <div>
                    <label className="block mono-label text-[#5C554E] mb-2">ELD provider</label>
                    <input type="text" value={eldProvider} onChange={(e) => setEldProvider(e.target.value)} placeholder="Provider name or none" className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm" />
                  </div>
                  <div>
                    <label className="block mono-label text-[#5C554E] mb-2">Safety contact name</label>
                    <input type="text" value={safetyContactName} onChange={(e) => setSafetyContactName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm" />
                  </div>
                  <div>
                    <label className="block mono-label text-[#5C554E] mb-2">Safety contact email</label>
                    <input type="email" value={safetyContactEmail} onChange={(e) => setSafetyContactEmail(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] text-sm" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 py-3 border border-[#F0E8DA] text-[#5C554E] font-medium rounded-xl hover:border-[#C67A1E]/40 transition-colors">
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!canProceedStep2}
                  className="flex-1 py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
              <button
                onClick={() => setStep(3)}
                className="w-full mt-3 py-2 text-sm text-[#8B8178] hover:text-[#5C554E] transition-colors"
              >
                I&apos;ll do this later →
              </button>
            </div>
          )}

          {/* ── Step 3: Authorization + FMCSA PIN ───────────────────────────────── */}
          {step === 3 && (
            <div className="p-8">
              <p className="mono-label text-[#C67A1E] mb-3">Step 3 of {TOTAL_STEPS} — Authorization</p>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-5 h-5 text-[#C67A1E] shrink-0" />
                <h1 className="text-2xl font-bold text-[#1E1C1A]">Before we activate</h1>
              </div>
              <p className="text-[#5C554E] leading-relaxed mb-6">
                We need your authorization to access your FMCSA data and act on your behalf.
              </p>

              {/* Authorization checkboxes */}
              <div className="space-y-3 mb-6">
                <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] hover:border-[#C67A1E]/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={agreementChecked}
                    onChange={(e) => setAgreementChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-[#F0E8DA] accent-[#C67A1E] shrink-0"
                  />
                  <span className="text-sm text-[#1E1C1A] leading-snug">
                    <strong>Service agreement</strong> — I agree to Golden Era Insurance Agency&apos;s{" "}
                    <span className="text-[#C67A1E] underline cursor-pointer">terms of service</span>{" "}
                    and authorize GEIA to provide SafeScore services to my carrier.
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] hover:border-[#C67A1E]/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={dataAccessChecked}
                    onChange={(e) => setDataAccessChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-[#F0E8DA] accent-[#C67A1E] shrink-0"
                  />
                  <span className="text-sm text-[#1E1C1A] leading-snug">
                    <strong>FMCSA data access</strong> — I authorize Golden Era Insurance Agency to access my carrier&apos;s FMCSA safety data, including BASIC scores, violations, inspections, and crash records.
                  </span>
                </label>

                {hasCaseServices && (
                  <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-[#F0E8DA] bg-[#FEFCF8] hover:border-[#C67A1E]/30 transition-colors">
                    <input
                      type="checkbox"
                      checked={dataqChecked}
                      onChange={(e) => setDataqChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-[#F0E8DA] accent-[#C67A1E] shrink-0"
                    />
                    <span className="text-sm text-[#1E1C1A] leading-snug">
                      <strong>DataQ filing authorization</strong> - I authorize Golden Era Insurance Agency to access my FMCSA data and to submit Requests for Data Review (DataQs) and Crash Preventability Determination (CPDP) requests to FMCSA on this carrier&apos;s behalf. I understand FMCSA notifies the carrier&apos;s officials of any request filed on its USDOT number.
                      <span className="block text-xs text-[#8B8178] mt-2">
                        Authorization wording is subject to GEIA review.
                      </span>
                    </span>
                  </label>
                )}
              </div>

              {/* FMCSA PIN */}
              <div className="border-t border-[#F0E8DA] pt-6 mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-4 h-4 text-[#C67A1E]" />
                  <p className="text-sm font-semibold text-[#1E1C1A]">FMCSA Portal PIN <span className="font-normal text-[#8B8178]">(optional)</span></p>
                </div>
                <p className="text-sm text-[#5C554E] mb-4">
                  {hasCaseServices
                    ? "To file DataQ disputes on your behalf, we need your FMCSA portal PIN. You can also add this later in Settings."
                    : "A Portal PIN is not required for your current service. You can add one later if you upgrade to managed DataQ and CPDP filing."}
                </p>

                <div className="bg-[#E8ECF2] border border-[#1B2D4F]/10 rounded-xl px-4 py-3 mb-4 text-sm text-[#2A4270]">
                  <strong>Where to find your PIN:</strong> Log in to the{" "}
                  <span className="font-mono text-xs">ai.fmcsa.dot.gov</span> portal and look under your profile settings.
                </div>

                <div>
                  <label className="mono-label block text-[#8B8178] mb-2">FMCSA Portal PIN</label>
                  <div className="relative">
                    <input
                      type={pinVisible ? "text" : "password"}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Enter PIN"
                      maxLength={30}
                      className="w-full px-4 py-3 pr-12 border border-[#F0E8DA] rounded-xl bg-white text-[#1E1C1A] font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#C67A1E]/30 focus:border-[#C67A1E] placeholder:text-[#D4C9BC] placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setPinVisible((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B8178] hover:text-[#5C554E]"
                    >
                      {pinVisible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 py-3 border border-[#F0E8DA] text-[#5C554E] font-medium rounded-xl hover:border-[#C67A1E]/40 transition-colors">
                  Back
                </button>
                <button
                  onClick={async () => {
                    await saveProfile();
                    await saveAgreement();
                    if (hasCaseServices && dataqChecked) await saveFilingAuthorization();
                    await saveFmcsaAccess();
                    setStep(4);
                  }}
                  disabled={!canProceedStep3 || savingProfile}
                  className="flex-1 py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingProfile ? "Saving..." : "I agree — continue"}
                </button>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await saveProfile();
                  if (agreementChecked) await saveAgreement();
                  setStep(4);
                }}
                disabled={!agreementChecked || savingProfile}
                className="w-full mt-3 py-2 text-sm text-[#8B8178] hover:text-[#5C554E] transition-colors disabled:opacity-40"
              >
                Complete FMCSA access later
              </button>
            </div>
          )}

          {/* ── Step 4: Confirm & Subscribe ──────────────────────────────────────── */}
          {step === 4 && (
            <div className="p-8">
              {hasRecurringSubscription ? (
                <p className="mono-label text-[#C67A1E] mb-3">Step 4 of {TOTAL_STEPS} — Subscribe</p>
              ) : (
                <p className="mono-label text-[#C67A1E] mb-3">
                  Step 4 of {TOTAL_STEPS} {"\u2014"} Activate
                </p>
              )}
              <h1 className="text-2xl font-bold text-[#1E1C1A] mb-2">Confirm and activate</h1>
              <p className="text-[#5C554E] mb-6">
                Your GEIA account manager has selected the{" "}
                <strong>{assignedTierData.name}</strong> service for your carrier.
              </p>

              {/* Plan summary */}
              {(() => {
                const billingDriverCount = driverCount;
                const estimatedMonthly =
                  hasDriverBilling
                    ? 999 + billingDriverCount * 29
                    : null;

                return (
                  <div className="rounded-xl bg-[#FEFCF8] border border-[#F0E8DA] p-5 mb-4">
                    <div className="flex items-baseline justify-between mb-4">
                      <div>
                        <p className="font-bold text-[#1E1C1A]">{assignedTierData.name}</p>
                        {assignedTierData.highlight && (
                          <span className="text-xs font-semibold bg-[#C67A1E] text-white px-2 py-0.5 rounded-full mt-1 inline-block">
                            Most popular
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-[#1E1C1A]">{assignedTierData.price}</span>
                        {assignedTierData.priceNote && (
                          <p className="text-xs text-[#8B8178]">{assignedTierData.priceNote}</p>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-2 mb-4">
                      {assignedTierData.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-[#C67A1E]/10 flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-2.5 h-2.5 text-[#C67A1E]" />
                          </div>
                          <span className="text-sm text-[#5C554E]">{f}</span>
                        </li>
                      ))}
                    </ul>
                    {/* Total Safety cost breakdown */}
                    {hasDriverBilling && estimatedMonthly != null && (
                      <div className="border-t border-[#F0E8DA] pt-3 space-y-1.5">
                        <div className="flex justify-between text-xs text-[#5C554E]">
                          <span>Base plan</span>
                          <span>$999/mo</span>
                        </div>
                        <div className="flex justify-between text-xs text-[#5C554E]">
                          <span>{billingDriverCount} driver{billingDriverCount === 1 ? "" : "s"} × $29</span>
                          <span>${(billingDriverCount * 29).toLocaleString()}/mo</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[#F0E8DA]">
                          <span className="text-[#1E1C1A]">Estimated total</span>
                          <span className="text-[#C67A1E]">${estimatedMonthly.toLocaleString()}/mo</span>
                        </div>
                        <p className="text-[10px] text-[#8B8178]">
                          Billing uses your editable count. FMCSA reference: {carrier?.totalDrivers ?? "not available"} drivers.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Contact summary */}
              {(contactName || contactPhone) && (
                <div className="rounded-xl bg-[#FEFCF8] border border-[#F0E8DA] p-4 mb-6 text-sm">
                  <p className="mono-label text-[#8B8178] mb-2">Your info</p>
                  <p className="text-[#1E1C1A]">{contactName}{contactTitle ? ` · ${contactTitle}` : ""}</p>
                  {contactPhone && <p className="text-[#5C554E]">{contactPhone}</p>}
                  {vehicleTypes.length > 0 && (
                    <p className="text-[#5C554E] mt-1">{vehicleTypes.slice(0, 3).join(", ")}{vehicleTypes.length > 3 ? ` +${vehicleTypes.length - 3} more` : ""}</p>
                  )}
                  <button onClick={() => setStep(1)} className="text-[#C67A1E] text-xs hover:underline mt-1">
                    Edit
                  </button>
                </div>
              )}

              {checkoutError && (
                <div className="rounded-lg bg-[#FAECEB] border border-[#B83B32]/20 px-4 py-3 mb-4">
                  <p className="text-sm text-[#B83B32]">{checkoutError}</p>
                </div>
              )}

              {hasRecurringSubscription ? (
                <>
                  <button
                    onClick={handleSubscribe}
                    disabled={checkoutLoading}
                    className="w-full py-3.5 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-base"
                  >
                    {checkoutLoading ? "Processing..." : "Subscribe and activate →"}
                  </button>
                  <p className="text-xs text-center text-[#8B8178] mt-3">
                    Redirects to Stripe&apos;s secure checkout. Cancel anytime.
                  </p>
                </>
              ) : (
                <div className="rounded-xl border border-[#C67A1E]/20 bg-[#FDF4E7] p-4">
                  <p className="text-sm font-semibold text-[#1E1C1A]">
                    One-time assessment activation
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[#5C554E]">
                    The $299 Assessment is a one-time diagnostic, not a recurring subscription.
                    No subscription checkout will be opened. GEIA will confirm the one-time
                    assessment activation and payment separately.
                  </p>
                  <a
                    href="/portal"
                    className="mt-4 block w-full rounded-xl bg-[#C67A1E] py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#B86E18]"
                  >
                    Continue to portal {"\u2192"}
                  </a>
                </div>
              )}

              <button onClick={() => setStep(3)} className="w-full mt-3 py-2 text-sm text-[#8B8178] hover:text-[#5C554E] transition-colors">
                Back
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
