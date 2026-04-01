/**
 * FMCSA QCMobile API client
 * Base URL: https://mobile.fmcsa.dot.gov/qc/services
 * API key from: https://mobile.fmcsa.dot.gov/QCDevsite/
 *
 * Requires FMCSA_API_KEY env var. Returns empty data (no fallbacks) when key is missing or API fails.
 */

const BASE_URL = "https://mobile.fmcsa.dot.gov/qc/services";

export interface FMCSACarrier {
  dotNumber: string;
  legalName: string;
  dbaName: string | null;
  carrierOperation: string;
  hmFlag: string;
  pcFlag: string;
  phyStreet: string;
  phyCity: string;
  phyState: string;
  phyZip: string;
  phyCountry: string;
  mxInterstateFlag: string;
  totalDrivers: number;
  totalPowerUnits: number;
  mcNumber: string | null;
  mcs150FormDate: string | null;
  mcs150MileageYear: number | null;
  mcs150Mileage: number | null;
  safetyRating: string | null;
  safetyRatingDate: string | null;
  reviewType: string | null;
  reviewDate: string | null;
  censusTypeDesc: string | null;
  entityType: string | null;
  statusCode: string | null;
  usdotStatus: string | null;
}

export interface FMCSABasic {
  measureValue: number;
  percentile: number | null;
  investigationCount: number;
  violationCount: number;
  category: string;
  alert: boolean;
  outofservice: boolean;
}

export interface FMCSABasics {
  unsafeDriving: FMCSABasic | null;
  hosCompliance: FMCSABasic | null;
  driverFitness: FMCSABasic | null;
  controlledSubstances: FMCSABasic | null;
  vehicleMaintenance: FMCSABasic | null;
  hmCompliance: FMCSABasic | null;
  crashIndicator: FMCSABasic | null;
}

export interface FMCSAOosRates {
  vehicleOosRate: number | null;
  driverOosRate: number | null;
  hazmatOosRate: number | null;
  inspectionTotal: number | null;
  vehicleInspections: number | null;
  driverInspections: number | null;
  hazmatInspections: number | null;
  vehicleOos: number | null;
  driverOos: number | null;
  hazmatOos: number | null;
  nationalVehicleOosRate: number;
  nationalDriverOosRate: number;
}

export interface FMCSACarrierResponse {
  carrier: FMCSACarrier;
  content: Record<string, unknown>;
}

async function fetchFMCSA<T>(path: string): Promise<T> {
  const apiKey = process.env.FMCSA_API_KEY;
  if (!apiKey) {
    throw new Error("FMCSA_API_KEY not configured");
  }
  const url = `${BASE_URL}${path}?webKey=${apiKey}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`FMCSA API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function getCarrier(dot: string): Promise<FMCSACarrier> {
  try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchFMCSA<{ content: { carrier: any } }>(`/carriers/${dot}`);
  const r = data.content.carrier;
  // Normalize real API response to our FMCSACarrier interface
  return {
    dotNumber: String(r.dotNumber ?? dot),
    legalName: r.legalName ?? "",
    dbaName: r.dbaName ?? null,
    carrierOperation: r.carrierOperation?.carrierOperationCode ?? r.carrierOperation ?? "",
    hmFlag: r.hmFlag ?? "N",
    pcFlag: r.pcFlag ?? "N",
    phyStreet: r.phyStreet ?? "",
    phyCity: r.phyCity ?? "",
    phyState: r.phyState ?? "",
    phyZip: r.phyZipcode ?? r.phyZip ?? "",
    phyCountry: r.phyCountry ?? "US",
    mxInterstateFlag: r.mxInterstateFlag ?? "N",
    totalDrivers: r.totalDrivers ?? 0,
    totalPowerUnits: r.totalPowerUnits ?? 0,
    mcNumber: r.mcNumber ?? null,
    mcs150FormDate: r.mcs150FormDate ?? null,
    mcs150MileageYear: r.mcs150MileageYear ?? null,
    mcs150Mileage: r.mcs150Mileage ?? null,
    safetyRating: r.safetyRating ?? null,
    safetyRatingDate: r.safetyRatingDate ?? r.safetyReviewDate ?? null,
    reviewType: r.reviewType ?? r.safetyReviewType ?? null,
    reviewDate: r.reviewDate ?? r.safetyReviewDate ?? null,
    censusTypeDesc: r.censusTypeId?.censusTypeDesc ?? null,
    entityType: r.censusTypeId?.censusType ?? null,
    statusCode: r.statusCode ?? null,
    usdotStatus: r.statusCode ?? null,
  };
  } catch (err) {
    throw err;
  }
}

export async function getBasics(dot: string): Promise<FMCSABasics> {
  if (!process.env.FMCSA_API_KEY) {
    console.warn("FMCSA_API_KEY not set"); return emptyBasics();
  }
  try {
  const data = await fetchFMCSA<{ content: { BasicsInfo: Array<{ measureValue: number; percentile: number; investigationCount: number; violationCount: number; category: string; alert: boolean; outOfService: boolean }> } }>(`/carriers/${dot}/basics`);
  const basics: FMCSABasics = {
    unsafeDriving: null,
    hosCompliance: null,
    driverFitness: null,
    controlledSubstances: null,
    vehicleMaintenance: null,
    hmCompliance: null,
    crashIndicator: null,
  };
  for (const b of data.content.BasicsInfo || []) {
    const item: FMCSABasic = {
      measureValue: b.measureValue,
      percentile: b.percentile,
      investigationCount: b.investigationCount,
      violationCount: b.violationCount,
      category: b.category,
      alert: b.alert,
      outofservice: b.outOfService,
    };
    const cat = b.category?.toLowerCase().replace(/\s+/g, "");
    if (cat?.includes("unsafe")) basics.unsafeDriving = item;
    else if (cat?.includes("hos") || cat?.includes("hoursofservice")) basics.hosCompliance = item;
    else if (cat?.includes("driver") && cat?.includes("fit")) basics.driverFitness = item;
    else if (cat?.includes("controlled") || cat?.includes("substance")) basics.controlledSubstances = item;
    else if (cat?.includes("vehicle") || cat?.includes("maint")) basics.vehicleMaintenance = item;
    else if (cat?.includes("hm") || cat?.includes("hazmat")) basics.hmCompliance = item;
    else if (cat?.includes("crash")) basics.crashIndicator = item;
  }
  return basics;
  } catch (err) {
    console.error(`FMCSA basics API failed for DOT ${dot}, falling back to mock:`, err);
    return emptyBasics();
  }
}

export async function getOosRates(dot: string): Promise<FMCSAOosRates> {
  if (!process.env.FMCSA_API_KEY) {
    console.warn("FMCSA_API_KEY not set"); return emptyOosRates();
  }
  try {
  const data = await fetchFMCSA<{ content: Record<string, number> }>(`/carriers/${dot}/oos`);
  const c = data.content;
  return {
    vehicleOosRate: c.vehicleOosRate ?? null,
    driverOosRate: c.driverOosRate ?? null,
    hazmatOosRate: c.hazmatOosRate ?? null,
    inspectionTotal: c.inspectionTotal ?? null,
    vehicleInspections: c.vehicleInspections ?? null,
    driverInspections: c.driverInspections ?? null,
    hazmatInspections: c.hazmatInspections ?? null,
    vehicleOos: c.vehicleOos ?? null,
    driverOos: c.driverOos ?? null,
    hazmatOos: c.hazmatOos ?? null,
    nationalVehicleOosRate: c.nationalVehicleOosRate ?? 22.26,
    nationalDriverOosRate: c.nationalDriverOosRate ?? 6.67,
  };
  } catch (err) {
    console.error(`FMCSA OOS rates API failed for DOT ${dot}, falling back to mock:`, err);
    return emptyOosRates();
  }
}

function emptyBasics(): FMCSABasics {
  return {
    unsafeDriving: null,
    hosCompliance: null,
    driverFitness: null,
    controlledSubstances: null,
    vehicleMaintenance: null,
    hmCompliance: null,
    crashIndicator: null,
  };
}

function emptyOosRates(): FMCSAOosRates {
  return {
    vehicleOosRate: null,
    driverOosRate: null,
    hazmatOosRate: null,
    inspectionTotal: null,
    vehicleInspections: null,
    driverInspections: null,
    hazmatInspections: null,
    vehicleOos: null,
    driverOos: null,
    hazmatOos: null,
    nationalVehicleOosRate: 22.26,
    nationalDriverOosRate: 6.67,
  };
}

function normalizeBASICCategory(basic: string): string {
  const b = (basic ?? "").toLowerCase();
  if (b.includes("unsafe")) return "unsafe_driving";
  if (b.includes("hours") || b.includes("hos")) return "hos_compliance";
  if (b.includes("driver") && b.includes("fit")) return "driver_fitness";
  if (b.includes("controlled") || b.includes("substance") || b.includes("alcohol")) return "controlled_substance";
  if (b.includes("hazmat") || b.includes("hazardous")) return "hazmat_compliance";
  if (b.includes("crash")) return "crash_indicator";
  return "vehicle_maintenance";
}

export interface FMCSAInspection {
  reportNumber: string;
  inspectionDate: string;
  state: string;
  level: string;
  facilityName: string;
  timeWeight: number;
  violations: FMCSAViolationRecord[];
}

export interface FMCSAViolationRecord {
  violationCode: string;
  description: string;
  basicCategory: string;
  severityWeight: number;
  oosViolation: boolean;
  convicted: boolean;
  citationNumber: string | null;
}

export interface FMCSACrashRecord {
  reportNumber: string;
  crashDate: string;
  state: string;
  city: string;
  fatalities: number;
  injuries: number;
  towAway: boolean;
  hazmatRelease: boolean;
}

export async function getInspections(dot: string): Promise<FMCSAInspection[]> {
  const { getInspectionsByDot } = await import("./datahub-client");
  const rows = await getInspectionsByDot(dot);
  return rows
    .filter((r) => r.reportNumber !== "")
    .map((r) => ({
      reportNumber: r.reportNumber,
      inspectionDate: formatInspDate(r.inspectionDate), // YYYYMMDD -> YYYY-MM-DD
      state: r.reportState,
      level: String(r.level),
      facilityName: `Level ${r.level} — ${r.reportState}`,
      timeWeight: calculateTimeWeight(r.inspectionDate),
      violations: [], // violation codes come from a separate dataset
    }));
}

function formatInspDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function calculateTimeWeight(inspDateYYYYMMDD: string): number {
  if (!inspDateYYYYMMDD || inspDateYYYYMMDD.length !== 8) return 1;
  const inspYear = parseInt(inspDateYYYYMMDD.slice(0, 4));
  const inspMonth = parseInt(inspDateYYYYMMDD.slice(4, 6));
  const now = new Date();
  const monthsAgo = (now.getFullYear() - inspYear) * 12 + (now.getMonth() + 1 - inspMonth);
  if (monthsAgo <= 6) return 3;
  if (monthsAgo <= 12) return 2;
  return 1;
}

export async function getCrashes(dot: string): Promise<FMCSACrashRecord[]> {
  const { getCrashesByDot } = await import("./datahub-client");
  const rows = await getCrashesByDot(dot);
  return rows.map((r) => ({
    reportNumber: r.reportNumber,
    crashDate: r.crashDate,
    state: r.reportState,
    city: "",
    fatalities: r.fatalities,
    injuries: r.injuries,
    towAway: r.towAway,
    hazmatRelease: r.hazmatRelease,
  }));
}

