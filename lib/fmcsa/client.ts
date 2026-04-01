/**
 * FMCSA QCMobile API client
 * Base URL: https://mobile.fmcsa.dot.gov/qc/services
 * API key from: https://mobile.fmcsa.dot.gov/QCDevsite/
 *
 * When FMCSA_API_KEY is not set, returns mock data for DOT 2533650 (Nationwide Carrier Inc)
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
  if (!process.env.FMCSA_API_KEY) {
    return getMockCarrier(dot);
  }
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
  if (!process.env.FMCSA_API_KEY) {
    console.warn(`FMCSA_API_KEY not set — no inspection data available for DOT ${dot}`);
    return [];
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await fetchFMCSA<{ content: any }>(`/carriers/${dot}/inspections`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: any[] = data.content?.InspectionDetails ?? data.content?.listRecords ?? data.content?.Inspections ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return records.map((r: any) => ({
      reportNumber: String(r.reportNumber ?? r.reportNum ?? ""),
      inspectionDate: r.inspDate ?? r.inspectionDate ?? "",
      state: r.reportState ?? r.state ?? "",
      level: String(r.level ?? ""),
      facilityName: r.facilityName ?? "",
      timeWeight: Number(r.timeWeight ?? 1),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      violations: (r.violations ?? r.Violations ?? []).map((v: any) => ({
        violationCode: v.violCode ?? v.code ?? "",
        description: v.violDesc ?? v.description ?? "",
        basicCategory: normalizeBASICCategory(v.basic ?? v.basicDescription ?? ""),
        severityWeight: Number(v.severityWeight ?? 1),
        oosViolation: v.oos === "Y" || v.oos === true,
        convicted: v.convicted === "Y" || v.convicted === true,
        citationNumber: null,
      })),
    }));
  } catch (err) {
    console.error(`FMCSA inspections API failed for DOT ${dot}:`, err);
    return [];
  }
}

export async function getCrashes(dot: string): Promise<FMCSACrashRecord[]> {
  if (!process.env.FMCSA_API_KEY) {
    console.warn(`FMCSA_API_KEY not set — no crash data available for DOT ${dot}`);
    return [];
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await fetchFMCSA<{ content: any }>(`/carriers/${dot}/crashes`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: any[] = data.content?.CrashDetails ?? data.content?.Crashes ?? data.content?.listRecords ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return records.map((r: any) => ({
      reportNumber: String(r.reportNumber ?? r.crashId ?? ""),
      crashDate: r.crashDate ?? "",
      state: r.state ?? "",
      city: r.city ?? "",
      fatalities: Number(r.fatal ?? r.fatalities ?? 0),
      injuries: Number(r.injuries ?? 0),
      towAway: Number(r.towaways ?? r.towAway ?? 0) > 0,
      hazmatRelease: r.hazmatRelease === "Y" || r.hazmatReleased === "Y" || r.hazmatRelease === true,
    }));
  } catch (err) {
    console.error(`FMCSA crashes API failed for DOT ${dot}:`, err);
    return [];
  }
}

// ── Mock data for DOT 2533650 (Nationwide Carrier Inc) ──────────────────────

function getMockCarrier(dot: string): FMCSACarrier {
  if (dot === "2533650") {
    return {
      dotNumber: "2533650",
      legalName: "NATIONWIDE CARRIER INC",
      dbaName: null,
      carrierOperation: "A",
      hmFlag: "Y",
      pcFlag: "N",
      phyStreet: "1234 Industrial Blvd",
      phyCity: "Tracy",
      phyState: "CA",
      phyZip: "95377",
      phyCountry: "US",
      mxInterstateFlag: "N",
      totalDrivers: 20,
      totalPowerUnits: 16,
      mcNumber: "880750",
      mcs150FormDate: "08/05/2025",
      mcs150MileageYear: 2024,
      mcs150Mileage: 1416756,
      safetyRating: null,
      safetyRatingDate: "10/06/2025",
      reviewType: "Non-Ratable",
      reviewDate: "10/06/2025",
      censusTypeDesc: "CARRIER",
      entityType: "CARRIER",
      statusCode: "A",
      usdotStatus: "ACTIVE",
    };
  }
  throw new Error(`No mock data for DOT ${dot}. Set FMCSA_API_KEY in .env.local.`);
}

function getMockBasics(dot: string): FMCSABasics {
  if (dot === "2533650") {
    return {
      unsafeDriving: {
        measureValue: 42.5,
        percentile: 58,
        investigationCount: 0,
        violationCount: 8,
        category: "Unsafe Driving",
        alert: false,
        outofservice: false,
      },
      hosCompliance: {
        measureValue: 67.3,
        percentile: 72,
        investigationCount: 0,
        violationCount: 14,
        category: "HOS Compliance",
        alert: true,
        outofservice: false,
      },
      driverFitness: {
        measureValue: 18.1,
        percentile: 24,
        investigationCount: 0,
        violationCount: 3,
        category: "Driver Fitness",
        alert: false,
        outofservice: false,
      },
      controlledSubstances: {
        measureValue: 0,
        percentile: 0,
        investigationCount: 0,
        violationCount: 0,
        category: "Controlled Substances/Alcohol",
        alert: false,
        outofservice: false,
      },
      vehicleMaintenance: {
        measureValue: 78.4,
        percentile: 81,
        investigationCount: 0,
        violationCount: 21,
        category: "Vehicle Maintenance",
        alert: true,
        outofservice: true,
      },
      hmCompliance: {
        measureValue: 100,
        percentile: 95,
        investigationCount: 0,
        violationCount: 1,
        category: "Hazardous Materials Compliance",
        alert: true,
        outofservice: true,
      },
      crashIndicator: {
        measureValue: 88.2,
        percentile: 89,
        investigationCount: 0,
        violationCount: 4,
        category: "Crash Indicator",
        alert: true,
        outofservice: false,
      },
    };
  }
  throw new Error(`No mock data for DOT ${dot}. Set FMCSA_API_KEY in .env.local.`);
}

function getMockOosRates(dot: string): FMCSAOosRates {
  if (dot === "2533650") {
    return {
      vehicleOosRate: 21.2,
      driverOosRate: 2.0,
      hazmatOosRate: 100,
      inspectionTotal: 56,
      vehicleInspections: 33,
      driverInspections: 51,
      hazmatInspections: 1,
      vehicleOos: 7,
      driverOos: 1,
      hazmatOos: 1,
      nationalVehicleOosRate: 22.26,
      nationalDriverOosRate: 6.67,
    };
  }
  throw new Error(`No mock data for DOT ${dot}. Set FMCSA_API_KEY in .env.local.`);
}

// ── Mock inspections + violations for DOT 2533650 ───────────────────────────

export interface MockInspection {
  reportNumber: string;
  inspectionDate: string;
  state: string;
  level: string;
  facilityName: string;
  timeWeight: number;
  violations: MockViolation[];
}

export interface MockViolation {
  violationCode: string;
  description: string;
  basicCategory: string;
  severityWeight: number;
  oosViolation: boolean;
  convicted: boolean;
  citationNumber: string | null;
}

export function getMockInspections(dot: string): MockInspection[] {
  if (dot !== "2533650") return [];
  return [
    {
      reportNumber: "INS-2024-001",
      inspectionDate: "2024-11-15",
      state: "CA",
      level: "Level I",
      facilityName: "CA CHP - I-5 Checkpoint",
      timeWeight: 3,
      violations: [
        { violationCode: "393.9", description: "Inoperative required lamp", basicCategory: "vehicle_maintenance", severityWeight: 6, oosViolation: false, convicted: true, citationNumber: "CA-2024-001" },
        { violationCode: "393.95", description: "Emergency equipment — fire extinguisher missing", basicCategory: "vehicle_maintenance", severityWeight: 4, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "392.2A", description: "Speeding 1-5 mph over limit", basicCategory: "unsafe_driving", severityWeight: 3, oosViolation: false, convicted: false, citationNumber: "CA-2024-002" },
      ],
    },
    {
      reportNumber: "INS-2024-002",
      inspectionDate: "2024-09-03",
      state: "AZ",
      level: "Level II",
      facilityName: "AZ DPS Port of Entry",
      timeWeight: 3,
      violations: [
        { violationCode: "395.8A", description: "Driver's record of duty status not current", basicCategory: "hos_compliance", severityWeight: 5, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "395.8E", description: "Failure to retain previous 7 days of records", basicCategory: "hos_compliance", severityWeight: 5, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "393.45B1", description: "Brake hose/tubing chafing and/or kinking — OOS condition", basicCategory: "vehicle_maintenance", severityWeight: 10, oosViolation: true, convicted: true, citationNumber: null },
      ],
    },
    {
      reportNumber: "INS-2024-003",
      inspectionDate: "2024-07-18",
      state: "CA",
      level: "Level III",
      facilityName: "Weigh Station US-99",
      timeWeight: 2,
      violations: [
        { violationCode: "391.45B", description: "Annual inquiry to previous employers not made", basicCategory: "driver_fitness", severityWeight: 7, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "391.23A1", description: "Application for employment — missing or incomplete", basicCategory: "driver_fitness", severityWeight: 5, oosViolation: false, convicted: true, citationNumber: null },
      ],
    },
    {
      reportNumber: "INS-2024-004",
      inspectionDate: "2024-05-22",
      state: "NV",
      level: "Level I",
      facilityName: "NV DOT US-95 Inspection",
      timeWeight: 2,
      violations: [
        { violationCode: "393.75A3", description: "Flat tire or fabric exposed on front axle — OOS", basicCategory: "vehicle_maintenance", severityWeight: 10, oosViolation: true, convicted: true, citationNumber: null },
        { violationCode: "393.55A", description: "No or defective ABS on tractor", basicCategory: "vehicle_maintenance", severityWeight: 5, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "177.823", description: "Hazmat — transportation of forbidden material", basicCategory: "hazmat_compliance", severityWeight: 10, oosViolation: true, convicted: true, citationNumber: "NV-2024-HM-001" },
      ],
    },
    {
      reportNumber: "INS-2023-001",
      inspectionDate: "2023-12-10",
      state: "CA",
      level: "Level II",
      facilityName: "CA CHP Commercial Vehicle Enforcement",
      timeWeight: 1,
      violations: [
        { violationCode: "392.9A1", description: "Operating a CMV without having the CMV in safe operating condition", basicCategory: "vehicle_maintenance", severityWeight: 7, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "395.3A2", description: "Driving after 11-hour limit", basicCategory: "hos_compliance", severityWeight: 10, oosViolation: true, convicted: true, citationNumber: "CA-2023-HOS-001" },
      ],
    },
    {
      reportNumber: "INS-2023-002",
      inspectionDate: "2023-08-05",
      state: "OR",
      level: "Level I",
      facilityName: "OR DMV Inspection Station I-5",
      timeWeight: 1,
      violations: [
        { violationCode: "393.9", description: "Inoperative required lamp — tail lamp", basicCategory: "vehicle_maintenance", severityWeight: 6, oosViolation: false, convicted: true, citationNumber: null },
        { violationCode: "392.2S", description: "Following too closely", basicCategory: "unsafe_driving", severityWeight: 5, oosViolation: false, convicted: false, citationNumber: "OR-2023-001" },
      ],
    },
  ];
}

export interface MockCrash {
  reportNumber: string;
  crashDate: string;
  state: string;
  city: string;
  fatalities: number;
  injuries: number;
  towAway: boolean;
  hazmatRelease: boolean;
  description: string;
}

export function getMockCrashes(dot: string): MockCrash[] {
  if (dot !== "2533650") return [];
  return [
    {
      reportNumber: "CRH-2024-001",
      crashDate: "2024-10-12",
      state: "CA",
      city: "Stockton",
      fatalities: 0,
      injuries: 0,
      towAway: true,
      hazmatRelease: false,
      description: "Rear-end collision on I-5 northbound. Other vehicle failed to maintain lane and brake-checked driver. Tow required for other vehicle only. Police report notes other driver cited.",
    },
    {
      reportNumber: "CRH-2024-002",
      crashDate: "2024-06-28",
      state: "AZ",
      city: "Phoenix",
      fatalities: 0,
      injuries: 0,
      towAway: true,
      hazmatRelease: false,
      description: "Merge accident on I-10. Passenger vehicle entered lane without signaling. No injuries. Other vehicle towed. Police report available.",
    },
    {
      reportNumber: "CRH-2023-001",
      crashDate: "2023-11-03",
      state: "CA",
      city: "Modesto",
      fatalities: 0,
      injuries: 0,
      towAway: true,
      hazmatRelease: false,
      description: "Parked truck struck by unknown vehicle in rest area overnight. No driver present. Damage to rear trailer. No fault on driver.",
    },
    {
      reportNumber: "CRH-2023-002",
      crashDate: "2023-04-17",
      state: "NV",
      city: "Las Vegas",
      fatalities: 0,
      injuries: 0,
      towAway: true,
      hazmatRelease: false,
      description: "Collision at intersection. Signal timing dispute. Police report documents conflicting accounts. No fatalities or injuries.",
    },
  ];
}
