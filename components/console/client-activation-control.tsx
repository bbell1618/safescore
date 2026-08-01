"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClientActivationControl({
  clientId,
  status,
  tier,
}: {
  clientId: string;
  status: string | null;
  tier: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "awaiting_activation" || tier !== "assessment") return null;

  async function activate() {
    if (
      !window.confirm(
        "Confirm that GEIA received the Assessment payment and activate portal access?"
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${clientId}/activate`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? `Activation failed with HTTP ${response.status}`
        );
      }
      router.refresh();
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Unknown activation failure"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
        Assessment awaiting activation
      </p>
      <h2 className="mt-1 font-semibold text-[#1E1C1A]">
        Confirm payment before opening portal access
      </h2>
      <p className="mt-2 text-sm text-amber-900">
        The carrier submitted its profile. Activate only after GEIA confirms the
        one-time Assessment payment.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-[#B83B32]" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void activate()}
        disabled={submitting}
        className="mt-4 rounded-lg bg-[#1B2D4F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2A4270] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Activating..." : "Confirm payment and activate"}
      </button>
    </section>
  );
}
