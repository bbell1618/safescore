"use client";

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RosterCollectionResponse,
  RosterDeleteDriverResponse,
  RosterDocument,
  RosterDocumentResponse,
  RosterDocumentType,
  RosterDriverResponse,
  RosterStagedDriver,
  RosterSubmitResponse,
} from "@/lib/roster-collection/roster-types";

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
  "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "DC",
] as const;

type DriverForm = {
  full_name: string;
  cdl_number: string;
  cdl_state: string;
  cdl_class: string;
  cdl_expiry: string;
  medical_cert_expiry: string;
  hired_date: string;
};

type ApiError = { error?: string };

const EMPTY_DRIVER: DriverForm = {
  full_name: "",
  cdl_number: "",
  cdl_state: "CA",
  cdl_class: "A",
  cdl_expiry: "",
  medical_cert_expiry: "",
  hired_date: "",
};

const fieldClass =
  "min-h-12 w-full rounded-xl border border-sand bg-warm-white px-3.5 py-2.5 text-base text-warm-dark shadow-sm outline-none transition placeholder:text-warm-gray focus:border-gold focus:ring-2 focus:ring-gold/20";

async function responsePayload<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    throw new Error(
      payload.error ?? `SafeScore returned HTTP ${response.status}.`
    );
  }
  return payload;
}

function nullableDate(value: string) {
  return value || null;
}

function documentLabel(type: RosterDocumentType) {
  return type === "cdl" ? "CDL front" : "Medical card";
}

function mergeDocument(
  documents: RosterDocument[],
  next: RosterDocument
): RosterDocument[] {
  return [...documents.filter((document) => document.docType !== next.docType), next];
}

function InvalidRosterLink({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-[26rem] max-w-lg items-center px-4 py-12">
      <div className="w-full rounded-2xl border border-sand bg-warm-white p-7 text-center shadow-md sm:p-9">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-error-light">
          <AlertCircle className="h-6 w-6 text-error" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-heading text-2xl font-semibold text-warm-dark">
          This driver-list link is no longer available
        </h1>
        <p className="mt-2 text-sm leading-6 text-warm-mid">{message}</p>
        <p className="mt-3 text-xs leading-5 text-warm-gray">
          Ask your Golden Era SafeScore team for a current link if you still need to make a change.
        </p>
      </div>
    </div>
  );
}

function PhotoSlot({
  label,
  file,
  existing,
  onChange,
}: {
  label: string;
  file: File | null;
  existing: RosterDocument | undefined;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="group block cursor-pointer rounded-xl border border-dashed border-gold/55 bg-amber-subtle/45 p-4 transition hover:border-gold hover:bg-amber-subtle focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold">
      <input
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <span className="flex min-h-12 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-navy shadow-sm">
          <Camera className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-warm-dark">{label}</span>
          <span className="mt-0.5 block text-xs leading-5 text-warm-mid">
            Snap a photo — we&apos;ll read the dates for you
          </span>
          {file ? (
            <span className="mt-1 block truncate text-xs font-medium text-success">
              Ready: {file.name}
            </span>
          ) : existing ? (
            <span className="mt-1 block truncate text-xs font-medium text-success">
              On file: {existing.filename}
            </span>
          ) : (
            <span className="mt-1 block text-[11px] text-warm-gray">
              Optional · photo or PDF · up to 25 MB
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

export function RosterWizard({ token }: { token: string }) {
  const [collection, setCollection] = useState<RosterCollectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<DriverForm>(EMPTY_DRIVER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cdlPhoto, setCdlPhoto] = useState<File | null>(null);
  const [medicalPhoto, setMedicalPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(null);
  const [showAfterSubmit, setShowAfterSubmit] = useState(false);
  const formRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/roster/${token}`, { cache: "no-store" });
      const payload = await responsePayload<RosterCollectionResponse>(response);
      setCollection(payload);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to open this driver-list link."
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField<K extends keyof DriverForm>(key: K, value: DriverForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setForm(EMPTY_DRIVER);
    setEditingId(null);
    setCdlPhoto(null);
    setMedicalPhoto(null);
  }

  function editDriver(driver: RosterStagedDriver) {
    setEditingId(driver.id);
    setForm({
      full_name: driver.fullName,
      cdl_number: driver.cdlNumber,
      cdl_state: driver.cdlState,
      cdl_class: driver.cdlClass,
      cdl_expiry: driver.cdlExpiry ?? "",
      medical_cert_expiry: driver.medicalCertExpiry ?? "",
      hired_date: driver.hiredDate ?? "",
    });
    setCdlPhoto(null);
    setMedicalPhoto(null);
    setMessage(null);
    setMessageTone(null);
    window.requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  async function uploadDocument(
    driverId: string,
    docType: RosterDocumentType,
    file: File
  ) {
    const body = new FormData();
    body.append("file", file);
    body.append("docType", docType);
    const response = await fetch(
      `/api/roster/${token}/drivers/${driverId}/documents`,
      { method: "POST", body }
    );
    return responsePayload<RosterDocumentResponse>(response);
  }

  async function saveDriver(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setMessageTone(null);
    let savedDriver: RosterStagedDriver | null = null;
    const prior = collection?.drivers.find((driver) => driver.id === editingId);
    try {
      const response = await fetch(
        editingId
          ? `/api/roster/${token}/drivers/${editingId}`
          : `/api/roster/${token}/drivers`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            cdl_state: form.cdl_state.toUpperCase(),
            cdl_class: form.cdl_class.toUpperCase(),
            cdl_expiry: nullableDate(form.cdl_expiry),
            medical_cert_expiry: nullableDate(form.medical_cert_expiry),
            hired_date: nullableDate(form.hired_date),
          }),
        }
      );
      const payload = await responsePayload<RosterDriverResponse>(response);
      savedDriver = {
        ...payload.driver,
        documents: prior?.documents ?? payload.driver.documents,
      };
      setCollection((current) =>
        current
          ? {
              ...current,
              drivers: current.drivers.some((driver) => driver.id === savedDriver?.id)
                ? current.drivers.map((driver) =>
                    driver.id === savedDriver?.id ? savedDriver! : driver
                  )
                : [...current.drivers, savedDriver!],
            }
          : current
      );

      for (const [docType, file] of [
        ["cdl", cdlPhoto],
        ["medical_cert", medicalPhoto],
      ] as const) {
        if (!file) continue;
        const uploaded = await uploadDocument(savedDriver.id, docType, file);
        savedDriver = {
          ...savedDriver,
          documents: mergeDocument(savedDriver.documents, uploaded.document),
        };
        if (docType === "cdl") setCdlPhoto(null);
        else setMedicalPhoto(null);
        const nextDriver = savedDriver;
        setCollection((current) =>
          current
            ? {
                ...current,
                drivers: current.drivers.map((driver) =>
                  driver.id === nextDriver.id ? nextDriver : driver
                ),
              }
            : current
        );
      }

      setMessage(
        editingId
          ? `${savedDriver.fullName} was updated.`
          : `${savedDriver.fullName} was added to the saved list.`
      );
      setMessageTone("success");
      resetForm();
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown driver save failure.";
      setMessage(
        savedDriver
          ? `${savedDriver.fullName} is saved, but a document could not be attached: ${reason}`
          : reason
      );
      // A create may have committed before a later photo upload failed. Keep
      // retries on that saved row so a second tap cannot duplicate the driver.
      if (savedDriver) setEditingId(savedDriver.id);
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function removeDriver(driver: RosterStagedDriver) {
    if (!window.confirm(`Remove ${driver.fullName} from this driver list?`)) return;
    setRemovingId(driver.id);
    setMessage(null);
    setMessageTone(null);
    try {
      const response = await fetch(
        `/api/roster/${token}/drivers/${driver.id}`,
        { method: "DELETE" }
      );
      await responsePayload<RosterDeleteDriverResponse>(response);
      setCollection((current) =>
        current
          ? {
              ...current,
              drivers: current.drivers.filter((item) => item.id !== driver.id),
            }
          : current
      );
      if (editingId === driver.id) resetForm();
      setMessage(`${driver.fullName} was removed.`);
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unknown driver removal failure."
      );
      setMessageTone("error");
    } finally {
      setRemovingId(null);
    }
  }

  async function submitRoster() {
    setSubmitting(true);
    setMessage(null);
    setMessageTone(null);
    try {
      const response = await fetch(`/api/roster/${token}/submit`, {
        method: "POST",
      });
      const payload = await responsePayload<RosterSubmitResponse>(response);
      setCollection((current) =>
        current
          ? {
              ...current,
              request: {
                ...current.request,
                submittedAt: payload.submittedAt,
                response: payload.response,
              },
            }
          : current
      );
      setShowAfterSubmit(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unknown driver-list submission failure."
      );
      setMessageTone("error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[26rem] max-w-lg items-center justify-center px-4 py-12" role="status">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold text-navy shadow-md motion-safe:animate-pulse">
            <Truck className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-semibold text-warm-dark">Opening your saved driver list…</p>
        </div>
      </div>
    );
  }

  if (loadError || !collection) {
    return <InvalidRosterLink message={loadError ?? "The link could not be loaded."} />;
  }

  const isSubmitted = collection.request.submittedAt !== null;
  if (isSubmitted && !showAfterSubmit) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 sm:py-14">
        <div className="rounded-2xl border border-success/25 bg-warm-white p-7 text-center shadow-md sm:p-9">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-light">
            <CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />
          </div>
          <p className="mt-5 mono-label text-success">Saved and submitted</p>
          <h1 className="mt-2 font-heading text-3xl font-semibold text-warm-dark">
            Thanks — we have your driver list.
          </h1>
          <p className="mt-3 text-sm leading-6 text-warm-mid">
            {collection.drivers.length} driver{collection.drivers.length === 1 ? "" : "s"} submitted for {collection.request.clientName}. Your Golden Era SafeScore team will review the entries and documents.
          </p>
          <button
            type="button"
            className="btn-secondary mt-6 min-h-12 w-full sm:w-auto"
            onClick={() => setShowAfterSubmit(true)}
          >
            Add or correct a driver
          </button>
          <p className="mt-3 text-xs leading-5 text-warm-gray">
            This link stays editable until your Golden Era SafeScore team closes the request.
          </p>
        </div>
      </div>
    );
  }

  const editingDriver = collection.drivers.find((driver) => driver.id === editingId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="rounded-2xl border border-sand bg-warm-white p-5 shadow-md sm:p-7">
        <p className="mono-label text-amber-dark">About a minute per driver</p>
        <h1 className="mt-2 font-heading text-3xl font-semibold text-warm-dark sm:text-4xl">
          Add your drivers
        </h1>
        <p className="mt-3 text-sm leading-6 text-warm-mid sm:text-base">
          Add each driver&apos;s name and CDL number. Photos are optional, but they help us track credential dates before anything expires. Each driver saves as soon as you add them, so you can leave and come back anytime.
        </p>
        <div className="mt-5 rounded-xl border border-navy/10 bg-navy-subtle px-4 py-3 text-sm text-navy">
          <span className="font-semibold">{collection.request.clientName}</span>
          <span className="mx-2 text-navy/35">·</span>
          <span>{collection.request.title}</span>
        </div>
      </section>

      <section ref={formRef} className="scroll-mt-4 mt-6 rounded-2xl border border-sand bg-warm-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mono-label text-amber-dark">
              {editingId ? "Update saved driver" : "Next driver"}
            </p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-warm-dark">
              {editingId ? editingDriver?.fullName ?? "Edit driver" : "Driver details"}
            </h2>
          </div>
          {editingId ? (
            <button type="button" className="btn-secondary min-h-11" onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>

        <form onSubmit={saveDriver} className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-semibold text-warm-dark">Full name</span>
              <input
                required
                autoComplete="name"
                className={`${fieldClass} mt-1.5`}
                value={form.full_name}
                onChange={(event) => updateField("full_name", event.target.value)}
                placeholder="Driver's legal name"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-semibold text-warm-dark">CDL number</span>
              <input
                required
                autoCapitalize="characters"
                className={`${fieldClass} mt-1.5 font-mono`}
                value={form.cdl_number}
                onChange={(event) => updateField("cdl_number", event.target.value)}
                placeholder="Commercial driver's license number"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-warm-dark">CDL state</span>
              <select
                className={`${fieldClass} mt-1.5`}
                value={form.cdl_state}
                onChange={(event) => updateField("cdl_state", event.target.value)}
              >
                {STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-warm-dark">CDL class</span>
              <select
                className={`${fieldClass} mt-1.5`}
                value={form.cdl_class}
                onChange={(event) => updateField("cdl_class", event.target.value)}
              >
                <option value="A">Class A</option>
                <option value="B">Class B</option>
                <option value="C">Class C</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-warm-dark">CDL expiration</span>
              <span className="ml-1 text-xs font-normal text-warm-gray">Optional</span>
              <input
                type="date"
                className={`${fieldClass} mt-1.5`}
                value={form.cdl_expiry}
                onChange={(event) => updateField("cdl_expiry", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-warm-dark">Medical card expiration</span>
              <span className="ml-1 text-xs font-normal text-warm-gray">Optional</span>
              <input
                type="date"
                className={`${fieldClass} mt-1.5`}
                value={form.medical_cert_expiry}
                onChange={(event) => updateField("medical_cert_expiry", event.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-semibold text-warm-dark">Hire date</span>
              <span className="ml-1 text-xs font-normal text-warm-gray">Optional</span>
              <input
                type="date"
                className={`${fieldClass} mt-1.5 sm:max-w-[16rem]`}
                value={form.hired_date}
                onChange={(event) => updateField("hired_date", event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PhotoSlot
              label="Photo of CDL (front)"
              file={cdlPhoto}
              existing={editingDriver?.documents.find((document) => document.docType === "cdl")}
              onChange={setCdlPhoto}
            />
            <PhotoSlot
              label="Photo of medical card"
              file={medicalPhoto}
              existing={editingDriver?.documents.find((document) => document.docType === "medical_cert")}
              onChange={setMedicalPhoto}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="btn-primary min-h-12 w-full gap-2 text-sm sm:w-auto"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : editingId ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            {saving ? "Saving…" : editingId ? "Save changes" : "Add driver"}
          </button>
        </form>
      </section>

      {message ? (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm leading-6 ${
            messageTone === "error"
              ? "border-error/25 bg-error-light text-error"
              : "border-success/25 bg-success-light text-success"
          }`}
          role="status"
        >
          {message}
        </div>
      ) : null}

      <section className="mt-6 rounded-2xl border border-sand bg-warm-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mono-label text-amber-dark">Saved as you go</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-warm-dark">
              Drivers added ({collection.drivers.length})
            </h2>
          </div>
          {isSubmitted ? (
            <span className="rounded-full bg-success-light px-3 py-1.5 text-xs font-semibold text-success">
              Submitted — still editable
            </span>
          ) : null}
        </div>

        {collection.drivers.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-sand bg-cream px-5 py-8 text-center">
            <Truck className="mx-auto h-8 w-8 text-warm-gray" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-warm-dark">No drivers added yet</p>
            <p className="mt-1 text-xs leading-5 text-warm-mid">Add the first driver above. It saves immediately.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {collection.drivers.map((driver, index) => (
              <article key={driver.id} className="rounded-xl border border-sand bg-cream p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy font-mono text-xs font-bold text-warm-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading text-lg font-semibold text-warm-dark">{driver.fullName}</h3>
                    <p className="mt-0.5 break-all font-mono text-xs text-warm-mid">
                      {driver.cdlState} CDL {driver.cdlNumber} · Class {driver.cdlClass}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {driver.approvedAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success-light px-2 py-1 text-[11px] font-semibold text-success">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Reviewed by GEIA
                        </span>
                      ) : null}
                      {driver.documents.map((document) => (
                        <span key={document.id} className="inline-flex items-center gap-1 rounded-full border border-sand bg-warm-white px-2 py-1 text-[11px] font-medium text-success">
                          <FileText className="h-3 w-3" aria-hidden="true" />
                          {documentLabel(document.docType)} {document.reviewStatus === "reviewed" ? "reviewed" : "saved"}
                        </span>
                      ))}
                      {driver.documents.length === 0 && !driver.approvedAt ? (
                        <span className="text-[11px] text-warm-gray">No photos attached</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                {driver.approvedAt ? (
                  <p className="mt-3 border-t border-sand pt-3 text-xs leading-5 text-warm-gray">
                    This driver is now in your reviewed safety roster. Contact GEIA if a reviewed entry needs a correction.
                  </p>
                ) : (
                  <div className="mt-3 flex justify-end gap-2 border-t border-sand pt-3">
                    <button type="button" className="btn-secondary min-h-11 gap-1.5" onClick={() => editDriver(driver)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-error/25 bg-warm-white px-4 py-2 text-xs font-semibold text-error transition hover:bg-error-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error disabled:opacity-60"
                      disabled={removingId !== null}
                      onClick={() => void removeDriver(driver)}
                    >
                      {removingId === driver.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Remove
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <div className="mt-6 border-t border-sand pt-5">
          <button
            type="button"
            disabled={submitting || collection.drivers.length === 0}
            onClick={() => void submitRoster()}
            className="btn-primary min-h-12 w-full gap-2 text-sm sm:w-auto"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            )}
            {submitting ? "Submitting…" : "That’s everyone — submit roster"}
          </button>
          <p className="mt-2 text-xs leading-5 text-warm-gray">
            You can reopen this link to add or correct a driver until GEIA closes the request.
          </p>
        </div>
      </section>
    </div>
  );
}
