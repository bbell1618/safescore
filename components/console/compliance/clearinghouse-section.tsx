"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { ComplianceHealth } from "@/lib/compliance/health";
import { deriveAnnualDueDate } from "@/lib/compliance/health";
import type {
  ComplianceClearinghouseRow,
  ComplianceDocumentOption,
  ComplianceDriverRow,
  ComplianceProfileRow,
} from "./types";
import {
  ComplianceStatusBadge,
  Field,
  formatComplianceDate,
  inputClass,
  MutationMessage,
  primaryButtonClass,
  secondaryButtonClass,
  SectionFrame,
} from "./shared";

const registrationLabels: Record<
  ComplianceProfileRow["clearinghouse_registration_status"],
  string
> = {
  unknown: "Not recorded",
  registered: "Registered",
  not_registered: "Not registered",
};

function RegistrationControl({
  clientId,
  profile,
}: {
  clientId: string;
  profile: ComplianceProfileRow | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<
    ComplianceProfileRow["clearinghouse_registration_status"]
  >(profile?.clearinghouse_registration_status ?? "unknown");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/clients/${clientId}/compliance-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearinghouse_registration_status: status }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to update registration status.");
      }
      setMessage("Registration status saved.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update registration status."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[#E5D9C8] bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-[#1E1C1A]">
            Company Clearinghouse registration
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            SafeScore records whether registration has been confirmed. GEIA completes
            queries outside SafeScore and records the result here.
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            Last checked {formatComplianceDate(profile?.clearinghouse_registration_checked_at)}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Registration status" className="min-w-52">
            <select
              className={inputClass}
              value={status}
              onChange={(event) => {
                setStatus(
                  event.target.value as ComplianceProfileRow["clearinghouse_registration_status"]
                );
                setMessage(null);
              }}
            >
              <option value="unknown">Not recorded</option>
              <option value="registered">Registered</option>
              <option value="not_registered">Not registered</option>
            </select>
          </Field>
          <button className={primaryButtonClass} type="button" disabled={busy} onClick={save}>
            {busy ? "Saving..." : "Save status"}
          </button>
        </div>
      </div>
      <MutationMessage message={message} />
    </div>
  );
}

function QueryForm({
  clientId,
  drivers,
  documents,
  asOfDate,
  onCancel,
}: {
  clientId: string;
  drivers: ComplianceDriverRow[];
  documents: ComplianceDocumentOption[];
  asOfDate: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");
  const [queryDate, setQueryDate] = useState(asOfDate);
  const [resultType, setResultType] = useState<"negative" | "positive">(
    "negative"
  );
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/clearinghouse-records`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driver_id: driverId,
            query_date: queryDate,
            result_type: resultType,
            document_id: documentId || null,
          }),
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to record the Clearinghouse query.");
      }
      router.refresh();
      onCancel();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to record the Clearinghouse query."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-[#E5D9C8] bg-[#FEFCF8] p-4"
      onSubmit={save}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Driver *">
          <select
            className={inputClass}
            required
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
          >
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Query date *">
          <input
            className={inputClass}
            required
            type="date"
            value={queryDate}
            onChange={(event) => setQueryDate(event.target.value)}
          />
        </Field>
        <Field label="Recorded result">
          <select
            className={inputClass}
            value={resultType}
            onChange={(event) =>
              setResultType(event.target.value as "negative" | "positive")
            }
          >
            <option value="negative">Negative</option>
            <option value="positive">Positive</option>
          </select>
        </Field>
        <Field label="Linked document">
          <select
            className={inputClass}
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
          >
            <option value="">No document linked</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.filename}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-[11px] leading-4 text-gray-500">
        A recorded query starts the next annual due date one year later. This is
        tracking only; SafeScore does not perform the query.
      </p>
      <MutationMessage message={message} />
      <div className="flex justify-end gap-2">
        <button className={secondaryButtonClass} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className={primaryButtonClass} type="submit" disabled={busy || !driverId}>
          {busy ? "Saving..." : "Record query"}
        </button>
      </div>
    </form>
  );
}

export function ClearinghouseSection({
  clientId,
  profile,
  drivers,
  records,
  documents,
  health,
}: {
  clientId: string;
  profile: ComplianceProfileRow | null;
  drivers: ComplianceDriverRow[];
  records: ComplianceClearinghouseRow[];
  documents: ComplianceDocumentOption[];
  health: ComplianceHealth;
}) {
  const [addingQuery, setAddingQuery] = useState(false);
  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.status === "active"),
    [drivers]
  );
  const latestByDriver = useMemo(() => {
    const latest = new Map<string, ComplianceClearinghouseRow>();
    for (const record of records) {
      if (!record.driver_id) continue;
      const current = latest.get(record.driver_id);
      if (!current || current.query_date < record.query_date) {
        latest.set(record.driver_id, record);
      }
    }
    return latest;
  }, [records]);
  const healthByDriver = useMemo(
    () => new Map(health.drivers.items.map((item) => [item.id, item])),
    [health.drivers.items]
  );

  return (
    <SectionFrame
      title="Clearinghouse tracking"
      description="Company registration and each active driver's latest annual query. GEIA performs queries outside SafeScore; this section records the operational clock and result."
      action={
        activeDrivers.length > 0 ? (
          <button
            className={primaryButtonClass}
            type="button"
            onClick={() => setAddingQuery(true)}
          >
            Record a query
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4 p-5">
        <RegistrationControl clientId={clientId} profile={profile} />

        {addingQuery ? (
          <QueryForm
            clientId={clientId}
            drivers={activeDrivers}
            documents={documents}
            asOfDate={health.asOfDate}
            onCancel={() => setAddingQuery(false)}
          />
        ) : null}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#1E1C1A]">
              Annual query status
            </h3>
            <Badge
              variant={
                profile?.clearinghouse_registration_status === "registered"
                  ? "success"
                  : "outline"
              }
            >
              {registrationLabels[
                profile?.clearinghouse_registration_status ?? "unknown"
              ]}
            </Badge>
          </div>
          {activeDrivers.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-[#D8CAB6] bg-white p-4 text-xs leading-5 text-gray-500">
              Add the active driver roster first. Clearinghouse annual-query tracking
              is maintained per driver.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-[#E5D9C8] bg-white">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-[#F0E8DA] bg-[#FEFCF8] text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Driver</th>
                    <th className="px-3 py-2 font-medium">Last query</th>
                    <th className="px-3 py-2 font-medium">Next due</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0E8DA]">
                  {activeDrivers.map((driver) => {
                    const record = latestByDriver.get(driver.id);
                    const status =
                      healthByDriver.get(driver.id)?.clearinghouseStatus ?? "missing";
                    return (
                      <tr key={driver.id}>
                        <td className="px-3 py-2.5 font-medium text-[#1E1C1A]">
                          {driver.full_name}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {formatComplianceDate(record?.query_date)}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {formatComplianceDate(
                            deriveAnnualDueDate(record?.query_date ?? null)
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {record
                            ? record.result_type === "negative"
                              ? "Negative"
                              : "Positive"
                            : "Not recorded"}
                        </td>
                        <td className="px-3 py-2.5">
                          <ComplianceStatusBadge status={status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SectionFrame>
  );
}
