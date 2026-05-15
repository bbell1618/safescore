"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, ShieldCheck, ChevronRight, Eye, EyeOff } from "lucide-react";

type Stage = "syncing" | "pin" | "done" | "error";

function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");

  const [stage, setStage] = useState<Stage>("syncing");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStage("pin");
      return;
    }
    attemptSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function attemptSync() {
    setSyncError(null);
    try {
      const r = await fetch("/api/billing/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await r.json();
      if (data.success) {
        setStage("pin");
      } else {
        setSyncError(data.error ?? "Activation failed. Please contact support.");
        setStage("error");
      }
    } catch {
      setSyncError("Network error — please try again.");
      setStage("error");
    }
  }

  async function savePin() {
    if (!pin.trim()) {
      setPinError("Please enter your FMCSA PIN.");
      return;
    }
    if (!/^\d{4,8}$/.test(pin.trim())) {
      setPinError("PIN should be 4–8 digits.");
      return;
    }
    setPinError(null);
    setPinSaving(true);
    try {
      const r = await fetch("/api/portal/fmcsa-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim(), authorized: true }),
      });
      const data = await r.json();
      if (data.success) {
        setStage("done");
      } else {
        setPinError(data.error ?? "Failed to save PIN. You can add it later in Settings.");
      }
    } catch {
      setPinError("Network error — PIN not saved. You can add it later in Settings.");
    } finally {
      setPinSaving(false);
    }
  }

  if (stage === "syncing") {
    return (
      <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-10 text-center">
        <div className="flex justify-center mb-5">
          <CheckCircle className="w-16 h-16 text-[#3D7A52]" />
        </div>
        <div className="w-full py-3 bg-[#F0E8DA] rounded-xl text-center text-sm text-[#8B8178]">
          Activating your account…
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-10 text-center">
        <div className="flex justify-center mb-5">
          <CheckCircle className="w-16 h-16 text-[#3D7A52]" />
        </div>
        <div className="space-y-3">
          <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-4 py-3 text-sm text-[#B83B32]">
            {syncError}
          </div>
          <button
            onClick={attemptSync}
            className="w-full py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors"
          >
            Retry activation
          </button>
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-10 text-center">
        <div className="flex justify-center mb-5">
          <CheckCircle className="w-16 h-16 text-[#3D7A52]" />
        </div>
        <h1 className="font-heading text-2xl font-bold text-[#1B2D4F] mb-3">
          You&apos;re all set!
        </h1>
        <p className="text-[#5C554E] leading-relaxed mb-8">
          Your SafeScore account is active. Your first safety assessment will be
          ready within 24 hours. We&apos;ll email you as soon as it&apos;s complete.
        </p>
        <button
          onClick={() => router.push("/portal")}
          className="inline-flex items-center justify-center gap-2 w-full py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors"
        >
          Go to Dashboard <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // stage === "pin"
  return (
    <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-8">
      <div className="flex justify-center mb-5">
        <div className="w-16 h-16 rounded-full bg-[#FDF4E7] flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-[#C67A1E]" />
        </div>
      </div>

      <h1 className="font-heading text-2xl font-bold text-[#1B2D4F] mb-2 text-center">
        One last thing
      </h1>
      <p className="text-[#5C554E] text-sm leading-relaxed mb-6 text-center">
        Your account is active. To file DataQ disputes and access the FMCSA
        Safety Measurement System on your behalf, we need your FMCSA portal PIN.
      </p>

      <div className="bg-[#E8ECF2] border border-[#1B2D4F]/10 rounded-xl px-4 py-3 mb-6 text-sm text-[#2A4270]">
        <strong>Where to find your PIN:</strong> Log in to the{" "}
        <span className="font-mono text-xs">ai.fmcsa.dot.gov</span> portal and
        look under your profile settings, or contact the FMCSA help desk at
        1-800-832-5660.
      </div>

      <div className="mb-4">
        <label className="mono-label block text-[#8B8178] mb-2">FMCSA Portal PIN</label>
        <div className="relative">
          <input
            type={pinVisible ? "text" : "password"}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ""));
              setPinError(null);
            }}
            placeholder="••••••"
            className="w-full px-4 py-3 pr-12 border border-[#F0E8DA] rounded-xl bg-white text-[#1E1C1A] font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#C67A1E]/30 focus:border-[#C67A1E] placeholder:text-[#D4C9BC] placeholder:tracking-normal"
          />
          <button
            type="button"
            onClick={() => setPinVisible((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B8178] hover:text-[#5C554E]"
          >
            {pinVisible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
        {pinError && (
          <p className="mt-2 text-sm text-[#B83B32]">{pinError}</p>
        )}
      </div>

      <button
        onClick={savePin}
        disabled={pinSaving}
        className="w-full py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
      >
        {pinSaving ? "Saving…" : "Save PIN & Continue"}
      </button>

      <button
        onClick={() => setStage("done")}
        className="w-full py-2 text-sm text-[#8B8178] hover:text-[#5C554E] transition-colors"
      >
        Skip for now — I&apos;ll add this in Settings
      </button>
    </div>
  );
}

export default function OnboardingSuccessPage() {
  return (
    <div className="min-h-screen bg-[#FEFCF8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="mono-label text-[#C67A1E]">SafeScore</span>
        </div>
        <Suspense
          fallback={
            <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-10 text-center">
              <div className="flex justify-center mb-5">
                <CheckCircle className="w-16 h-16 text-[#3D7A52]" />
              </div>
              <div className="w-full py-3 bg-[#F0E8DA] rounded-xl text-center text-sm text-[#8B8178]">
                Activating your account…
              </div>
            </div>
          }
        >
          <SuccessContent />
        </Suspense>
      </div>
    </div>
  );
}
