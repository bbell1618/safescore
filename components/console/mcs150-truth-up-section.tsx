"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Save,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  Mcs150ProfileField,
  Mcs150ProfileValues,
  Mcs150TruthUpEvaluation,
  Mcs150TruthUpReason,
} from "@/lib/mcs150/truth-up";
import { formatDate } from "@/lib/utils";

type AttestedProfile = {
  id: string;
  client_id: string;
  power_units: number | null;
  drivers: number | null;
  annual_mileage: number | null;
  mileage_year: number | null;
  operation_classification: string | null;
  cargo_types: string[];
  physical_address: string | null;
  mailing_address: string | null;
  officials: Array<{ name: string; title?: string | null }>;
  source: "census_default" | "operator_recorded";
  attested_at: string | null;
  attested_by: string | null;
  created_at: string;
  updated_at: string;
};

type CensusPayload = Mcs150ProfileValues & {
  last_filed_date: string | null;
  safer_as_of: string | null;
  fetched_at: string;
};

type OpenUpdate = {
  id: string;
  status: "draft" | "pending_review" | "submitted";
  proposed_changes: Record<string, unknown>;
  trigger_reasons: Mcs150TruthUpReason[] | null;
  honesty_prediction: Record<string, unknown> | null;
  biennial_due_date: string | null;
  client_request_id: string | null;
  submitted_date: string | null;
  created_at: string;
  updated_at: string;
};

type Mcs150ApiState = {
  attestedProfile: AttestedProfile;
  census: CensusPayload;
  latestBurden: {
    id: string;
    total_points: number;
    snapshot_date: string;
    captured_at: string;
  } | null;
  openUpdates: OpenUpdate[];
  evaluation: Mcs150TruthUpEvaluation;
};

type EditForm = {
  powerUnits: string;
  drivers: string;
  annualMileage: string;
  mileageYear: string;
  operationClassification: string;
  cargoTypes: string;
  physicalAddress: string;
  mailingAddress: string;
  officials: string;
};

const EMPTY_FORM: EditForm = {
  powerUnits: "",
  drivers: "",
  annualMileage: "",
  mileageYear: "",
  operationClassification: "",
  cargoTypes: "",
  physicalAddress: "",
  mailingAddress: "",
  officials: "",
};

function profileForm(profile: AttestedProfile): EditForm {
  return {
    powerUnits:
      profile.power_units === null ? "" : String(profile.power_units),
    drivers: profile.drivers === null ? "" : String(profile.drivers),
    annualMileage:
      profile.annual_mileage === null ? "" : String(profile.annual_mileage),
    mileageYear:
      profile.mileage_year === null ? "" : String(profile.mileage_year),
    operationClassification: profile.operation_classification ?? "",
    cargoTypes: profile.cargo_types.join(", "),
    physicalAddress: profile.physical_address ?? "",
    mailingAddress: profile.mailing_address ?? "",
    officials: profile.officials
      .map((official) =>
        official.title
          ? `${official.name} | ${official.title}`
          : official.name
      )
      .join("\n"),
  };
}

function requiredInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${label} must be a whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative whole number.`);
  }
  return parsed;
}

function displayValue(
  field: Mcs150ProfileField,
  value: Mcs150ProfileValues[Mcs150ProfileField]
): string {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }
  if (field === "cargo_types") {
    const values = value as string[];
    return values.length > 0 ? values.join(", ") : "Not available";
  }
  if (field === "officials") {
    const officials = value as Array<{ name: string; title?: string | null }>;
    return officials.length > 0
      ? officials
          .map((official) =>
            official.title
              ? `${official.name} (${official.title})`
              : official.name
          )
          .join(", ")
      : "Not available";
  }
  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }
  return String(value);
}

function readableStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pacificToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function Mcs150TruthUpSection({ clientId }: { clientId: string }) {
  const [state, setState] = useState<Mcs150ApiState | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submissionDates, setSubmissionDates] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/clients/${clientId}/mcs150-attested`,
          { cache: "no-store", signal: controller.signal }
        );
        const body = (await response.json()) as Mcs150ApiState & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Unable to load MCS-150 truth-up.");
        }
        setState(body);
        setForm(profileForm(body.attestedProfile));
        setSubmissionDates(
          Object.fromEntries(
            body.openUpdates.map((update) => [
              update.id,
              update.submitted_date ?? pacificToday(),
            ])
          )
        );
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load MCS-150 truth-up."
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [clientId]);

  function change(field: keyof EditForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const mileageYear = requiredInteger(form.mileageYear, "Mileage year");
      if (mileageYear < 1900 || mileageYear > 2100) {
        throw new Error("Mileage year must be between 1900 and 2100.");
      }
      const cargoTypes = Array.from(
        new Set(
          form.cargoTypes
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        )
      );
      const officials = form.officials
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const [namePart, ...titleParts] = line.split("|");
          const name = namePart.trim();
          const title = titleParts.join("|").trim();
          if (!name) {
            throw new Error(
              `Official on line ${index + 1} requires a name.`
            );
          }
          if (name.length > 160 || title.length > 160) {
            throw new Error(
              `Official on line ${index + 1} exceeds 160 characters.`
            );
          }
          return { name, title: title || null };
        });
      if (officials.length > 50) {
        throw new Error("No more than 50 officials can be recorded.");
      }
      const response = await fetch(
        `/api/clients/${clientId}/mcs150-attested`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            power_units: requiredInteger(form.powerUnits, "Power units"),
            drivers: requiredInteger(form.drivers, "Drivers"),
            annual_mileage: requiredInteger(
              form.annualMileage,
              "Annual mileage"
            ),
            mileage_year: mileageYear,
            operation_classification:
              form.operationClassification.trim() || null,
            cargo_types: cargoTypes,
            physical_address: form.physicalAddress.trim() || null,
            mailing_address: form.mailingAddress.trim() || null,
            officials,
          }),
        }
      );
      const body = (await response.json()) as Mcs150ApiState & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save attested values.");
      }
      setState(body);
      setForm(profileForm(body.attestedProfile));
      setSubmissionDates(
        Object.fromEntries(
          body.openUpdates.map((update) => [
            update.id,
            update.submitted_date ?? pacificToday(),
          ])
        )
      );
      setMessage("Attested operating values saved and re-evaluated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save attested values."
      );
    } finally {
      setSaving(false);
    }
  }

  async function recordSubmission(updateId: string) {
    setSubmittingId(updateId);
    setError(null);
    setMessage(null);
    try {
      const submittedDate = submissionDates[updateId] ?? pacificToday();
      const response = await fetch(
        `/api/clients/${clientId}/mcs150-attested`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "record_submission",
            update_id: updateId,
            submitted_date: submittedDate,
          }),
        }
      );
      const body = (await response.json()) as Mcs150ApiState & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.error ?? "Unable to record the carrier submission."
        );
      }
      setState(body);
      setForm(profileForm(body.attestedProfile));
      setSubmissionDates(
        Object.fromEntries(
          body.openUpdates.map((update) => [
            update.id,
            update.submitted_date ?? pacificToday(),
          ])
        )
      );
      setMessage(
        "Carrier submission recorded. The request stays open until a newer matching FMCSA census is observed."
      );
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unable to record the carrier submission."
      );
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return (
      <section
        className="rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-6"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading MCS-150 truth-up…
        </div>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-medium text-red-800">
          MCS-150 truth-up could not be loaded.
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const comparisonFields: Array<{
    field: Mcs150ProfileField;
    label: string;
  }> = [
    { field: "power_units", label: "Power units" },
    { field: "drivers", label: "Drivers" },
    { field: "annual_mileage", label: "Annual mileage" },
    { field: "mileage_year", label: "Mileage year" },
    {
      field: "operation_classification",
      label: "Operation classification",
    },
    { field: "cargo_types", label: "Cargo types" },
    { field: "physical_address", label: "Physical address" },
    { field: "mailing_address", label: "Mailing address" },
    { field: "officials", label: "Company officials" },
  ];
  const attestedValues: Mcs150ProfileValues = {
    power_units: state.attestedProfile.power_units,
    drivers: state.attestedProfile.drivers,
    annual_mileage: state.attestedProfile.annual_mileage,
    mileage_year: state.attestedProfile.mileage_year,
    operation_classification:
      state.attestedProfile.operation_classification,
    cargo_types: state.attestedProfile.cargo_types,
    physical_address: state.attestedProfile.physical_address,
    mailing_address: state.attestedProfile.mailing_address,
    officials: state.attestedProfile.officials,
  };
  const mismatchFields = new Set(
    state.evaluation.deltas.map((delta) => delta.field)
  );
  const clock = state.evaluation.clock;
  const predictionMetrics = [
    state.evaluation.honestyPrediction.burdenPerPowerUnit,
    state.evaluation.honestyPrediction.mileagePerPowerUnit,
    state.evaluation.honestyPrediction.driversPerPowerUnit,
  ];

  return (
    <section className="space-y-5 rounded-xl border border-[#E8D8BF] bg-[#FBF7F0] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-[#C67A1E]" />
            <h2 className="text-base font-bold text-[#1E1C1A]">
              MCS-150 truth-up
            </h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Quarterly census comparison and carrier-attested correction
            preparation.
          </p>
        </div>
        {state.attestedProfile.source === "operator_recorded" ? (
          <Badge variant="success">
            Operator-recorded {formatDate(state.attestedProfile.attested_at)}
          </Badge>
        ) : (
          <Badge variant="warning">Census default — not yet recorded</Badge>
        )}
      </div>

      <div className="rounded-lg border border-[#E8D8BF] bg-white p-4">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#C67A1E]" />
          <div>
            <p className="text-sm font-semibold text-[#1E1C1A]">
              Carrier attestation and submission are required
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              SafeScore prepares the comparison and correction packet. The
              carrier attests to the facts and submits through its own
              Login.gov account. SafeScore never files an MCS-150.
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              The attested driver value is a census comparison fact only. It
              does not change the client-stated driver count used for billing.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-[#F0E8DA] bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Last filed
          </p>
          <p className="mt-1 text-sm font-semibold text-[#1E1C1A]">
            {formatDate(clock.lastFiledDate)}
          </p>
        </div>
        <div className="rounded-lg border border-[#F0E8DA] bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Next due
          </p>
          <p className="mt-1 text-sm font-semibold text-[#1E1C1A]">
            {formatDate(clock.nextDueDate)}
          </p>
        </div>
        <div className="rounded-lg border border-[#F0E8DA] bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Days remaining
          </p>
          <p
            className={`mt-1 text-sm font-semibold ${
              clock.isOverdue
                ? "text-red-700"
                : clock.dueWithin60Days
                  ? "text-amber-700"
                  : "text-[#1E1C1A]"
            }`}
          >
            {clock.isOverdue
              ? `${Math.abs(clock.daysRemaining)} overdue`
              : clock.daysRemaining.toLocaleString("en-US")}
          </p>
        </div>
        <div className="rounded-lg border border-[#F0E8DA] bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Assigned cycle
          </p>
          <p className="mt-1 text-sm font-semibold capitalize text-[#1E1C1A]">
            Month {clock.dueMonth} · {clock.dueYearParity} years
          </p>
        </div>
      </div>
      <p className="-mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
        <CalendarClock className="h-3.5 w-3.5" />
        FMCSA rule: the last USDOT digit selects the month; the next-to-last
        digit selects odd or even filing years. Filing is due by month end.
      </p>

      <div className="overflow-hidden rounded-lg border border-[#F0E8DA] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0E8DA] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-[#1E1C1A]">
              Census vs. attested profile
            </h3>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Public source as of {formatDate(state.census.safer_as_of)} ·
              fetched {formatDate(state.census.fetched_at)}
            </p>
          </div>
          {state.evaluation.shouldTrigger ? (
            <Badge variant="warning">
              {state.evaluation.triggerReasons.length} review trigger
              {state.evaluation.triggerReasons.length === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="success">No trigger</Badge>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FCFAF6] text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Field</th>
                <th className="px-4 py-2.5 font-medium">Public census</th>
                <th className="px-4 py-2.5 font-medium">Attested</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E8DA]">
              {comparisonFields.map(({ field, label }) => {
                const censusValue = state.census[field];
                const attestedValue = attestedValues[field];
                const sourceUnavailable =
                  censusValue === null ||
                  censusValue === undefined ||
                  censusValue === "" ||
                  (Array.isArray(censusValue) && censusValue.length === 0);
                const mismatch = mismatchFields.has(field);
                const mileageWithinTolerance =
                  field === "annual_mileage" &&
                  !mismatch &&
                  censusValue !== attestedValue;
                return (
                  <tr key={field}>
                    <th className="px-4 py-3 font-medium text-[#1E1C1A]">
                      {label}
                    </th>
                    <td className="max-w-[240px] px-4 py-3 text-gray-600">
                      {displayValue(field, censusValue)}
                    </td>
                    <td className="max-w-[240px] px-4 py-3 text-gray-600">
                      {displayValue(field, attestedValue)}
                    </td>
                    <td className="px-4 py-3">
                      {sourceUnavailable ? (
                        <span className="text-gray-400">
                          Source unavailable
                        </span>
                      ) : mismatch ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Review
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-green-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {mileageWithinTolerance
                            ? "Within 10% tolerance"
                            : "Aligned"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-[#E4D6BD] bg-[#F8F1E5] p-4">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-[#8E7340]" />
          <h3 className="text-sm font-semibold text-[#1E1C1A]">
            Predict before filing
          </h3>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          {predictionMetrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-[#E8D8BF] bg-white p-3"
            >
              <p className="text-[11px] font-medium text-gray-500">
                {metric.label}
              </p>
              <p className="mt-1 text-sm font-semibold text-[#1E1C1A]">
                {metric.before === null ? "Unavailable" : metric.before.toFixed(2)}
                {" → "}
                {metric.after === null ? "Unavailable" : metric.after.toFixed(2)}
              </p>
              <p className="mt-1 text-[11px] capitalize text-gray-500">
                Direction: {metric.direction}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-600">
          {state.evaluation.honestyPrediction.summary}
        </p>
        {!state.latestBurden && (
          <p className="mt-1 text-[11px] text-amber-700">
            No burden snapshot is available, so burden-per-power-unit direction
            cannot be calculated.
          </p>
        )}
      </div>

      <form
        className="rounded-lg border border-[#F0E8DA] bg-white p-4"
        onSubmit={save}
      >
        <div>
          <h3 className="text-sm font-semibold text-[#1E1C1A]">
            Record carrier-attested operating values
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Record only values the carrier has confirmed. Saving does not
            submit anything to FMCSA.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="text-xs font-medium text-gray-600">
            Power units
            <input
              required
              type="number"
              min="0"
              step="1"
              value={form.powerUnits}
              onChange={(event) => change("powerUnits", event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Drivers
            <input
              required
              type="number"
              min="0"
              step="1"
              value={form.drivers}
              onChange={(event) => change("drivers", event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Annual mileage
            <input
              required
              type="number"
              min="0"
              step="1"
              value={form.annualMileage}
              onChange={(event) =>
                change("annualMileage", event.target.value)
              }
              className="mt-1 w-full rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Mileage year
            <input
              required
              type="number"
              min="1900"
              max="2100"
              step="1"
              value={form.mileageYear}
              onChange={(event) => change("mileageYear", event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-xs font-medium text-gray-600">
            Operation classification
            <input
              type="text"
              value={form.operationClassification}
              onChange={(event) =>
                change("operationClassification", event.target.value)
              }
              className="mt-1 w-full rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Cargo types
            <input
              type="text"
              value={form.cargoTypes}
              onChange={(event) => change("cargoTypes", event.target.value)}
              aria-describedby="mcs150-cargo-help"
              className="mt-1 w-full rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
            <span
              id="mcs150-cargo-help"
              className="mt-1 block text-[11px] font-normal text-gray-400"
            >
              Separate multiple cargo types with commas.
            </span>
          </label>
          <label className="text-xs font-medium text-gray-600">
            Physical address
            <textarea
              rows={2}
              value={form.physicalAddress}
              onChange={(event) =>
                change("physicalAddress", event.target.value)
              }
              className="mt-1 w-full resize-y rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Mailing address
            <textarea
              rows={2}
              value={form.mailingAddress}
              onChange={(event) =>
                change("mailingAddress", event.target.value)
              }
              className="mt-1 w-full resize-y rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
          </label>
          <label className="text-xs font-medium text-gray-600 md:col-span-2">
            Company officials
            <textarea
              rows={3}
              value={form.officials}
              onChange={(event) => change("officials", event.target.value)}
              aria-describedby="mcs150-officials-help"
              className="mt-1 w-full resize-y rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-sm text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
            />
            <span
              id="mcs150-officials-help"
              className="mt-1 block text-[11px] font-normal text-gray-400"
            >
              Enter one official per line as Name | Title.
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#C67A1E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#B86E18] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? "Saving…" : "Record attested values"}
          </button>
          {message && (
            <p className="text-xs text-green-700" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>

      <div className="rounded-lg border border-[#F0E8DA] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[#1E1C1A]">
            Open correction drafts
          </h3>
          <Badge variant={state.openUpdates.length > 0 ? "warning" : "outline"}>
            {state.openUpdates.length}
          </Badge>
        </div>
        {state.openUpdates.length === 0 ? (
          <p className="mt-3 text-xs leading-5 text-gray-500">
            No open MCS-150 correction draft. The quarterly check creates one
            only when a material mismatch exists or the biennial deadline is
            within 60 days.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {state.openUpdates.map((update) => {
              const reasons = Array.isArray(update.trigger_reasons)
                ? update.trigger_reasons
                : [];
              const storedSummary =
                typeof update.honesty_prediction?.summary === "string"
                  ? update.honesty_prediction.summary
                  : null;
              return (
                <article
                  key={update.id}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">
                        {readableStatus(update.status)}
                      </Badge>
                      <span className="text-[11px] text-gray-500">
                        Created {formatDate(update.created_at)}
                      </span>
                    </div>
                    {update.biennial_due_date && (
                      <span className="text-[11px] text-gray-600">
                        Due {formatDate(update.biennial_due_date)}
                      </span>
                    )}
                  </div>
                  {reasons.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-gray-700">
                      {reasons.map((reason) => (
                        <li key={reason.code}>• {reason.message}</li>
                      ))}
                    </ul>
                  )}
                  {storedSummary && (
                    <p className="mt-2 text-xs leading-5 text-gray-600">
                      {storedSummary}
                    </p>
                  )}
                  {update.status === "submitted" ? (
                    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs font-medium text-blue-800">
                        Carrier submission recorded
                        {update.submitted_date
                          ? ` ${formatDate(update.submitted_date)}`
                          : ""}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-blue-700">
                        SafeScore is waiting for a newer public MCS-150 filing
                        date whose census values match the recorded proposal.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
                      <p className="text-xs font-medium text-[#1E1C1A]">
                        After the carrier submits
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-gray-500">
                        Use this only after the carrier has attested and
                        submitted through its own Login.gov account. This
                        records the event; SafeScore does not file the form.
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="text-[11px] font-medium text-gray-600">
                          Carrier submission date
                          <input
                            type="date"
                            max={pacificToday()}
                            value={
                              submissionDates[update.id] ?? pacificToday()
                            }
                            onChange={(event) =>
                              setSubmissionDates((current) => ({
                                ...current,
                                [update.id]: event.target.value,
                              }))
                            }
                            className="mt-1 block rounded-lg border border-[#E4D6BD] bg-white px-3 py-2 text-xs text-[#1E1C1A] outline-none focus:border-[#C67A1E]"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            submittingId === update.id ||
                            state.attestedProfile.source !==
                              "operator_recorded"
                          }
                          onClick={() => void recordSubmission(update.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#1E1C1A] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {submittingId === update.id && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          Record carrier submission
                        </button>
                      </div>
                      {state.attestedProfile.source !==
                        "operator_recorded" && (
                        <p className="mt-2 text-[11px] text-amber-700">
                          Record carrier-attested values before recording a
                          submission.
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-2 font-mono text-[10px] text-gray-400">
                    Update {update.id}
                    {update.client_request_id
                      ? ` · request ${update.client_request_id}`
                      : ""}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
