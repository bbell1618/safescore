"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PinRequestResponse = {
  error?: string;
  request?: { id: string; created: boolean };
  emailDelivery?: { status: string };
};

export function FmcsaPinRequestControl({
  clientId,
  requestAlreadyOpen,
}: {
  clientId: string;
  requestAlreadyOpen: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function requestPin() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/fmcsa-pin-request`,
        { method: "POST" }
      );
      const body = (await response.json().catch(() => ({}))) as PinRequestResponse;
      if (!response.ok) {
        throw new Error(
          body.error ?? `PIN request failed with HTTP ${response.status}`
        );
      }
      setCreated(true);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to request the FMCSA Portal PIN"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (requestAlreadyOpen || created) {
    return (
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900" role="status">
        Request open — the client can see this to-do in Portal Documents.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void requestPin()}
        disabled={submitting}
        className="rounded-lg bg-[#1B2D4F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2A4270] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Creating request…" : "Request from client"}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-[#B83B32]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
