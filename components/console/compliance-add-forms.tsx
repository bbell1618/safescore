"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clientId: string;
}

// ── Add Driver ──────────────────────────────────────────────────────────────

export function AddDriverButton({ clientId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    cdl_number: "",
    cdl_state: "",
    cdl_expiry: "",
    medical_cert_expiry: "",
  });

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Driver name is required.");
      return;
    }
    if (form.cdl_state && form.cdl_state.length !== 2) {
      setError("CDL state must be a 2-character abbreviation (e.g. TX).");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/drivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add driver.");
        return;
      }
      setOpen(false);
      setForm({ name: "", cdl_number: "", cdl_state: "", cdl_expiry: "", medical_cert_expiry: "" });
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-[#DC362E] hover:underline"
      >
        + Add driver
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 mx-4 mb-3 p-4 rounded-xl border border-[#E5E5E5] bg-[#F8F8F8] space-y-3"
        >
          <p className="text-xs font-semibold text-[#1A1A1A] mb-1">New driver</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Full name"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CDL number</label>
              <input
                type="text"
                value={form.cdl_number}
                onChange={(e) => update("cdl_number", e.target.value)}
                placeholder="CDL number"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CDL state</label>
              <input
                type="text"
                value={form.cdl_state}
                onChange={(e) => update("cdl_state", e.target.value.toUpperCase().slice(0, 2))}
                placeholder="TX"
                maxLength={2}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CDL expiry</label>
              <input
                type="date"
                value={form.cdl_expiry}
                onChange={(e) => update("cdl_expiry", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Medical cert expiry</label>
              <input
                type="date"
                value={form.medical_cert_expiry}
                onChange={(e) => update("medical_cert_expiry", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
          </div>

          {error && <p className="text-xs text-[#DC362E]">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              className="flex-1 py-2 text-xs font-medium border border-[#E5E5E5] rounded-lg hover:border-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-xs font-semibold bg-[#DC362E] text-white rounded-lg hover:bg-[#b52a23] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Add driver"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Add Vehicle ─────────────────────────────────────────────────────────────

export function AddVehicleButton({ clientId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    unit_number: "",
    vin: "",
    make: "",
    year: "",
    license_plate: "",
  });

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.year && (isNaN(Number(form.year)) || Number(form.year) < 1900 || Number(form.year) > 2100)) {
      setError("Year must be a valid 4-digit year.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, year: form.year ? Number(form.year) : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add vehicle.");
        return;
      }
      setOpen(false);
      setForm({ unit_number: "", vin: "", make: "", year: "", license_plate: "" });
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-[#DC362E] hover:underline"
      >
        + Add vehicle
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 mx-4 mb-3 p-4 rounded-xl border border-[#E5E5E5] bg-[#F8F8F8] space-y-3"
        >
          <p className="text-xs font-semibold text-[#1A1A1A] mb-1">New vehicle</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit number</label>
              <input
                type="text"
                value={form.unit_number}
                onChange={(e) => update("unit_number", e.target.value)}
                placeholder="e.g. 101"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Year</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => update("year", e.target.value)}
                placeholder="2022"
                min={1900}
                max={2100}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Make</label>
              <input
                type="text"
                value={form.make}
                onChange={(e) => update("make", e.target.value)}
                placeholder="Peterbilt"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">License plate</label>
              <input
                type="text"
                value={form.license_plate}
                onChange={(e) => update("license_plate", e.target.value)}
                placeholder="ABC1234"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">VIN</label>
              <input
                type="text"
                value={form.vin}
                onChange={(e) => update("vin", e.target.value)}
                placeholder="17-character VIN"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#DC362E]/20"
              />
            </div>
          </div>

          {error && <p className="text-xs text-[#DC362E]">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              className="flex-1 py-2 text-xs font-medium border border-[#E5E5E5] rounded-lg hover:border-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-xs font-semibold bg-[#DC362E] text-white rounded-lg hover:bg-[#b52a23] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Add vehicle"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
