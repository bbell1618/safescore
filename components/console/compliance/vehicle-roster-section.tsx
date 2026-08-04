"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ClipboardPlus, Truck } from "lucide-react";
import type { ComplianceHealth } from "@/lib/compliance/health";
import type {
  ComplianceDocumentOption,
  ComplianceMaintenanceRow,
  ComplianceVehicleRow,
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

type VehicleFormState = {
  unit_number: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  license_plate: string;
  plate_state: string;
  annual_inspection_date: string;
  status: "active" | "inactive";
};

const emptyVehicle: VehicleFormState = {
  unit_number: "",
  vin: "",
  year: "",
  make: "",
  model: "",
  license_plate: "",
  plate_state: "",
  annual_inspection_date: "",
  status: "active",
};

function vehicleFormState(vehicle?: ComplianceVehicleRow): VehicleFormState {
  if (!vehicle) return emptyVehicle;
  return {
    unit_number: vehicle.unit_number ?? "",
    vin: vehicle.vin ?? "",
    year: vehicle.year?.toString() ?? "",
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    license_plate: vehicle.license_plate ?? "",
    plate_state: vehicle.plate_state ?? "",
    annual_inspection_date: vehicle.annual_inspection_date ?? "",
    status: vehicle.status,
  };
}

function VehicleForm({
  clientId,
  vehicle,
  onCancel,
}: {
  clientId: string;
  vehicle?: ComplianceVehicleRow;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => vehicleFormState(vehicle));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function change<K extends keyof VehicleFormState>(
    key: K,
    value: VehicleFormState[K]
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
        vehicle
          ? `/api/clients/${clientId}/vehicles/${vehicle.id}`
          : `/api/clients/${clientId}/vehicles`,
        {
          method: vehicle ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unit_number: form.unit_number,
            vin: form.vin || null,
            year: form.year ? Number(form.year) : null,
            make: form.make || null,
            model: form.model || null,
            license_plate: form.license_plate || null,
            plate_state: form.plate_state || null,
            annual_inspection_date: form.annual_inspection_date || null,
            status: form.status,
          }),
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save the vehicle.");
      }
      router.refresh();
      onCancel();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save the vehicle."
      );
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
        <Field label="Unit number *">
          <input
            className={inputClass}
            required
            maxLength={80}
            value={form.unit_number}
            onChange={(event) => change("unit_number", event.target.value)}
          />
        </Field>
        <Field label="VIN">
          <input
            className={inputClass}
            maxLength={40}
            value={form.vin}
            onChange={(event) =>
              change("vin", event.target.value.toUpperCase().slice(0, 40))
            }
          />
        </Field>
        <Field label="Year">
          <input
            className={inputClass}
            inputMode="numeric"
            min="1900"
            max="2100"
            type="number"
            value={form.year}
            onChange={(event) => change("year", event.target.value)}
          />
        </Field>
        <Field label="Roster status">
          <select
            className={inputClass}
            value={form.status}
            onChange={(event) =>
              change("status", event.target.value as VehicleFormState["status"])
            }
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Make">
          <input
            className={inputClass}
            maxLength={80}
            value={form.make}
            onChange={(event) => change("make", event.target.value)}
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass}
            maxLength={80}
            value={form.model}
            onChange={(event) => change("model", event.target.value)}
          />
        </Field>
        <Field label="Plate">
          <input
            className={inputClass}
            maxLength={40}
            value={form.license_plate}
            onChange={(event) => change("license_plate", event.target.value)}
          />
        </Field>
        <Field label="Plate state">
          <input
            className={inputClass}
            maxLength={2}
            placeholder="CA"
            value={form.plate_state}
            onChange={(event) =>
              change("plate_state", event.target.value.toUpperCase().slice(0, 2))
            }
          />
        </Field>
        <Field label="Last annual DOT inspection">
          <input
            className={inputClass}
            type="date"
            value={form.annual_inspection_date}
            onChange={(event) =>
              change("annual_inspection_date", event.target.value)
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
          {busy ? "Saving..." : vehicle ? "Save vehicle" : "Add vehicle"}
        </button>
      </div>
    </form>
  );
}

function MaintenanceForm({
  clientId,
  vehicleId,
  documents,
  onCancel,
}: {
  clientId: string;
  vehicleId: string;
  documents: ComplianceDocumentOption[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [maintenanceType, setMaintenanceType] = useState<
    ComplianceMaintenanceRow["maintenance_type"]
  >("pm_service");
  const [completedDate, setCompletedDate] = useState(today);
  const [scheduledDate, setScheduledDate] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/vehicles/${vehicleId}/maintenance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maintenance_type: maintenanceType,
            completed_date: completedDate,
            scheduled_date: scheduledDate || null,
            document_id: documentId || null,
            notes: notes || null,
          }),
        }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to record maintenance.");
      }
      router.refresh();
      onCancel();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to record maintenance."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 border-t border-[#F0E8DA] pt-3" onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Entry type">
          <select
            className={inputClass}
            value={maintenanceType}
            onChange={(event) =>
              setMaintenanceType(
                event.target.value as ComplianceMaintenanceRow["maintenance_type"]
              )
            }
          >
            <option value="pm_service">PM service</option>
            <option value="repair">Repair</option>
            <option value="annual_inspection">Annual inspection</option>
          </select>
        </Field>
        <Field label="Completed date *">
          <input
            className={inputClass}
            required
            type="date"
            value={completedDate}
            onChange={(event) => setCompletedDate(event.target.value)}
          />
        </Field>
        <Field label="Scheduled date">
          <input
            className={inputClass}
            type="date"
            value={scheduledDate}
            onChange={(event) => setScheduledDate(event.target.value)}
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
        <Field label="Work notes" className="sm:col-span-2 lg:col-span-4">
          <textarea
            className={inputClass}
            maxLength={4_000}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-[11px] leading-4 text-gray-500">
        Recording an annual inspection also updates the vehicle&apos;s last annual
        inspection date when this entry is newer.
      </p>
      <MutationMessage message={message} />
      <div className="flex justify-end gap-2">
        <button className={secondaryButtonClass} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className={primaryButtonClass} type="submit" disabled={busy}>
          {busy ? "Saving..." : "Record entry"}
        </button>
      </div>
    </form>
  );
}

const maintenanceLabels: Record<ComplianceMaintenanceRow["maintenance_type"], string> = {
  pm_service: "PM service",
  repair: "Repair",
  annual_inspection: "Annual inspection",
};

export function VehicleRosterSection({
  clientId,
  vehicles,
  maintenance,
  documents,
  health,
}: {
  clientId: string;
  vehicles: ComplianceVehicleRow[];
  maintenance: ComplianceMaintenanceRow[];
  documents: ComplianceDocumentOption[];
  health: ComplianceHealth;
}) {
  const [adding, setAdding] = useState(false);
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<string | null>(null);
  const [addingMaintenance, setAddingMaintenance] = useState<string | null>(null);
  const healthByVehicle = useMemo(
    () => new Map(health.vehicles.items.map((item) => [item.id, item])),
    [health.vehicles.items]
  );

  return (
    <SectionFrame
      title={`Vehicles & maintenance (${vehicles.length})`}
      description="The operational fleet roster, annual inspection clock, and maintenance history. This roster is separate from FMCSA census and service-plan billing data."
      action={
        <button className={primaryButtonClass} type="button" onClick={() => setAdding(true)}>
          Add vehicle
        </button>
      }
    >
      <div className="space-y-4 p-5">
        {adding ? (
          <VehicleForm clientId={clientId} onCancel={() => setAdding(false)} />
        ) : null}

        {vehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#D8CAB6] bg-white px-6 py-10 text-center">
            <Truck className="mx-auto h-6 w-6 text-gray-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-[#1E1C1A]">
              No compliance vehicles recorded
            </p>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-gray-500">
              Start with the current unit list, VINs, plates, and each unit&apos;s most
              recent annual DOT inspection date.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map((vehicle) => {
              const expanded = expandedVehicle === vehicle.id;
              const vehicleHealth = healthByVehicle.get(vehicle.id);
              const entries = maintenance.filter(
                (entry) => entry.vehicle_id === vehicle.id
              );
              return (
                <article
                  className="overflow-hidden rounded-lg border border-[#E5D9C8] bg-white"
                  key={vehicle.id}
                >
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E]"
                      aria-expanded={expanded}
                      onClick={() => {
                        setExpandedVehicle(expanded ? null : vehicle.id);
                        setAddingMaintenance(null);
                      }}
                    >
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#1E1C1A]">
                          Unit {vehicle.unit_number ?? "not recorded"}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {[vehicle.year, vehicle.make, vehicle.model]
                            .filter(Boolean)
                            .join(" ") || "Year, make, and model not recorded"}
                          {vehicle.vin ? ` | VIN ${vehicle.vin}` : " | VIN not recorded"}
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                      <RosterStatusBadge status={vehicle.status} />
                      {vehicle.status === "active" ? (
                        <ComplianceStatusBadge
                          status={vehicleHealth?.overallStatus ?? "missing"}
                        />
                      ) : null}
                      <button
                        className={secondaryButtonClass}
                        type="button"
                        onClick={() => setEditingVehicle(vehicle.id)}
                      >
                        Edit vehicle
                      </button>
                    </div>
                  </div>

                  {editingVehicle === vehicle.id ? (
                    <div className="border-t border-[#F0E8DA] p-4">
                      <VehicleForm
                        clientId={clientId}
                        vehicle={vehicle}
                        onCancel={() => setEditingVehicle(null)}
                      />
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="space-y-4 border-t border-[#F0E8DA] bg-[#FEFCF8] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[#1E1C1A]">
                            Annual inspection
                          </p>
                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            Last completed {formatComplianceDate(vehicleHealth?.annualInspectionDate ?? vehicle.annual_inspection_date)} | Due {formatComplianceDate(vehicleHealth?.annualInspectionDueDate)}
                          </p>
                        </div>
                        <button
                          className={primaryButtonClass}
                          type="button"
                          onClick={() =>
                            setAddingMaintenance(
                              addingMaintenance === vehicle.id ? null : vehicle.id
                            )
                          }
                        >
                          <ClipboardPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Log maintenance
                        </button>
                      </div>

                      {addingMaintenance === vehicle.id ? (
                        <MaintenanceForm
                          clientId={clientId}
                          vehicleId={vehicle.id}
                          documents={documents}
                          onCancel={() => setAddingMaintenance(null)}
                        />
                      ) : null}

                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#1E1C1A]">
                          Maintenance history
                        </h3>
                        {entries.length === 0 ? (
                          <p className="mt-2 rounded-lg border border-dashed border-[#D8CAB6] bg-white p-4 text-xs leading-5 text-gray-500">
                            No maintenance entries are on file for this unit. Record the
                            latest PM service, repair, or annual inspection first.
                          </p>
                        ) : (
                          <div className="mt-2 divide-y divide-[#F0E8DA] rounded-lg border border-[#E5D9C8] bg-white">
                            {entries.map((entry) => (
                              <div className="px-3 py-2.5" key={entry.id}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-[#1E1C1A]">
                                    {maintenanceLabels[entry.maintenance_type]}
                                  </p>
                                  <p className="text-[11px] text-gray-500">
                                    {formatComplianceDate(entry.completed_date)}
                                  </p>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-gray-500">
                                  {entry.notes ?? "No work notes recorded."}
                                  {entry.document_id ? " | Document linked" : " | No document linked"}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
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
