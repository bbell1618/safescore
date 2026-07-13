import {
  ALL_BASIC_CATEGORIES,
  type AllBasicsCategory,
  type AllBasicsExport,
  type OfficialBasicMeasure,
} from "@/lib/fmcsa/all-basics-export-types";

const CATEGORY_ALIASES: Record<string, AllBasicsCategory> = {
  unsafedriving: "unsafe_driving",
  hoursofservicecompliance: "hos_compliance",
  hoscompliance: "hos_compliance",
  driverfitness: "driver_fitness",
  controlledsubstancesalcohol: "controlled_substance",
  controlledsubstancealcohol: "controlled_substance",
  vehiclemaintenance: "vehicle_maintenance",
  hazardousmaterialscompliance: "hazmat_compliance",
  hazmatcompliance: "hazmat_compliance",
  crashindicator: "crash_indicator",
};

const LABELS: Record<AllBasicsCategory, string> = {
  unsafe_driving: "Unsafe Driving",
  hos_compliance: "Hours-of-Service Compliance",
  driver_fitness: "Driver Fitness",
  controlled_substance: "Controlled Substances/Alcohol",
  vehicle_maintenance: "Vehicle Maintenance",
  hazmat_compliance: "Hazardous Materials Compliance",
  crash_indicator: "Crash Indicator",
};

export function parseAllBasicsExport(source: string): AllBasicsExport {
  const rows = parseCsv(source.replace(/^\uFEFF/, "")).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );
  if (rows.length < 2) throw new Error("All BASICs export has no data rows");

  const headers = rows[0].map(normalizeHeader);
  const column = (aliases: string[], required = true) => {
    const index = headers.findIndex((header) => aliases.includes(header));
    if (index < 0 && required) {
      throw new Error(`All BASICs export is missing column: ${aliases[0]}`);
    }
    return index;
  };

  const dateIndex = column(["snapshotdate", "date", "measurementdate"]);
  const basicIndex = column(["basic", "basicname", "category"]);
  const measureIndex = column(["measure", "measurevalue"]);
  const percentileIndex = column(["percentile", "percent", "percentilerank"]);
  const thresholdIndex = column(["threshold", "interventionthreshold"]);
  const alertIndex = column(["alert", "alertstatus", "status"]);
  const detailIndex = column(["detail", "details", "notes"], false);

  let snapshotDate: string | null = null;
  const basics = {} as Partial<Record<AllBasicsCategory, OfficialBasicMeasure>>;

  for (const [offset, row] of rows.slice(1).entries()) {
    const rowNumber = offset + 2;
    const category = CATEGORY_ALIASES[normalizeName(row[basicIndex] ?? "")];
    if (!category) {
      throw new Error(`Unknown BASIC category on row ${rowNumber}: ${row[basicIndex] ?? ""}`);
    }
    if (basics[category]) {
      throw new Error(`Duplicate BASIC category on row ${rowNumber}: ${LABELS[category]}`);
    }

    const rowDate = normalizeDate(row[dateIndex] ?? "", rowNumber);
    if (snapshotDate && snapshotDate !== rowDate) {
      throw new Error(`All BASICs export contains multiple snapshot dates`);
    }
    snapshotDate = rowDate;

    basics[category] = {
      label: LABELS[category],
      measure: nullableNumber(row[measureIndex], "measure", rowNumber),
      percentile: nullableNumber(row[percentileIndex], "percentile", rowNumber),
      threshold: nullableNumber(row[thresholdIndex], "threshold", rowNumber),
      alert: parseAlert(row[alertIndex] ?? "", rowNumber),
      detail: detailIndex >= 0 ? nullableText(row[detailIndex]) : null,
    };
  }

  const missing = ALL_BASIC_CATEGORIES.filter((category) => !basics[category]);
  if (missing.length > 0) {
    throw new Error(`All BASICs export is missing: ${missing.map((item) => LABELS[item]).join(", ")}`);
  }

  return {
    snapshotDate: snapshotDate!,
    basics: basics as Record<AllBasicsCategory, OfficialBasicMeasure>,
  };
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }

  if (quoted) throw new Error("All BASICs export contains an unclosed quoted field");
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string) {
  return normalizeName(value);
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeDate(value: string, rowNumber: number) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }
  throw new Error(`Invalid snapshot date on row ${rowNumber}: ${trimmed}`);
}

function nullableNumber(value: string | undefined, label: string, rowNumber: number) {
  const trimmed = (value ?? "").trim().replace(/[%,$]/g, "");
  if (trimmed === "" || /^(n\/a|not available|--?)$/i.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} on row ${rowNumber}`);
  return parsed;
}

function parseAlert(value: string, rowNumber: number) {
  const normalized = value.trim().toLowerCase();
  if (["yes", "y", "true", "1", "alert", "above threshold"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "none", "not alert", "below threshold"].includes(normalized)) return false;
  throw new Error(`Invalid alert flag on row ${rowNumber}: ${value}`);
}

function nullableText(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}
