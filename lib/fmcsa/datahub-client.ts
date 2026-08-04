// lib/fmcsa/datahub-client.ts
// FMCSA data via DOT Data Portal Socrata API
// SMS calculation inspection headers: https://data.transportation.gov/resource/rbkj-cgst.json
// Violations (SMS):   https://data.transportation.gov/resource/8mt8-2mdr.json
// Daily crash facts:  https://data.transportation.gov/resource/aayw-vxb3.json (FMCSA Crash File)
// SMS crash facts:    https://data.transportation.gov/resource/4wxs-vbns.json (SMS Input - Crash)
// No key required; X-App-Token header optional to avoid rate limiting

const INSPECTION_ENDPOINT = "https://data.transportation.gov/resource/rbkj-cgst.json";
const VIOLATION_ENDPOINT  = "https://data.transportation.gov/resource/8mt8-2mdr.json";
// Correct FMCSA Crash File resource. The prior id (e6mz-jbpz) is dead (404),
// which silently returned empty crash arrays for every carrier.
const CRASH_ENDPOINT      = "https://data.transportation.gov/resource/aayw-vxb3.json";
const SMS_CRASH_ENDPOINT  = "https://data.transportation.gov/resource/4wxs-vbns.json";

export interface DatahubInspection {
  uniqueId: string;
  reportNumber: string;
  inspectionDate: string; // normalized YYYY-MM-DD
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
  timeWeight: number;
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
  reportSequenceNumber: string | null;
  crashDate: string; // normalized to YYYY-MM-DD
  reportState: string;
  city: string;
  location: string | null;
  fatalities: number | null;
  injuries: number | null;
  towAway: boolean | null;
  hazmatRelease: boolean | null;
  trafficway: string | null;
  accessControlDesc: string | null;
  roadSurfaceCondition: string | null;
  weatherCondition: string | null;
  lightCondition: string | null;
  vehicleConfiguration: string | null;
  severityWeight: number | null;
  timeWeight: number | null;
  citationIssued: boolean | null;
  fmcsaNotPreventable: boolean | null;
  vehicleIdentificationNumber: string | null;
  vehicleLicenseNumber: string | null;
  vehicleLicenseState: string | null;
  federalRecordable: boolean | null;
  stateRecordable: boolean | null;
  rawData: {
    fmcsa_datahub_daily_crash?: Record<string, unknown>;
    fmcsa_sms_input_crash?: Record<string, unknown>;
  };
}

type DatahubFetchOptions = { throwOnError?: boolean };

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

export async function getInspectionsByDot(
  dot: string,
  options: DatahubFetchOptions = {}
): Promise<DatahubInspection[]> {
  try {
    const url = `${INSPECTION_ENDPOINT}?dot_number=${encodeURIComponent(dot)}&$limit=2000`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchSocrata<any>(url);

    return rows.map((r) => ({
      uniqueId: String(r.unique_id ?? ""),
      reportNumber: String(r.report_number ?? ""),
      inspectionDate: parseViolDate(String(r.insp_date ?? "")),
      reportState: String(r.report_state ?? ""),
      level: Number(r.insp_level_id ?? 0),
      facilityName: "",
      violTotal: Number(r.basic_viol ?? 0),
      oosTotal: Number(r.oos_total ?? 0),
      driverViolTotal:
        Number(r.unsafe_viol ?? 0) +
        Number(r.fatigued_viol ?? 0) +
        Number(r.dr_fitness_viol ?? 0) +
        Number(r.subt_alcohol_viol ?? 0),
      driverOosTotal: Number(r.driver_oos_total ?? 0),
      vehicleViolTotal: Number(r.vh_maint_viol ?? 0),
      vehicleOosTotal: Number(r.vehicle_oos_total ?? 0),
      hazmatViolTotal: Number(r.hm_viol ?? 0),
      hazmatOosTotal: Number(r.hazmat_oos_total ?? 0),
      postAccident: false,
      carrierName: "",
      timeWeight: Number(r.time_weight ?? 1),
    }));
  } catch (err) {
    if (options.throwOnError) throw err;
    console.error(`Socrata inspection fetch failed for DOT ${dot}:`, err);
    return [];
  }
}

/**
 * Fetch individual violation records from the SMS Input - Violation dataset.
 * Returns violations grouped by normalized inspection date so they can be
 * attached to the matching inspection record.
 */
export async function getViolationsByDot(
  dot: string,
  options: DatahubFetchOptions = {}
): Promise<DatahubViolation[]> {
  try {
    // Fetch up to 1000 violations; most carriers have far fewer
    const url = `${VIOLATION_ENDPOINT}?dot_number=${encodeURIComponent(dot)}&$limit=5000&$order=insp_date+DESC`;
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
    if (options.throwOnError) throw err;
    console.error(`Socrata violation fetch failed for DOT ${dot}:`, err);
    return [];
  }
}

export async function getCrashesByDot(
  dot: string,
  options: DatahubFetchOptions = {}
): Promise<DatahubCrash[]> {
  try {
    // FMCSA Crash File (aayw-vxb3) keys crashes on dot_number with a YYYYMMDD
    // report_date. Order by report_date DESC and window to the trailing 24
    // months — matching the FMCSA SMS crash-indicator measurement period.
    // "sv-SE" locale formats today as YYYY-MM-DD; subtract 2 from the year and
    // strip dashes to get the YYYYMMDD cutoff the dataset stores.
    const todayYmd = new Intl.DateTimeFormat("sv-SE").format();
    const cutoffYr = parseInt(todayYmd.slice(0, 4)) - 2;
    const cutoffYYYYMMDD = cutoffYr.toString() + todayYmd.slice(4).replace(/-/g, "");
    const dailyUrl =
      `${CRASH_ENDPOINT}?dot_number=${encodeURIComponent(dot)}` +
      "&$limit=5000&$order=report_date+DESC" +
      "&" + "$where=report_date>='" + cutoffYYYYMMDD + "'";
    // SMS Input - Crash carries the descriptions and SMS-specific fields that
    // the daily Crash File omits (weights, citation, and not-preventable). Its
    // report_date is DD-MON-YY text, so fetch the carrier slice and enforce the
    // 24-month cutoff after normalization rather than using a lexical $where.
    const smsUrl =
      `${SMS_CRASH_ENDPOINT}?dot_number=${encodeURIComponent(dot)}` +
      "&$limit=5000";
    const [dailyRows, smsRows] = await Promise.all([
      fetchSocrata<Record<string, unknown>>(dailyUrl),
      fetchSocrata<Record<string, unknown>>(smsUrl),
    ]);

    return mergeCrashSourceRows(dailyRows, smsRows, normalizeYyyymmdd(cutoffYYYYMMDD));
  } catch (err) {
    if (options.throwOnError) throw err;
    console.warn(`Socrata crash fetch failed for DOT ${dot}:`, err);
    return [];
  }
}

// Daily Crash File condition/configuration values are SAFETYNET codes. Keep
// the curated descriptions beside the mapper; unknown future codes remain
// explicit instead of being silently mislabeled.
const VEHICLE_CONFIGURATION_BY_ID: Record<string, string> = {
  "1": "Passenger Car (HM placard)",
  "2": "Light Truck (HM placard)",
  "3": "Bus (9-15 people including driver)",
  "4": "Bus (16 or more people including driver)",
  "5": "Single-Unit Truck (2 axles, 6 tires)",
  "6": "Single-Unit Truck (3 or more axles)",
  "7": "Truck/Trailer(s)",
  "8": "Truck Tractor (bobtail)",
  "9": "Tractor/Semi-Trailer (one trailer)",
  "10": "Tractor/Doubles (two trailers)",
  "11": "Tractor/Triples (three trailers)",
  "99": "Other Truck over 10,000 lbs",
};

const TRAFFICWAY_BY_ID: Record<string, string> = {
  "1": "Two-Way Trafficway Not Divided",
  "2": "Two-Way Trafficway Divided Unprotected Median",
  "3": "Two-Way Trafficway Divided Positive Barrier",
  "4": "One-Way Trafficway Not Divided",
  "98": "Not Reported",
  "99": "Unknown",
};

const ACCESS_CONTROL_BY_ID: Record<string, string> = {
  "1": "Full Control",
  "2": "Partial Access Control",
  "3": "No Control",
};

const ROAD_SURFACE_BY_ID: Record<string, string> = {
  "1": "Dry",
  "2": "Wet",
  "3": "Snow",
  "4": "Ice",
  "5": "Sand, Mud, Dirt, Oil, or Gravel",
  "6": "Water (standing or moving)",
  "7": "Slush",
  "8": "Other",
  "9": "Unknown",
};

const WEATHER_BY_ID: Record<string, string> = {
  "1": "No Adverse Conditions",
  "2": "Rain",
  "3": "Sleet or Hail",
  "4": "Snow",
  "5": "Fog",
  "6": "Rain and Fog",
  "7": "Severe Crosswinds",
  "8": "Other",
  "9": "Unknown",
};

const LIGHT_BY_ID: Record<string, string> = {
  "1": "Daylight",
  "2": "Dark - Not Lighted",
  "3": "Dark - Lighted",
  "4": "Dawn",
  "5": "Dusk",
  "6": "Dark - Unknown Lighting",
  "8": "Other",
  "9": "Unknown",
};

function sourceText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function sourceNumber(value: unknown): number | null {
  const text = sourceText(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceBoolean(value: unknown): boolean | null {
  const text = sourceText(value)?.toUpperCase();
  if (text === null || text === undefined) return null;
  if (["Y", "YES", "TRUE", "1"].includes(text)) return true;
  if (["N", "NO", "FALSE", "0"].includes(text)) return false;
  return null;
}

function sourceDescription(
  value: unknown,
  descriptions: Record<string, string>,
  label: string
): string | null {
  const code = sourceText(value);
  if (code === null) return null;
  return descriptions[code] ?? `FMCSA ${label} code ${code}`;
}

function crashSourceKey(row: Record<string, unknown>): string | null {
  const reportNumber = sourceText(row.report_number);
  if (!reportNumber) return null;
  return `${reportNumber.toUpperCase()}::${sourceText(row.report_seq_no) ?? ""}`;
}

function normalizedCrashDate(value: unknown): string {
  const raw = sourceText(value) ?? "";
  if (/^\d{8}$/.test(raw)) return normalizeYyyymmdd(raw);
  if (/^\d{1,2}-[A-Z]{3}-\d{2}$/i.test(raw)) return parseViolDate(raw.toUpperCase());
  return raw;
}

/**
 * Merge the daily Crash File with the monthly SMS Input - Crash row without
 * narrowing either source. Typed fields prefer SMS descriptions where the
 * monthly resource is authoritative; both complete source objects remain
 * available under stable raw-data keys for audit and future mappings.
 */
export function mergeCrashSourceRows(
  dailyRows: Record<string, unknown>[],
  smsRows: Record<string, unknown>[],
  cutoffDate = "0000-00-00"
): DatahubCrash[] {
  const dailyByKey = new Map<string, Record<string, unknown>>();
  const smsByKey = new Map<string, Record<string, unknown>>();

  for (const row of dailyRows) {
    const key = crashSourceKey(row);
    if (key) dailyByKey.set(key, row);
  }
  for (const row of smsRows) {
    const key = crashSourceKey(row);
    if (key) smsByKey.set(key, row);
  }

  const keys = new Set([...dailyByKey.keys(), ...smsByKey.keys()]);
  const crashes: DatahubCrash[] = [];
  for (const key of keys) {
    const daily = dailyByKey.get(key);
    const sms = smsByKey.get(key);
    const primary = daily ?? sms;
    if (!primary) continue;

    const crashDate = normalizedCrashDate(daily?.report_date ?? sms?.report_date);
    if (!crashDate || crashDate < cutoffDate) continue;

    const configurationId = sourceText(daily?.vehicle_configuration_id);
    const rawData: DatahubCrash["rawData"] = {};
    if (daily) rawData.fmcsa_datahub_daily_crash = { ...daily };
    if (sms) rawData.fmcsa_sms_input_crash = { ...sms };

    crashes.push({
      reportNumber: sourceText(primary.report_number) ?? "",
      reportSequenceNumber:
        sourceText(sms?.report_seq_no) ?? sourceText(daily?.report_seq_no),
      crashDate,
      reportState:
        sourceText(sms?.report_state) ?? sourceText(daily?.report_state) ?? "",
      city: sourceText(daily?.city) ?? "",
      location: sourceText(daily?.location),
      fatalities: sourceNumber(sms?.fatalities ?? daily?.fatalities),
      injuries: sourceNumber(sms?.injuries ?? daily?.injuries),
      towAway: sourceBoolean(sms?.tow_away ?? daily?.tow_away),
      // hazmat_released is distinct from the placard flag. Absence stays null
      // so a sparse source can never erase a previously known value.
      hazmatRelease: sourceBoolean(sms?.hazmat_released ?? daily?.hazmat_released),
      trafficway:
        sourceText(sms?.trafficway_desc) ??
        sourceDescription(daily?.trafficway_id, TRAFFICWAY_BY_ID, "trafficway"),
      accessControlDesc:
        sourceText(sms?.access_control_desc) ??
        sourceDescription(daily?.access_control_id, ACCESS_CONTROL_BY_ID, "access control"),
      roadSurfaceCondition:
        sourceText(sms?.road_surface_condition_desc) ??
        sourceDescription(
          daily?.road_surface_condition_id,
          ROAD_SURFACE_BY_ID,
          "road surface"
        ),
      weatherCondition:
        sourceText(sms?.weather_condition_desc) ??
        sourceDescription(daily?.weather_condition_id, WEATHER_BY_ID, "weather"),
      lightCondition:
        sourceText(sms?.light_condition_desc) ??
        sourceDescription(daily?.light_condition_id, LIGHT_BY_ID, "light"),
      vehicleConfiguration:
        configurationId === null
          ? null
          : VEHICLE_CONFIGURATION_BY_ID[configurationId] ??
            `FMCSA vehicle configuration code ${configurationId}`,
      severityWeight: sourceNumber(sms?.severity_weight),
      timeWeight: sourceNumber(sms?.time_weight),
      citationIssued: sourceBoolean(sms?.citation_issued_desc),
      fmcsaNotPreventable: sourceBoolean(sms?.not_preventable),
      vehicleIdentificationNumber:
        sourceText(sms?.vehicle_id_number) ??
        sourceText(daily?.vehicle_identification_number),
      vehicleLicenseNumber:
        sourceText(sms?.vehicle_license_number) ??
        sourceText(daily?.vehicle_license_number),
      vehicleLicenseState:
        sourceText(sms?.vehicle_license_state) ?? sourceText(daily?.vehicle_lic_state),
      federalRecordable: sourceBoolean(daily?.federal_recordable),
      stateRecordable: sourceBoolean(daily?.state_recordable),
      rawData,
    });
  }

  return crashes.sort((a, b) =>
    b.crashDate.localeCompare(a.crashDate) ||
    a.reportNumber.localeCompare(b.reportNumber)
  );
}

/** YYYYMMDD → YYYY-MM-DD; passes through anything that isn't 8 digits. */
function normalizeYyyymmdd(s: string): string {
  if (!/^\d{8}$/.test(s)) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
