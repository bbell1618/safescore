"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";

function ActivationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function activate() {
      if (!sessionId) {
        router.replace("/portal");
        return;
      }
      try {
        const r = await fetch("/api/billing/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await r.json();
        if (data.success) {
          router.replace("/portal");
        } else {
          setError(data.error ?? "Activation failed. Please contact support.");
        }
      } catch {
        setError("Network error — please try again.");
      }
    }
    activate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (error) {
    return (
      <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-10 text-center">
        <div className="flex justify-center mb-5">
          <CheckCircle className="w-16 h-16 text-[#3D7A52]" />
        </div>
        <div className="space-y-3">
          <div className="bg-[#FAECEB] border border-[#B83B32]/20 rounded-lg px-4 py-3 text-sm text-[#B83B32]">
            {error}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-[#C67A1E] text-white font-semibold rounded-xl hover:bg-[#B86E18] transition-colors"
          >
            Retry activation
          </button>
        </div>
      </div>
    );
  }

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

const LoadingCard = () => (
  <div className="bg-[#FBF7F0] rounded-2xl border border-[#F0E8DA] shadow-sm p-10 text-center">
    <div className="flex justify-center mb-5">
      <CheckCircle className="w-16 h-16 text-[#3D7A52]" />
    </div>
    <div className="w-full py-3 bg-[#F0E8DA] rounded-xl text-center text-sm text-[#8B8178]">
      Activating your account…
    </div>
  </div>
);

export default function OnboardingSuccessPage() {
  return (
    <div className="min-h-screen bg-[#FEFCF8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="mono-label text-[#C67A1E]">SafeScore</span>
        </div>
        <Suspense fallback={<LoadingCard />}>
          <ActivationContent />
        </Suspense>
      </div>
    </div>
  );
}
