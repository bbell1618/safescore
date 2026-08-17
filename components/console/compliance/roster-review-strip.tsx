"use client";

import { ExternalLink, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ComplianceDriverRow } from "@/components/console/compliance/types";
import {
  Field,
  MutationMessage,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/console/compliance/shared";

export type PendingRosterDocument = {
  id: string;
  docType: "cdl" | "medical_cert";
  filename: string;
  url: string;
};

export type PendingRosterDriver = ComplianceDriverRow & {
  documents: PendingRosterDocument[];
};

type ReviewResponse = {
  driver?: ComplianceDriverRow;
  success?: boolean;
  error?: string;
};

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function PendingDriverCard({
  clientId,
  initialDriver,
  onReviewed,
}: {
  clientId: string;
  initialDriver: PendingRosterDriver;
  onReviewed: (driverId: string) => void;
}) {
  const [driver, setDriver] = useState(initialDriver);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function update<K extends keyof PendingRosterDriver>(
    key: K,
    value: PendingRosterDriver[K]
  ) {
    setDriver((current) => ({ ...current, [key]: value }));
  }

  async function approve() {
    setBusy("approve");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/drivers/${driver.id}/review`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            updates: {
              full_name: driver.full_name.trim(),
              cdl_number: nullable(driver.cdl_number ?? ""),
              cdl_state: nullable(driver.cdl_state ?? "")?.toUpperCase() ?? null,
              cdl_class: nullable(driver.cdl_class ?? "")?.toUpperCase() ?? null,
              cdl_expiry: nullable(driver.cdl_expiry ?? ""),
              medical_cert_expiry: nullable(driver.medical_cert_expiry ?? ""),
              hired_date: nullable(driver.hired_date ?? ""),
              status: driver.status,
            },
          }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as ReviewResponse;
      if (!response.ok || !payload.driver) {
        throw new Error(
          payload.error ?? `Driver approval failed with HTTP ${response.status}.`
        );
      }
      onReviewed(driver.id);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unknown driver approval failure."
      );
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!window.confirm(`Remove ${driver.full_name} from this submission?`)) return;
    setBusy("reject");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/drivers/${driver.id}/review`,
        { method: "DELETE" }
      );
      const payload = (await response.json().catch(() => ({}))) as ReviewResponse;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          payload.error ?? `Driver rejection failed with HTTP ${response.status}.`
        );
      }
      onReviewed(driver.id);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unknown driver rejection failure."
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-xl border border-[#E5D9C8] bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Full name" className="xl:col-span-2">
          <input
            className={inputClass}
            required
            value={driver.full_name}
            onChange={(event) => update("full_name", event.target.value)}
          />
        </Field>
        <Field label="CDL number">
          <input
            className={inputClass}
            value={driver.cdl_number ?? ""}
            onChange={(event) => update("cdl_number", event.target.value)}
          />
        </Field>
        <Field label="Status">
          <select
            className={inputClass}
            value={driver.status}
            onChange={(event) =>
              update(
                "status",
                event.target.value as ComplianceDriverRow["status"]
              )
            }
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="terminated">Terminated</option>
          </select>
        </Field>
        <Field label="CDL state">
          <input
            className={inputClass}
            maxLength={2}
            value={driver.cdl_state ?? ""}
            onChange={(event) => update("cdl_state", event.target.value)}
          />
        </Field>
        <Field label="CDL class">
          <input
            className={inputClass}
            maxLength={20}
            value={driver.cdl_class ?? ""}
            onChange={(event) => update("cdl_class", event.target.value)}
          />
        </Field>
        <Field label="CDL expiration">
          <input
            type="date"
            className={inputClass}
            value={driver.cdl_expiry ?? ""}
            onChange={(event) => update("cdl_expiry", event.target.value)}
          />
        </Field>
        <Field label="Medical card expiration">
          <input
            type="date"
            className={inputClass}
            value={driver.medical_cert_expiry ?? ""}
            onChange={(event) =>
              update("medical_cert_expiry", event.target.value)
            }
          />
        </Field>
        <Field label="Hire date">
          <input
            type="date"
            className={inputClass}
            value={driver.hired_date ?? ""}
            onChange={(event) => update("hired_date", event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {driver.documents.length > 0 ? (
          driver.documents.map((document) => (
            <a
              key={document.id}
              href={document.url}
              target="_blank"
              rel="noreferrer"
              className={secondaryButtonClass}
            >
              {document.docType === "cdl" ? "View CDL photo" : "View medical card"}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ))
        ) : (
          <p className="text-xs text-gray-500">No document photos were attached.</p>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void reject()}
            disabled={busy !== null}
            className={`${secondaryButtonClass} gap-1.5 text-red-700 hover:border-red-300 hover:text-red-800`}
          >
            {busy === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Reject
          </button>
          <button
            type="button"
            onClick={() => void approve()}
            disabled={busy !== null || !driver.full_name.trim()}
            className={`${primaryButtonClass} gap-1.5`}
          >
            {busy === "approve" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Approve into roster
          </button>
        </div>
      </div>
      <MutationMessage message={message} />
    </article>
  );
}

export function RosterReviewStrip({
  clientId,
  initialDrivers,
  request,
}: {
  clientId: string;
  initialDrivers: PendingRosterDriver[];
  request: { id: string; submittedAt: string | null } | null;
}) {
  const router = useRouter();
  const [drivers, setDrivers] = useState(initialDrivers);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (drivers.length === 0 && !request?.submittedAt) return null;

  function reviewed(driverId: string) {
    setDrivers((current) => current.filter((driver) => driver.id !== driverId));
    router.refresh();
  }

  async function closeRequest() {
    if (!request) return;
    setClosing(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/driver-roster-request/${request.id}/close`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        request?: { id?: string };
        error?: string;
      };
      if (!response.ok || !payload.request?.id) {
        throw new Error(
          payload.error ??
            `Closing the driver-list request failed with HTTP ${response.status}.`
        );
      }
      setMessage("Driver-list request closed.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unknown request-close failure."
      );
    } finally {
      setClosing(false);
    }
  }

  return (
    <section
      id="client-submissions-pending-review"
      className="scroll-mt-24 rounded-xl border border-amber-200 bg-amber-50 p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-amber-950">
            Client submissions pending review ({drivers.length})
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-900/75">
            Compare the photos with each entry, fill any dates you can confirm, then approve the driver into the official roster. Pending entries do not affect compliance counts or billing.
          </p>
        </div>
        {request?.submittedAt && drivers.length === 0 ? (
          <button
            type="button"
            onClick={() => void closeRequest()}
            disabled={closing}
            className={`${primaryButtonClass} shrink-0 gap-1.5`}
          >
            {closing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {closing ? "Closing…" : "Close roster request"}
          </button>
        ) : null}
      </div>
      {drivers.length > 0 ? (
        <div className="mt-4 space-y-4">
          {drivers.map((driver) => (
            <PendingDriverCard
              key={driver.id}
              clientId={clientId}
              initialDriver={driver}
              onReviewed={reviewed}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-xs leading-5 text-green-800">
          Every submitted driver has been reviewed. Close the request when the list is complete.
        </p>
      )}
      <MutationMessage message={message} />
    </section>
  );
}
