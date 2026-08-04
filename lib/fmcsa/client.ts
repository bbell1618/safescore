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
  // Human-readable operating authority label derived from carrierOperation /
  // commonAuthorityStatus. Full L&I filing detail requires authenticated FMCSA
  // portal access and is not available via QCMobile.
  authorityStatus: string | null;
}

export interface FMCSABasic {
  measureValue: number;
  percentile: number | null;
  investigationCount: number;
  violationCount: number;
  category: string;
  sourceId: number | null;
  runDate: string | null;
  alert: boolean;
  outofservice: boolean;
}

export type FMCSABasicsSourceStatus = {
  source: "qcmobile_basics";
  status: "available" | "no_public_data" | "unavailable";
  reason:
    | "carrier_not_found"
    | "api_key_missing"
    | "request_failed"
    | null;
  httpStatus: number | null;
};

export interface FMCSABasics {
  unsafeDriving: FMCSABasic | null;
  hosCompliance: FMCSABasic | null;
  driverFitness: FMCSABasic | null;
  controlledSubstances: FMCSABasic | null;
  vehicleMaintenance: FMCSABasic | null;
  hmCompliance: FMCSABasic | null;
  crashIndicator: FMCSABasic | null;
  smsSnapshotDate: string | null;
  retrievedAt: string | null;
  sourceStatus: FMCSABasicsSourceStatus;
}

export type FMCSABasicsPayload = {
  content: Array<{
    basic: {
      basicsType: { basicsCode: string; basicsId: number };
      basicsRunDate?: string | null;
      measureValue: string | number;
      basicsPercentile: string | number | null;
      totalViolation: number;
      totalInspectionWithViolation: number;
      exceededFMCSAInterventionThreshold: string;
      onRoadPerformanceThresholdViolationIndicator?: string;
    };
  }>;
  retrievalDate?: string | null;
};

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
  nationalHazmatOosRate: number;
}

export interface FMCSACarrierResponse {
  carrier: FMCSACarrier;
  content: Record<string, unknown>;
}

export class FMCSAApiError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly path: string
  ) {
    super(`FMCSA API error: ${status} ${statusText}`);
    this.name = "FMCSAApiError";
  }
}

async function fetchFMCSA<T>(path: string, opts?: { revalidate?: number }): Promise<T> {
  const apiKey = process.env.FMCSA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("FMCSA_API_KEY not configured");
  }
  const url = `${BASE_URL}${path}?webKey=${encodeURIComponent(apiKey)}`;
  // Default: no cache so analysis import runs always get fresh data.
  // Pass opts.revalidate to opt into Next.js Data Cache for display-only reads.
  const fetchOpts: RequestInit =
    opts?.revalidate != null
      ? { next: { revalidate: opts.revalidate } }
      : { cache: "no-store" };
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    throw new FMCSAApiError(res.status, res.statusText, path);
  }
  return res.json() as Promise<T>;
}

export async function getCarrier(dot: string): Promise<FMCSACarrier> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchFMCSA<{ content: { carrier: any } }>(`/carriers/${dot}`);
  const r = data.content.carrier;

  // mc_number is frequently null on the carrier record even when an MC docket
  // exists; prefer the explicit field, then any nested docket number.
  const mcNumber =
    r.mcNumber ??
    r.docketNumber ??
    r.docketNumbers?.[0]?.docketNumber ??
    null;

  // FMCSA mileage year comes back as mcs150MileageYear; some payloads nest it.
  const mileageYear =
    r.mcs150MileageYear ?? r.mcs150Year ?? r.mileageYear ?? null;

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
    mcNumber: mcNumber != null ? String(mcNumber) : null,
    mcs150FormDate: r.mcs150FormDate ?? r.mcs150Outdated ?? null,
    mcs150MileageYear: mileageYear != null ? Number(mileageYear) : null,
    mcs150Mileage: r.mcs150Mileage != null ? Number(r.mcs150Mileage) : null,
    safetyRating: r.safetyRating ?? null,
    safetyRatingDate: r.safetyRatingDate ?? r.safetyReviewDate ?? null,
    reviewType: r.reviewType ?? r.safetyReviewType ?? null,
    reviewDate: r.reviewDate ?? r.safetyReviewDate ?? null,
    censusTypeDesc: r.censusTypeId?.censusTypeDesc ?? null,
    entityType: r.censusTypeId?.censusType ?? null,
    statusCode: r.statusCode ?? null,
    usdotStatus: r.statusCode ?? null,
    authorityStatus: deriveAuthorityStatus(r),
  };
}

/**
 * Derive a human-readable operating-authority label from the carrier record.
 * QCMobile does not expose full L&I insurance filings — this is the best
 * available authority signal: common authority status + property/passenger flags.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveAuthorityStatus(r: any): string | null {
  const op = r.carrierOperation?.carrierOperationCode ?? r.carrierOperation ?? "";
  const common = (r.commonAuthorityStatus ?? "").toUpperCase();
  const contract = (r.contractAuthorityStatus ?? "").toUpperCase();
  const authorized = common === "A" || contract === "A";

  // Property vs passenger inferred from operation classification / flags.
  const isPassenger =
    (r.passengerFlag ?? "N") === "Y" || String(op).toUpperCase().includes("PASSENGER");

  if (authorized) {
    return isPassenger ? "Authorized for Passenger" : "Authorized for Property";
  }
  if (common || contract) {
    return "Not Authorized";
  }
  // For-hire interstate carriers default to property authority when no explicit
  // authority status field is present in the payload.
  if (String(op).toUpperCase().includes("A") || r.carrierOperation?.carrierOperationCode === "A") {
    return "Authorized for Property";
  }
  return null;
}

export async function getBasics(
  dot: string,
  options: { throwOnError?: boolean } = {}
): Promise<FMCSABasics> {
  if (!process.env.FMCSA_API_KEY?.trim()) {
    if (options.throwOnError) throw new Error("FMCSA_API_KEY not configured");
    console.warn("FMCSA_API_KEY not set");
    return emptyBasics({
      source: "qcmobile_basics",
      status: "unavailable",
      reason: "api_key_missing",
      httpStatus: null,
    });
  }
  try {
    // The API returns { content: Array<{ basic: { basicsType: { basicsCode }, measureValue, basicsPercentile, ... } }> }
    // NOT the previously assumed { content: { BasicsInfo: [] } } shape.
    const data = await fetchFMCSA<FMCSABasicsPayload>(`/carriers/${dot}/basics`);
    return mapFmcsaBasicsPayload(data);
  } catch (err) {
    if (err instanceof FMCSAApiError && err.status === 404) {
      console.info(
        `[fmcsa-basics] DOT ${dot} has no QCMobile carrier/BASIC record`
      );
      return emptyBasics({
        source: "qcmobile_basics",
        status: "no_public_data",
        reason: "carrier_not_found",
        httpStatus: 404,
      });
    }
    if (options.throwOnError) throw err;
    console.error(`FMCSA basics API failed for DOT ${dot}:`, err);
    return emptyBasics({
      source: "qcmobile_basics",
      status: "unavailable",
      reason: "request_failed",
      httpStatus: err instanceof FMCSAApiError ? err.status : null,
    });
  }
}

/**
 * Normalize the exact QCMobile /basics response. Keeping this pure makes the
 * source-field mapping independently testable and preserves FMCSA's own SMS
 * run date separately from the API retrieval timestamp.
 */
export function mapFmcsaBasicsPayload(data: FMCSABasicsPayload): FMCSABasics {
  const basics = emptyBasics();
  basics.retrievedAt = data.retrievalDate ?? null;
  const runDates = new Set<string>();

  const items = Array.isArray(data.content) ? data.content : [];
  for (const entry of items) {
    const b = entry?.basic;
    if (!b) continue;

    const code = b.basicsType?.basicsCode ?? "";
    const measureValue = parseFloat(String(b.measureValue ?? "0")) || 0;

    // basicsPercentile is "Not Public" when carrier is not publicly scored;
    // a numeric string like "75" or a number when public.
    let percentile: number | null = null;
    if (b.basicsPercentile !== null && b.basicsPercentile !== undefined) {
      const pctNum = parseFloat(String(b.basicsPercentile));
      if (!isNaN(pctNum)) percentile = pctNum;
    }

    const runDate = b.basicsRunDate ?? null;
    if (runDate) runDates.add(runDate);
    const item: FMCSABasic = {
      measureValue,
      percentile,
      investigationCount: b.totalInspectionWithViolation ?? 0,
      violationCount: b.totalViolation ?? 0,
      category: code,
      sourceId: b.basicsType?.basicsId ?? null,
      runDate,
      alert: b.exceededFMCSAInterventionThreshold === "1",
      outofservice: b.onRoadPerformanceThresholdViolationIndicator === "Yes",
    };

    const cat = code.toLowerCase();
    if (cat.includes("unsafe")) basics.unsafeDriving = item;
    else if (cat.includes("hos") || cat.includes("hours")) basics.hosCompliance = item;
    else if (cat.includes("driver") && cat.includes("fit")) basics.driverFitness = item;
    else if (cat.includes("drug") || cat.includes("alcohol") || cat.includes("controlled") || cat.includes("substance")) basics.controlledSubstances = item;
    else if (cat.includes("vehicle") || cat.includes("maint")) basics.vehicleMaintenance = item;
    else if (cat.includes("hm") || cat.includes("hazmat") || cat.includes("hazardous")) basics.hmCompliance = item;
    else if (cat.includes("crash")) basics.crashIndicator = item;
  }

  // QCMobile currently stamps every returned BASIC with the same SMS run date.
  // If that ever changes, do not present one date as applying to mixed snapshots.
  basics.smsSnapshotDate = runDates.size === 1 ? [...runDates][0] : null;
  return basics;
}

export async function getOosRates(dot: string): Promise<FMCSAOosRates> {
  // National averages per FMCSA (as of 02/27/2026): vehicle 22.26%, driver 6.67%, hazmat 4.44%.
  let qc: FMCSAOosRates | null = null;

  if (process.env.FMCSA_API_KEY) {
    try {
      const data = await fetchFMCSA<{ content: Record<string, number> }>(`/carriers/${dot}/oos`);
      const c = data.content ?? {};

      // QCMobile sometimes returns the OOS *counts* (inspections + OOS totals)
      // but leaves the pre-computed *Rate fields null. When that happens, derive
      // the rate from the counts so we don't fall back to DataHub unnecessarily.
      console.log("[getOosRates] Raw counts:", {
        vi: c.vehicleInspections,
        vo: c.vehicleOos,
        di: c.driverInspections,
        do_: c.driverOos,
        hi: c.hazmatInspections,
        ho: c.hazmatOos,
      });

      const rateFromCounts = (oos: number, insp: number): number | null =>
        insp && oos != null ? Math.round((oos / insp) * 10000) / 100 : null;

      qc = {
        vehicleOosRate:
          c.vehicleOosRate ?? rateFromCounts(c.vehicleOos, c.vehicleInspections),
        driverOosRate:
          c.driverOosRate ?? rateFromCounts(c.driverOos, c.driverInspections),
        hazmatOosRate:
          c.hazmatOosRate ?? rateFromCounts(c.hazmatOos, c.hazmatInspections),
        inspectionTotal: c.inspectionTotal ?? null,
        vehicleInspections: c.vehicleInspections ?? null,
        driverInspections: c.driverInspections ?? null,
        hazmatInspections: c.hazmatInspections ?? null,
        vehicleOos: c.vehicleOos ?? null,
        driverOos: c.driverOos ?? null,
        hazmatOos: c.hazmatOos ?? null,
        nationalVehicleOosRate: c.nationalVehicleOosRate ?? 22.26,
        nationalDriverOosRate: c.nationalDriverOosRate ?? 6.67,
        nationalHazmatOosRate: c.nationalHazmatOosRate ?? 4.44,
      };
    } catch (err) {
      console.error(`FMCSA OOS rates API failed for DOT ${dot}:`, err);
    }
  } else {
    console.warn("FMCSA_API_KEY not set; computing OOS from DataHub inspections");
  }

  // QCMobile /oos is known to return all-null rates for some carriers (e.g. DOT 2533650).
  // When the QC rates are missing, derive them from the DataHub inspection dataset,
  // which carries per-inspection vehicle/driver/hazmat inspection + OOS totals.
  const qcHasRates =
    qc &&
    (qc.vehicleOosRate !== null ||
      qc.driverOosRate !== null ||
      qc.hazmatOosRate !== null);

  if (!qcHasRates) {
    const derived = await computeOosFromDatahub(dot);
    if (derived) {
      return {
        ...derived,
        nationalVehicleOosRate: qc?.nationalVehicleOosRate ?? 22.26,
        nationalDriverOosRate: qc?.nationalDriverOosRate ?? 6.67,
        nationalHazmatOosRate: qc?.nationalHazmatOosRate ?? 4.44,
      };
    }
  }

  return qc ?? emptyOosRates();
}

/**
 * Derive carrier OOS rates from the DataHub inspection dataset, approximating the
 * FMCSA SMS methodology:
 *   rate = (inspections with ≥1 OOS in that category) / (inspections of that category)
 * over the trailing 24-month SMS window.
 *
 * Denominator (category was inspected): inspection levels 1/2/5 examine the vehicle,
 * 1/2/3/6 examine the driver; hazmat is counted when any hazmat viol/OOS is present.
 * Numerator counts OOS *inspections*, not the sum of OOS violations — matching how
 * SAFER reports the rate. Validated against DOT 2533650: driver 1.89% vs SAFER 1.9%,
 * hazmat 50% vs SAFER 50%, vehicle ~17% vs SAFER 20%.
 *
 * Returns null when there are no inspections in-window to compute from.
 */
async function computeOosFromDatahub(dot: string): Promise<FMCSAOosRates | null> {
  try {
    const { getInspectionsByDot } = await import("./datahub-client");
    const rows = await getInspectionsByDot(dot);
    if (!rows.length) return null;

    // 24-month SMS window, compared on the YYYYMMDD inspectionDate string.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 24);
    const cutYmd =
      cutoff.getFullYear() * 10000 +
      (cutoff.getMonth() + 1) * 100 +
      cutoff.getDate();

    let total = 0;
    let vehInsp = 0,
      drvInsp = 0,
      hmInsp = 0;
    let vehOosInsp = 0,
      drvOosInsp = 0,
      hmOosInsp = 0;

    for (const r of rows) {
      const ymd = Number((r.inspectionDate || "0").replaceAll("-", ""));
      if (ymd && ymd < cutYmd) continue;
      total++;

      const vehicleInspected =
        [1, 2, 5].includes(r.level) || r.vehicleViolTotal > 0 || r.vehicleOosTotal > 0;
      const driverInspected =
        [1, 2, 3, 6].includes(r.level) || r.driverViolTotal > 0 || r.driverOosTotal > 0;
      // Hazmat inspections: FMCSA counts only Level 1 (full), Level 3 (driver+HM),
      // or Level 4 (special purpose / hazmat-specific) inspections, NOT every
      // inspection that happened to uncover a hazmat violation. Using the violation
      // totals alone overestimates the denominator and understates the rate.
      const hazmatInspected =
        [1, 3, 4].includes(r.level) && (r.hazmatViolTotal > 0 || r.hazmatOosTotal > 0);

      if (vehicleInspected) vehInsp++;
      if (driverInspected) drvInsp++;
      if (hazmatInspected) hmInsp++;

      if (r.vehicleOosTotal > 0) vehOosInsp++;
      if (r.driverOosTotal > 0) drvOosInsp++;
      if (r.hazmatOosTotal > 0) hmOosInsp++;
    }

    if (total === 0) return null;

    const rate = (oos: number, insp: number): number | null =>
      insp > 0 ? Math.round((oos / insp) * 10000) / 100 : null;

    return {
      vehicleOosRate: rate(vehOosInsp, vehInsp),
      driverOosRate: rate(drvOosInsp, drvInsp),
      hazmatOosRate: rate(hmOosInsp, hmInsp),
      inspectionTotal: total,
      vehicleInspections: vehInsp,
      driverInspections: drvInsp,
      hazmatInspections: hmInsp,
      vehicleOos: vehOosInsp,
      driverOos: drvOosInsp,
      hazmatOos: hmOosInsp,
      nationalVehicleOosRate: 22.26,
      nationalDriverOosRate: 6.67,
      nationalHazmatOosRate: 4.44,
    };
  } catch (err) {
    console.error(`DataHub OOS computation failed for DOT ${dot}:`, err);
    return null;
  }
}

function emptyBasics(
  sourceStatus: FMCSABasicsSourceStatus = {
    source: "qcmobile_basics",
    status: "available",
    reason: null,
    httpStatus: null,
  }
): FMCSABasics {
  return {
    unsafeDriving: null,
    hosCompliance: null,
    driverFitness: null,
    controlledSubstances: null,
    vehicleMaintenance: null,
    hmCompliance: null,
    crashIndicator: null,
    smsSnapshotDate: null,
    retrievedAt: null,
    sourceStatus,
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
    nationalHazmatOosRate: 4.44,
  };
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
  convicted: null;
  citationNumber: string | null;
}

export interface FMCSACrashRecord {
  reportNumber: string;
  reportSequenceNumber: string | null;
  crashDate: string;
  state: string;
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

export async function getInspections(
  dot: string,
  options: { throwOnError?: boolean } = {}
): Promise<FMCSAInspection[]> {
  const { getInspectionsByDot, getViolationsByDot } = await import("./datahub-client");

  // Fetch inspections and violations concurrently
  const [rows, violations] = await Promise.all([
    getInspectionsByDot(dot, options),
    getViolationsByDot(dot, options),
  ]);

  // Both monthly SMS input datasets expose the same inspection unique_id.
  // Joining on it prevents violations from being copied to every inspection
  // when a carrier has multiple inspections on the same date.
  const violationsByInspectionId = new Map<string, typeof violations>();
  for (const v of violations) {
    if (!violationsByInspectionId.has(v.uniqueId)) {
      violationsByInspectionId.set(v.uniqueId, []);
    }
    violationsByInspectionId.get(v.uniqueId)!.push(v);
  }

  return rows
    .filter((r) => r.reportNumber !== "")
    .map((r) => {
      const matchedViolations = violationsByInspectionId.get(r.uniqueId) ?? [];

      return {
        reportNumber: r.reportNumber,
        inspectionDate: r.inspectionDate,
        state: r.reportState,
        level: String(r.level),
        facilityName: r.facilityName
          ? `${r.facilityName} — ${r.reportState}`
          : "",
        timeWeight: r.timeWeight,
        violations: matchedViolations.map((v) => ({
          violationCode: v.violationCode,
          description: v.description,
          basicCategory: v.basicCategory,
          severityWeight: v.severityWeight,
          oosViolation: v.oosViolation,
          // The public SMS input dataset does not provide court disposition.
          convicted: null,
          citationNumber: null,
        })),
      };
    });
}

export async function getCrashes(
  dot: string,
  options: { throwOnError?: boolean } = {}
): Promise<FMCSACrashRecord[]> {
  const { getCrashesByDot } = await import("./datahub-client");
  const rows = await getCrashesByDot(dot, options);
  return rows.map((r) => ({
    reportNumber: r.reportNumber,
    reportSequenceNumber: r.reportSequenceNumber,
    crashDate: r.crashDate,
    state: r.reportState,
    city: r.city,
    location: r.location,
    fatalities: r.fatalities,
    injuries: r.injuries,
    towAway: r.towAway,
    hazmatRelease: r.hazmatRelease,
    trafficway: r.trafficway,
    accessControlDesc: r.accessControlDesc,
    roadSurfaceCondition: r.roadSurfaceCondition,
    weatherCondition: r.weatherCondition,
    lightCondition: r.lightCondition,
    vehicleConfiguration: r.vehicleConfiguration,
    severityWeight: r.severityWeight,
    timeWeight: r.timeWeight,
    citationIssued: r.citationIssued,
    fmcsaNotPreventable: r.fmcsaNotPreventable,
    vehicleIdentificationNumber: r.vehicleIdentificationNumber,
    vehicleLicenseNumber: r.vehicleLicenseNumber,
    vehicleLicenseState: r.vehicleLicenseState,
    federalRecordable: r.federalRecordable,
    stateRecordable: r.stateRecordable,
    rawData: r.rawData,
  }));
}

