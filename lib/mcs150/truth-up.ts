import {
  computeMcs150BiennialClock,
  type Mcs150BiennialClock,
} from "./biennial";

export const MCS150_MILEAGE_RELATIVE_TOLERANCE = 0.1;

export interface Mcs150Official {
  name: string;
  title?: string | null;
  [key: string]: unknown;
}

export interface Mcs150ProfileValues {
  power_units: number | null;
  drivers: number | null;
  annual_mileage: number | null;
  mileage_year: number | null;
  operation_classification?: string | null;
  cargo_types?: string[] | null;
  physical_address?: string | null;
  mailing_address?: string | null;
  officials?: Mcs150Official[] | null;
}

export type Mcs150ProfileField = keyof Mcs150ProfileValues;

export type Mcs150TriggerCode =
  | "power_units_mismatch"
  | "drivers_mismatch"
  | "annual_mileage_mismatch"
  | "mileage_year_mismatch"
  | "census_mileage_year_stale"
  | "operation_classification_mismatch"
  | "cargo_types_mismatch"
  | "physical_address_mismatch"
  | "mailing_address_mismatch"
  | "officials_mismatch"
  | "biennial_due_within_60_days";

export interface Mcs150TruthUpReason {
  code: Mcs150TriggerCode;
  field: Mcs150ProfileField | "biennial_due_date";
  message: string;
}

export interface Mcs150TruthUpDelta {
  field: Mcs150ProfileField;
  censusValue: unknown;
  attestedValue: unknown;
  relativeDifference: number | null;
  reasonCode: Exclude<
    Mcs150TriggerCode,
    "biennial_due_within_60_days"
  >;
  message: string;
}

export interface Mcs150ProfileComparison {
  deltas: Mcs150TruthUpDelta[];
  triggerReasons: Mcs150TruthUpReason[];
  shouldTrigger: boolean;
  fingerprint: string;
}

export interface CompareMcs150ProfilesInput {
  census: Mcs150ProfileValues;
  attested: Mcs150ProfileValues;
  asOf?: Date | string;
}

export type PredictionDirection =
  | "higher"
  | "lower"
  | "unchanged"
  | "unavailable";

export interface Mcs150PredictionMetric {
  label: string;
  before: number | null;
  after: number | null;
  direction: PredictionDirection;
  percentChange: number | null;
  text: string;
}

export interface Mcs150HonestyPrediction {
  burdenPerPowerUnit: Mcs150PredictionMetric;
  mileagePerPowerUnit: Mcs150PredictionMetric;
  driversPerPowerUnit: Mcs150PredictionMetric;
  summary: string;
  disclaimer: string;
}

export interface BuildMcs150HonestyPredictionInput {
  census: Mcs150ProfileValues;
  proposed: Mcs150ProfileValues;
  burdenPoints: number | null;
}

export interface Mcs150TruthUpEvaluation {
  clock: Mcs150BiennialClock;
  comparison: Mcs150ProfileComparison;
  deltas: Mcs150TruthUpDelta[];
  triggerReasons: Mcs150TruthUpReason[];
  dueWithin60Days: boolean;
  shouldTrigger: boolean;
  fingerprint: string;
  honestyPrediction: Mcs150HonestyPrediction;
}

export interface EvaluateMcs150TruthUpInput {
  dotNumber: string | number;
  lastFiledDate: string | null;
  census: Mcs150ProfileValues;
  attested: Mcs150ProfileValues;
  burdenPoints: number | null;
  asOf?: Date | string;
}

export function shouldRunMcs150ScheduledCheck(input: {
  quarterAlreadyChecked: boolean;
  dueWithin60Days: boolean;
  dueWindowAlreadyHandled: boolean;
}): boolean {
  return (
    !input.quarterAlreadyChecked ||
    (input.dueWithin60Days && !input.dueWindowAlreadyHandled)
  );
}

function utcYear(value: Date | string): number {
  if (typeof value === "string") {
    const match = /^(\d{4})/.exec(value);
    if (match) return Number(match[1]);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${String(value)}`);
  }
  return parsed.getUTCFullYear();
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("en-US")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeStringSet(values: string[]): string[] {
  return Array.from(
    new Set(values.map(normalizeText).filter((value) => value.length > 0)),
  ).sort();
}

function normalizeUnknown(value: unknown): unknown {
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map(normalizeUnknown)
      .sort((left, right) =>
        stableSerialize(left).localeCompare(stableSerialize(right)),
      );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeUnknown(entryValue)]),
    );
  }
  return value;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (typeof value === "number" && !Number.isFinite(value)) {
    return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableSerialize(entryValue)}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `mcs150-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function optionalSourceHasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function equalNormalized(
  field: Mcs150ProfileField,
  left: unknown,
  right: unknown,
): boolean {
  if (field === "cargo_types") {
    return (
      stableSerialize(normalizeStringSet((left as string[]) ?? [])) ===
      stableSerialize(normalizeStringSet((right as string[]) ?? []))
    );
  }
  if (field === "officials") {
    return (
      stableSerialize(normalizeUnknown(left ?? [])) ===
      stableSerialize(normalizeUnknown(right ?? []))
    );
  }
  return normalizeText(String(left ?? "")) === normalizeText(String(right ?? ""));
}

function relativeDifference(
  censusValue: number,
  attestedValue: number,
): number {
  if (censusValue === 0) return attestedValue === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(attestedValue - censusValue) / Math.abs(censusValue);
}

/**
 * Compares public census data to carrier-attested values. Core values are
 * compared when the census supplies them. Optional source fields are ignored
 * when the public source has no value, so an unavailable public datum cannot
 * manufacture a discrepancy.
 */
export function compareMcs150Profiles({
  census,
  attested,
  asOf = new Date(),
}: CompareMcs150ProfilesInput): Mcs150ProfileComparison {
  const deltas: Mcs150TruthUpDelta[] = [];
  const triggerReasons: Mcs150TruthUpReason[] = [];

  const addDelta = (
    code: Mcs150TruthUpDelta["reasonCode"],
    field: Mcs150ProfileField,
    censusValue: unknown,
    attestedValue: unknown,
    message: string,
    relative: number | null = null,
  ) => {
    deltas.push({
      field,
      censusValue,
      attestedValue,
      relativeDifference: relative,
      reasonCode: code,
      message,
    });
    triggerReasons.push({ code, field, message });
  };

  if (
    census.power_units !== null &&
    census.power_units !== attested.power_units
  ) {
    addDelta(
      "power_units_mismatch",
      "power_units",
      census.power_units,
      attested.power_units,
      `Census lists ${census.power_units} power units; the attested profile lists ${attested.power_units ?? "no value"}.`,
    );
  }

  if (census.drivers !== null && census.drivers !== attested.drivers) {
    addDelta(
      "drivers_mismatch",
      "drivers",
      census.drivers,
      attested.drivers,
      `Census lists ${census.drivers} drivers; the attested profile lists ${attested.drivers ?? "no value"}.`,
    );
  }

  if (census.annual_mileage !== null) {
    if (attested.annual_mileage === null) {
      addDelta(
        "annual_mileage_mismatch",
        "annual_mileage",
        census.annual_mileage,
        null,
        `Census lists ${census.annual_mileage.toLocaleString("en-US")} annual miles; the attested profile has no mileage.`,
      );
    } else {
      const difference = relativeDifference(
        census.annual_mileage,
        attested.annual_mileage,
      );
      if (
        difference >
        MCS150_MILEAGE_RELATIVE_TOLERANCE + Number.EPSILON * 10
      ) {
        addDelta(
          "annual_mileage_mismatch",
          "annual_mileage",
          census.annual_mileage,
          attested.annual_mileage,
          `Attested annual mileage differs from census by ${Number.isFinite(difference) ? `${(difference * 100).toFixed(1)}%` : "an undefined percentage"}; the tolerance is 10%.`,
          difference,
        );
      }
    }
  }

  if (census.mileage_year !== null) {
    if (census.mileage_year !== attested.mileage_year) {
      addDelta(
        "mileage_year_mismatch",
        "mileage_year",
        census.mileage_year,
        attested.mileage_year,
        `Census mileage is for ${census.mileage_year}; the attested mileage year is ${attested.mileage_year ?? "not recorded"}.`,
      );
    }

    const currentYear = utcYear(asOf);
    if (census.mileage_year < currentYear - 1) {
      addDelta(
        "census_mileage_year_stale",
        "mileage_year",
        census.mileage_year,
        attested.mileage_year,
        `Census mileage year ${census.mileage_year} is stale for ${currentYear}; current mileage evidence is needed.`,
      );
    }
  }

  const optionalFields: Array<{
    field: Extract<
      Mcs150ProfileField,
      | "operation_classification"
      | "cargo_types"
      | "physical_address"
      | "mailing_address"
      | "officials"
    >;
    code: Mcs150TruthUpDelta["reasonCode"];
    label: string;
  }> = [
    {
      field: "operation_classification",
      code: "operation_classification_mismatch",
      label: "Operation classification",
    },
    { field: "cargo_types", code: "cargo_types_mismatch", label: "Cargo types" },
    {
      field: "physical_address",
      code: "physical_address_mismatch",
      label: "Physical address",
    },
    {
      field: "mailing_address",
      code: "mailing_address_mismatch",
      label: "Mailing address",
    },
    { field: "officials", code: "officials_mismatch", label: "Officials" },
  ];

  for (const { field, code, label } of optionalFields) {
    const censusValue = census[field];
    const attestedValue = attested[field];
    if (
      optionalSourceHasValue(censusValue) &&
      !equalNormalized(field, censusValue, attestedValue)
    ) {
      addDelta(
        code,
        field,
        censusValue,
        attestedValue,
        `${label} in the attested profile does not match the public census value.`,
      );
    }
  }

  return {
    deltas,
    triggerReasons,
    shouldTrigger: triggerReasons.length > 0,
    fingerprint: fingerprint({
      deltas: deltas.map(
        ({
          field,
          censusValue,
          attestedValue,
          relativeDifference: relative,
          reasonCode,
        }) => ({
          field,
          censusValue: normalizeUnknown(censusValue),
          attestedValue: normalizeUnknown(attestedValue),
          relativeDifference: relative,
          reasonCode,
        }),
      ),
    }),
  };
}

function finiteRatio(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }
  return numerator / denominator;
}

function predictionMetric(
  label: string,
  before: number | null,
  after: number | null,
): Mcs150PredictionMetric {
  if (before === null || after === null) {
    return {
      label,
      before,
      after,
      direction: "unavailable",
      percentChange: null,
      text: `${label} cannot be estimated because a required value is missing or zero.`,
    };
  }

  const difference = after - before;
  const direction: PredictionDirection =
    Math.abs(difference) < 1e-12
      ? "unchanged"
      : difference > 0
        ? "higher"
        : "lower";
  const percentChange =
    before === 0
      ? after === 0
        ? 0
        : null
      : (Math.abs(difference) / Math.abs(before)) * 100;
  const percentText =
    percentChange === null ? "" : ` (${percentChange.toFixed(1)}% ${direction})`;

  return {
    label,
    before,
    after,
    direction,
    percentChange,
    text:
      direction === "unchanged"
        ? `${label} remains ${before.toFixed(2)}.`
        : `${label} moves from ${before.toFixed(2)} to ${after.toFixed(2)}${percentText}.`,
  };
}

/**
 * Predicts only transparent denominator/utilization direction with the current
 * burden held constant. It intentionally makes no percentile or score promise.
 */
export function buildMcs150HonestyPrediction({
  census,
  proposed,
  burdenPoints,
}: BuildMcs150HonestyPredictionInput): Mcs150HonestyPrediction {
  const burdenPerPowerUnit = predictionMetric(
    "Weighted burden per power unit",
    finiteRatio(burdenPoints, census.power_units),
    finiteRatio(burdenPoints, proposed.power_units),
  );
  const mileagePerPowerUnit = predictionMetric(
    "Annual mileage per power unit",
    finiteRatio(census.annual_mileage, census.power_units),
    finiteRatio(proposed.annual_mileage, proposed.power_units),
  );
  const driversPerPowerUnit = predictionMetric(
    "Drivers per power unit",
    finiteRatio(census.drivers, census.power_units),
    finiteRatio(proposed.drivers, proposed.power_units),
  );
  const disclaimer =
    "This is a directional estimate with current violation burden held constant; it does not predict or promise an official FMCSA measure or percentile.";

  return {
    burdenPerPowerUnit,
    mileagePerPowerUnit,
    driversPerPowerUnit,
    summary: [
      burdenPerPowerUnit.text,
      mileagePerPowerUnit.text,
      driversPerPowerUnit.text,
      disclaimer,
    ].join(" "),
    disclaimer,
  };
}

export function evaluateMcs150TruthUp({
  dotNumber,
  lastFiledDate,
  census,
  attested,
  burdenPoints,
  asOf = new Date(),
}: EvaluateMcs150TruthUpInput): Mcs150TruthUpEvaluation {
  const clock = computeMcs150BiennialClock({
    dotNumber,
    lastFiledDate,
    asOf,
  });
  const comparison = compareMcs150Profiles({ census, attested, asOf });
  const triggerReasons = [...comparison.triggerReasons];

  if (clock.dueWithin60Days) {
    triggerReasons.push({
      code: "biennial_due_within_60_days",
      field: "biennial_due_date",
      message: clock.isOverdue
        ? `The MCS-150 biennial filing is overdue; its assigned deadline was ${clock.nextDueDate}.`
        : `The MCS-150 biennial filing is due ${clock.nextDueDate}, within 60 days.`,
    });
  }

  const combinedFingerprint = fingerprint({
    comparisonFingerprint: comparison.fingerprint,
    nextDueDate: clock.nextDueDate,
    triggerCodes: triggerReasons.map(({ code }) => code).sort(),
  });

  return {
    clock,
    comparison,
    deltas: comparison.deltas,
    triggerReasons,
    dueWithin60Days: clock.dueWithin60Days,
    shouldTrigger: triggerReasons.length > 0,
    fingerprint: combinedFingerprint,
    honestyPrediction: buildMcs150HonestyPrediction({
      census,
      proposed: attested,
      burdenPoints,
    }),
  };
}
