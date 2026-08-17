"use client";

import { ClipboardList, Loader2 } from "lucide-react";
import { useState } from "react";
import { RosterLinkCopy } from "@/components/console/roster-link-copy";
import { primaryButtonClass } from "@/components/console/compliance/shared";

type OpenRosterRequest = {
  id: string;
  rosterUrl: string;
  submittedAt: string | null;
};

type RequestResponse = {
  request?: {
    id?: string;
    upload_token?: string;
    submitted_at?: string | null;
  };
  rosterUrl?: string;
  emailDelivery?: {
    status?: string;
    dryRun?: boolean;
  };
  error?: string;
};

export function RosterRequestControl({
  clientId,
  initialRequest,
}: {
  clientId: string;
  initialRequest: OpenRosterRequest | null;
}) {
  const [openRequest, setOpenRequest] = useState(initialRequest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function createRequest() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/driver-roster-request`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => ({}))) as RequestResponse;
      if (payload.request?.id && payload.rosterUrl) {
        // The request can be durably saved even when notification delivery
        // returns 502. Never hide the bearer link needed for manual delivery.
        setOpenRequest({
          id: payload.request.id,
          rosterUrl: payload.rosterUrl,
          submittedAt: payload.request.submitted_at ?? null,
        });
      }
      if (!response.ok) {
        if (payload.request?.id && payload.rosterUrl) {
          setMessage(
            payload.error ??
              "Request saved, but its notification failed. Copy the link for the client."
          );
          return;
        }
        throw new Error(
          payload.error ??
            `Driver-list request failed with HTTP ${response.status}.`
        );
      }
      if (!payload.request?.id || !payload.rosterUrl) {
        throw new Error("The driver-list request response did not include its share link.");
      }
      setMessage(
        payload.emailDelivery?.dryRun ||
          payload.emailDelivery?.status === "dry_run"
          ? "Request saved. Email is in dry-run, so copy this link for the client."
          : "Request saved and the client notification was prepared."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unknown driver-list request failure."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-xl sm:w-auto sm:min-w-[20rem]">
      {!openRequest ? (
        <button
          type="button"
          onClick={() => void createRequest()}
          disabled={busy}
          className={`${primaryButtonClass} w-full gap-2 sm:w-auto`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
          )}
          {busy ? "Creating request…" : "Request driver roster"}
        </button>
      ) : (
        <div className="rounded-xl border border-[#E5D9C8] bg-[#FBF7F0] p-3 text-left shadow-sm">
          <p className="text-xs font-semibold text-[#1E1C1A]">
            Driver-list request is open
          </p>
          <p className="mt-1 text-[11px] leading-4 text-gray-500">
            Copy the no-login link to text it to the client or test it while email is in dry-run.
          </p>
          <RosterLinkCopy url={openRequest.rosterUrl} compact />
        </div>
      )}
      {message ? (
        <p className="mt-2 text-xs leading-5 text-gray-600" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
