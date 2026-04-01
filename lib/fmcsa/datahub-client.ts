// lib/fmcsa/datahub-client.ts
// FMCSA data via DOT Data Portal Socrata API
// Inspection dataset: https://data.transportation.gov/resource/fx4q-ay7w.json
// No key required; X-App-Token header optional to avoid rate limiting

const INSPECTION_ENDPOINT = "https://data.transportation.gov/resource/fx4q-ay7w.json";
const CRASH_ENDPOINT = "https://data.transportation.gov/resource/e6mz-jbpz.json"; // attempt; may 404

export interface DatahubInspection {
  reportNumber: string;
  inspectionDate: string; // YYYYMMDD format from API
  reportState: string;
  level: number; // insp_level_id
  facilityName: string; // insp_facility code
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

export async function getInspectionsByDot(dot: string): Promise<DatahubInspection[]> {
  try {
    // Socrata SODA query: filter by dot_number, limit 200, order by date desc
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
