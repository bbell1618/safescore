// lib/fmcsa/datahub-client.ts
// FMCSA data via DOT Data Portal Socrata API
// Inspection headers: https://data.transportation.gov/resource/fx4q-ay7w.json
// Violations (SMS):   https://data.transportation.gov/resource/8mt8-2mdr.json
// Crashes:            https://data.transportation.gov/resource/e6mz-jbpz.json (attempt; may 404)
// No key required; X-App-Token header optional to avoid rate limiting

const INSPECTION_ENDPOINT = "https://data.transportation.gov/resource/fx4q-ay7w.json";
const VIOLATION_ENDPOINT  = "https://data.transportation.gov/resource/8mt8-2mdr.json";
const CRASH_ENDPOINT      = "https://data.transportation.gov/resource/e6mz-jbpz.json";

export interface DatahubInspection {
  reportNumber: string;
  inspectionDate: string; // YYYYMMDD format from API
  reportState: string;
  level: number; // insp_level_id
  facilityName: string;
  violTotal: number;
  oosTotal: number;
  driverViolTotal: number;
  driverOosTotal: number;
  vehicleViolTotal: number;
  vehicleOosTotal: number;
  hazmatViolTotal: number;
  hazmatOosTotal: number;
  postAccident: boolean;
  carrierName: string;
}

export interface DatahubViolation {
  uniqueId: string;       // inspection-level grouping key (multiple violations share same uniqueId)
  inspectionDate: string; // normalized to YYYY-MM-DD
  violationCode: string;  // viol_code
  description: string;    // section_desc
  basicCategory: string;  // normalized from basic_desc
  severityWeight: number;
  oosViolation: boolean;
  oosWeight: number;
  timeWeight: number;
}

export interface DatahubCrash {
  reportNumber: string;
  crashDate: string;
  reportState: string;
  fatalities: number;
  injuries: number;
  towAway: boolean;
  hazmatRelease: boolean;
}

async function fetchSocrata<T>(url: string): Promise<T[]> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
  };
  const appToken = process.env.FMCSA_DATAHUB_APP_TOKEN;
  if (appToken) headers["X-App-Token"] = appToken;

  const res = await fetch(url, { headers, next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`Socrata API error: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json() as Promise<T[]>;
}

/**
 * Parse violation date "13-MAR-24" → "2024-03-13"
 */
function parseViolDate(ddMonYY: string): string {
  const MONTHS: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const parts = (ddMonYY ?? "").split("-");
  if (parts.length !== 3) return ddMonYY;
  const [dd, mon, yy] = parts;
  const year = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
  return `${year}-${MONTHS[mon.toUpperCase()] ?? "01"}-${dd.padStart(2, "0")}`;
}

/**
 * Normalize basic_desc from Socrata violation dataset to our internal category keys
 */
function normalizeBASIC(basicDesc: string): string {
  const b = (basicDesc ?? "").toLowerCase();
  if (b.includes("unsafe")) return "unsafe_driving";
  if (b.includes("hours") || b.includes("hos")) return "hos_compliance";
  if (b.includes("driver") && b.includes("fit")) return "driver_fitness";
  if (b.includes("controlled") || b.includes("substance") || b.includes("alcohol")) return "controlled_substance";
  if (b.includes("hazardous") || b.includes("hazmat")) return "hazmat_compliance";
  if (b.includes("crash")) return "crash_indicator";
  return "vehicle_maintenance";
}

export async function getInspectionsByDot(dot: string): Promise<DatahubInspection[]> {
  try {
    const url = `${INSPECTION_ENDPOINT}?dot_number=${encodeURIComponent(dot)}&$limit=200&$order=insp_date+DESC`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchSocrata<any>(url);

    return rows.map((r) => ({
      reportNumber: String(r.report_number ?? ""),
      inspectionDate: String(r.insp_date ?? ""),
      reportState: String(r.report_state ?? ""),
      level: Number(r.insp_level_id ?? 0),
      facilityName: String(r.insp_facility ?? ""),
      violTotal: Number(r.viol_total ?? 0),
      oosTotal: Number(r.oos_total ?? 0),
      driverViolTotal: Number(r.driver_viol_total ?? 0),
      driverOosTotal: Number(r.driver_oos_total ?? 0),
      vehicleViolTotal: Number(r.vehicle_viol_total ?? 0),
      vehicleOosTotal: Number(r.vehicle_oos_total ?? 0),
      hazmatViolTotal: Number(r.hazmat_viol_total ?? 0),
      hazmatOosTotal: Number(r.hazmat_oos_total ?? 0),
      postAccident: String(r.post_acc_ind ?? "N") === "Y",
      carrierName: String(r.insp_carrier_name ?? ""),
    }));
  } catch (err) {
    console.error(`Socrata inspection fetch failed for DOT ${dot}:`, err);
    return [];
  }
}

/**
 * Fetch individual violation records from the SMS Input - Violation dataset.
 * Returns violations grouped by normalized inspection date so they can be
 * attached to the matching inspection record.
 */
export async function getViolationsByDot(dot: string): Promise<DatahubViolation[]> {
  try {
    // Fetch up to 1000 violations; most carriers have far fewer
    const url = `${VIOLATION_ENDPOINT}?dot_number=${encodeURIComponent(dot)}&$limit=1000&$order=insp_date+DESC`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchSocrata<any>(url);

    return rows.map((r) => ({
      uniqueId: String(r.unique_id ?? ""),
      inspectionDate: parseViolDate(String(r.insp_date ?? "")),
      violationCode: String(r.viol_code ?? ""),
      description: String(r.section_desc ?? r.basic_desc ?? ""),
      basicCategory: normalizeBASIC(String(r.basic_desc ?? "")),
      severityWeight: Number(r.severity_weight ?? 1),
      oosViolation: String(r.oos_indicator ?? "false").toLowerCase() === "true",
      oosWeight: Number(r.oos_weight ?? 0),
      timeWeight: Number(r.time_weight ?? 1),
    }));
  } catch (err) {
    console.error(`Socrata violation fetch failed for DOT ${dot}:`, err);
    return [];
  }
}

export async function getCrashesByDot(dot: string): Promise<DatahubCrash[]> {
  try {
    const url = `${CRASH_ENDPOINT}?dot_number=${encodeURIComponent(dot)}&$limit=100&$order=crash_date+DESC`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchSocrata<any>(url);

    return rows.map((r) => ({
      reportNumber: String(r.report_number ?? r.reportNumber ?? ""),
      crashDate: String(r.crash_date ?? r.crashDate ?? ""),
      reportState: String(r.report_state ?? r.reportState ?? ""),
      fatalities: Number(r.fatalities ?? r.fatal ?? 0),
      injuries: Number(r.injuries ?? 0),
      towAway: Number(r.towaways ?? r.tow_away ?? 0) > 0,
      hazmatRelease: r.hazmat_release === "Y" || r.hazmat_released === "Y" || r.hazmat_release === true,
    }));
  } catch (err) {
    // Crash endpoint may not exist yet — log and return empty
    console.warn(`Socrata crash fetch failed for DOT ${dot} (endpoint may not exist):`, err);
    return [];
  }
}
