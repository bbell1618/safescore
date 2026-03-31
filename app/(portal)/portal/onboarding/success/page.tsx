"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");

  const [synced, setSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      // No session_id in URL — navigate immediately (direct nav or already synced)
      setSynced(true);
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
        setSynced(true);
      } else {
        setSyncError(data.error ?? "Activation failed. Please contact support.");
      }
    } catch {
      setSyncError("Network error — please try again.");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E5E5E5] shadow-sm p-10 text-center">
      <div className="flex justify-center mb-5">
        <CheckCircle className="w-16 h-16 text-green-500" />
      </div>

      <h1 className="text-2xl font-bold text-[#1A1A1A] mb-3">
        You're all set!
      </h1>

      <p className="text-gray-600 leading-relaxed mb-8">
        Your SafeScore account is now active. Your first safety assessment
        is being prepared and will be ready within 24 hours.
      </p>

      {syncError ? (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-[#DC362E]">
            {syncError}
          </div>
          <button
            onClick={attemptSync}
            className="w-full py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#b52a23] transition-colors"
          >
            Retry activation
          </button>
        </div>
      ) : synced ? (
        <button
          onClick={() => router.push("/portal")}
          className="inline-block w-full py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#b52a23] transition-colors text-center"
        >
          Go to Dashboard
        </button>
      ) : (
        <div className="w-full py-3 bg-[#E5E5E5] rounded-xl text-center text-sm text-gray-400">
          Activating your account…
        </div>
      )}
    </div>
  );
}

export default function OnboardingSuccessPage() {
  return (
    <div className="min-h-screen bg-[#F8F8F8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Suspense
          fallback={
            <div className="bg-white rounded-2xl border border-[#E5E5E5] shadow-sm p-10 text-center">
              <div className="flex justify-center mb-5">
                <CheckCircle className="w-16 h-16 text-green-500" />
              </div>
              <div className="w-full py-3 bg-[#E5E5E5] rounded-xl text-center text-sm text-gray-400">
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
