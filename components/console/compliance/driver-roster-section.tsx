"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FileCheck2, UserRound } from "lucide-react";
import type { ComplianceHealth } from "@/lib/compliance/health";
import { DQF_CHECKLIST_ITEMS } from "@/lib/compliance/health";
import type {
  ComplianceDocumentOption,
  ComplianceDriverDocumentRow,
  ComplianceDriverRow,
  DriverDocumentType,
} from "./types";
import {
  ComplianceStatusBadge,
  Field,
  formatComplianceDate,
  inputClass,
  MutationMessage,
  primaryButtonClass,
  RosterStatusBadge,
  secondaryButtonClass,
  SectionFrame,
} from "./shared";

type DriverFormState = {
  full_name: string;
  cdl_number: string;
  cdl_state: string;
  cdl_class: string;
  cdl_expiry: string;
  medical_cert_expiry: string;
  hired_date: string;
  status: "active" | "inactive" | "terminated";
};

const emptyDriver: DriverFormState = {
  full_name: "",
  cdl_number: "",
  cdl_state: "",
  cdl_class: "",
  cdl_expiry: "",
  medical_cert_expiry: "",
  hired_date: "",
  status: "active",
};

const CONSOLE_DQF_CHECKLIST_ITEMS: ReadonlyArray<{
  docType: DriverDocumentType;
  label: string;
  description: string;
  annual: boolean;
}> = [
  {
    docType: "cdl",
    label: "Commercial driver's license",
    description: "A copy of the current CDL credential and its expiration date.",
    annual: false,
  },
  ...DQF_CHECKLIST_ITEMS,
];

const completionDateRequired = new Set<DriverDocumentType>([
  "application",
  "prior_employer_checks",
  "road_test",
  "mvr",
  "clearinghouse_pre_employment",
]);

function driverFormState(driver?: ComplianceDriverRow): DriverFormState {
  if (!driver) return emptyDriver;
  return {
    full_name: driver.full_name,
    cdl_number: driver.cdl_number ?? "",
    cdl_state: driver.cdl_state ?? "",
    cdl_class: driver.cdl_class ?? "",
    cdl_expiry: driver.cdl_expiry ?? "",
    medical_cert_expiry: driver.medical_cert_expiry ?? "",
    hired_date: driver.hired_date ?? "",
    status: driver.status,
  };
}

function DriverForm({
  clientId,
  driver,
  onCancel,
}: {
  clientId: string;
  driver?: ComplianceDriverRow;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => driverFormState(driver));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function change<K extends keyof DriverFormState>(
    key: K,
    value: DriverFormState[K]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        driver
          ? `/api/clients/${clientId}/drivers/${driver.id}`
          : `/api/clients/${clientId}/drivers`,
        {
          method: driver ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: form.full_name,
            cdl_number: form.cdl_number || null,
            cdl_state: form.cdl_state || null,
            cdl_class: form.cdl_class || null,
            cdl_expiry: form.cdl_expiry || null,
            medical_cert_expiry: form.medical_cert_expiry || null,
            hired_date: form.hired_date || null,
            status: form.status,
          }),
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save the driver.");
      }
      router.refresh();
      onCancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the driver.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-[#E5D9C8] bg-[#FEFCF8] p-4"
      onSubmit={save}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Driver name *" className="sm:col-span-2">
          <input
            className={inputClass}
            required
            maxLength={160}
            value={form.full_name}
            onChange={(event) => change("full_name", event.target.value)}
          />
        </Field>
        <Field label="Hire date">
          <input
            className={inputClass}
            type="date"
            value={form.hired_date}
            onChange={(event) => change("hired_date", event.target.value)}
          />
        </Field>
        <Field label="Roster status">
          <select
            className={inputClass}
            value={form.status}
            onChange={(event) =>
              change("status", event.target.value as DriverFormState["status"])
            }
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="terminated">Terminated</option>
          </select>
        </Field>
        <Field label="CDL number">
          <input
            className={inputClass}
            maxLength={80}
            value={form.cdl_number}
            onChange={(event) => change("cdl_number", event.target.value)}
          />
        </Field>
        <Field label="CDL state">
          <input
            className={inputClass}
            maxLength={2}
            placeholder="CA"
            value={form.cdl_state}
            onChange={(event) =>
              change("cdl_state", event.target.value.toUpperCase().slice(0, 2))
            }
          />
        </Field>
        <Field label="CDL class">
          <input
            className={inputClass}
            maxLength={20}
            placeholder="A"
            value={form.cdl_class}
            onChange={(event) => change("cdl_class", event.target.value)}
          />
        </Field>
        <Field label="CDL expiration">
          <input
            className={inputClass}
            type="date"
            value={form.cdl_expiry}
            onChange={(event) => change("cdl_expiry", event.target.value)}
          />
        </Field>
        <Field label="Medical certificate expiration">
          <input
            className={inputClass}
            type="date"
            value={form.medical_cert_expiry}
            onChange={(event) =>
              change("medical_cert_expiry", event.target.value)
            }
          />
        </Field>
      </div>
      <MutationMessage message={message} />
      <div className="flex flex-wrap justify-end gap-2">
        <button className={secondaryButtonClass} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className={primaryButtonClass} type="submit" disabled={busy}>
          {busy ? "Saving…" : driver ? "Save driver" : "Add driver"}
        </button>
      </div>
    </form>
  );
}

function DqfItemForm({
  clientId,
  driverId,
  docType,
  row,
  defaultExpiryDate,
  documents,
  onCancel,
}: {
  clientId: string;
  driverId: string;
  docType: DriverDocumentType;
  row?: ComplianceDriverDocumentRow;
  defaultExpiryDate?: string | null;
  documents: ComplianceDocumentOption[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"current" | "missing">(
    row?.status === "missing" || !row ? "missing" : "current"
  );
  const [completedDate, setCompletedDate] = useState(row?.completed_date ?? "");
  const [expiryDate, setExpiryDate] = useState(
    row?.expiry_date ?? defaultExpiryDate ?? ""
  );
  const [documentId, setDocumentId] = useState(row?.document_id ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (status !== "missing") {
      if ((docType === "medical_cert" || docType === "cdl") && !expiryDate) {
        setMessage("Add the credential expiration date before marking it on file.");
        return;
      }
      if (
        docType === "annual_mvr_review" &&
        !completedDate &&
        !expiryDate
      ) {
        setMessage(
          "Add the completed date or next-review date before marking it on file."
        );
        return;
      }
      if (completionDateRequired.has(docType) && !completedDate) {
        setMessage("Add the completed date before marking this record on file.");
        return;
      }
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/drivers/${driverId}/dqf`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doc_type: docType,
            status,
            completed_date: completedDate || null,
            expiry_date: expiryDate || null,
            document_id: documentId || null,
            notes: notes || null,
          }),
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to save this DQF item.");
      router.refresh();
      onCancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this DQF item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-3 border-t border-[#F0E8DA] pt-3" onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Record state">
          <select
            className={inputClass}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as "current" | "missing")
            }
          >
            <option value="missing">Missing</option>
            <option value="current">On file</option>
          </select>
        </Field>
        <Field
          label={`Completed / reviewed date${
            status !== "missing" && completionDateRequired.has(docType)
              ? " *"
              : ""
          }`}
        >
          <input
            className={inputClass}
            required={
              status !== "missing" && completionDateRequired.has(docType)
            }
            type="date"
            value={completedDate}
            onChange={(event) => setCompletedDate(event.target.value)}
          />
        </Field>
        <Field
          label={`Expiration / next-review date${
            status !== "missing" &&
            (docType === "medical_cert" || docType === "cdl")
              ? " *"
              : ""
          }`}
        >
          <input
            className={inputClass}
            required={
              status !== "missing" &&
              (docType === "medical_cert" || docType === "cdl")
            }
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
          />
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
        <Field label="Operator notes" className="sm:col-span-2 lg:col-span-4">
          <textarea
            className={inputClass}
            maxLength={2_000}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-[11px] leading-4 text-gray-500">
        Expiring and expired states are derived from the recorded dates; they are
        not manually asserted.
      </p>
      <MutationMessage message={message} />
      <div className="flex justify-end gap-2">
        <button className={secondaryButtonClass} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className={primaryButtonClass} type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save file item"}
        </button>
      </div>
    </form>
  );
}

export function DriverRosterSection({
  clientId,
  drivers,
  driverDocuments,
  documents,
  health,
}: {
  clientId: string;
  drivers: ComplianceDriverRow[];
  driverDocuments: ComplianceDriverDocumentRow[];
  documents: ComplianceDocumentOption[];
  health: ComplianceHealth;
}) {
  const [adding, setAdding] = useState(false);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [editingDriver, setEditingDriver] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const healthByDriver = useMemo(
    () => new Map(health.drivers.items.map((item) => [item.id, item])),
    [health.drivers.items]
  );
  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  );

  return (
    <SectionFrame
      title={`Drivers & qualification files (${drivers.length})`}
      description="The operational roster and the records GEIA has on file for each driver. Roster counts never change the service-plan driver count used for billing."
      action={
        <button className={primaryButtonClass} type="button" onClick={() => setAdding(true)}>
          Add driver
        </button>
      }
    >
      <div className="space-y-4 p-5">
        {adding ? <DriverForm clientId={clientId} onCancel={() => setAdding(false)} /> : null}

        {drivers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#D8CAB6] bg-white px-6 py-10 text-center">
            <UserRound className="mx-auto h-6 w-6 text-gray-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-[#1E1C1A]">
              No compliance drivers recorded
            </p>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-gray-500">
              Start with the current active and terminated roster, then collect each
              driver&apos;s qualification records.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {drivers.map((driver) => {
              const expanded = expandedDriver === driver.id;
              const driverHealth = healthByDriver.get(driver.id);
              const driverDocs = driverDocuments.filter(
                (item) => item.driver_id === driver.id
              );
              return (
                <article
                  className="overflow-hidden rounded-lg border border-[#E5D9C8] bg-white"
                  key={driver.id}
                >
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
                      aria-expanded={expanded}
                      onClick={() => {
                        setExpandedDriver(expanded ? null : driver.id);
                        setEditingItem(null);
                      }}
                    >
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#1E1C1A]">
                          {driver.full_name}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          CDL {driver.cdl_class ?? "class not recorded"} · {driver.cdl_state ?? "state not recorded"} · hired {formatComplianceDate(driver.hired_date)}
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                      <RosterStatusBadge status={driver.status} />
                      {driver.status === "active" ? (
                        <ComplianceStatusBadge
                          status={driverHealth?.overallStatus ?? "missing"}
                        />
                      ) : null}
                      <button
                        className={secondaryButtonClass}
                        type="button"
                        onClick={() => setEditingDriver(driver.id)}
                      >
                        Edit driver
                      </button>
                    </div>
                  </div>

                  {editingDriver === driver.id ? (
                    <div className="border-t border-[#F0E8DA] p-4">
                      <DriverForm
                        clientId={clientId}
                        driver={driver}
                        onCancel={() => setEditingDriver(null)}
                      />
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="border-t border-[#F0E8DA] bg-[#FEFCF8] p-4">
                      <div className="mb-3 flex items-start gap-2">
                        <FileCheck2 className="mt-0.5 h-4 w-4 text-[#C67A1E]" aria-hidden="true" />
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#1E1C1A]">
                            Driver qualification file
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            These statuses describe records on file; they are not a legal compliance certification.
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {CONSOLE_DQF_CHECKLIST_ITEMS.map((requirement) => {
                          const raw = driverDocs.find(
                            (item) => item.doc_type === requirement.docType
                          );
                          const derived =
                            requirement.docType === "cdl"
                              ? {
                                  status: driverHealth?.cdlStatus ?? "missing",
                                  dueDate:
                                    raw?.expiry_date ?? driver.cdl_expiry,
                                }
                              : driverHealth?.dqfItems.find(
                                  (item) =>
                                    item.docType === requirement.docType
                                );
                          const editKey = `${driver.id}:${requirement.docType}`;
                          const linked = raw?.document_id
                            ? documentsById.get(raw.document_id)
                            : null;
                          return (
                            <div
                              className="rounded-lg border border-[#E5D9C8] bg-white p-3"
                              key={requirement.docType}
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <p className="text-sm font-medium text-[#1E1C1A]">
                                    {requirement.label}
                                  </p>
                                  <p className="mt-0.5 text-xs leading-5 text-gray-500">
                                    {requirement.description}
                                  </p>
                                  <p className="mt-1 text-[11px] text-gray-500">
                                    Completed: {formatComplianceDate(raw?.completed_date)} · Due: {formatComplianceDate(derived?.dueDate ?? raw?.expiry_date)}
                                    {linked ? ` · Document: ${linked.filename}` : " · No document linked"}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <ComplianceStatusBadge
                                    status={derived?.status ?? "missing"}
                                  />
                                  <button
                                    className={secondaryButtonClass}
                                    type="button"
                                    onClick={() =>
                                      setEditingItem(
                                        editingItem === editKey ? null : editKey
                                      )
                                    }
                                  >
                                    Edit
                                  </button>
                                </div>
                              </div>
                              {editingItem === editKey ? (
                                <DqfItemForm
                                  clientId={clientId}
                                  driverId={driver.id}
                                  docType={requirement.docType}
                                  row={raw}
                                  defaultExpiryDate={
                                    requirement.docType === "cdl"
                                      ? driver.cdl_expiry
                                      : requirement.docType === "medical_cert"
                                        ? driver.medical_cert_expiry
                                        : null
                                  }
                                  documents={documents}
                                  onCancel={() => setEditingItem(null)}
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </SectionFrame>
  );
}
