export const DQF_CHECKLIST_ITEMS = [
  {
    docType: "application",
    label: "Employment application",
    description: "The driver's completed employment application.",
    annual: false,
  },
  {
    docType: "prior_employer_checks",
    label: "Prior-employer safety checks",
    description: "The required prior-employer safety-performance inquiries.",
    annual: false,
  },
  {
    docType: "road_test",
    label: "Road test or certificate",
    description: "A road-test certificate or an accepted equivalent.",
    annual: false,
  },
  {
    docType: "mvr",
    label: "Initial motor vehicle record",
    description: "The motor vehicle record obtained for driver qualification.",
    annual: false,
  },
  {
    docType: "annual_mvr_review",
    label: "Annual MVR review",
    description: "The latest annual driving-record review.",
    annual: true,
  },
  {
    docType: "medical_cert",
    label: "Medical certificate",
    description: "The current medical examiner's certificate.",
    annual: false,
  },
  {
    docType: "clearinghouse_pre_employment",
    label: "Clearinghouse pre-employment query",
    description: "The pre-employment Clearinghouse query record.",
    annual: false,
  },
] as const;

export type DqfChecklistDocumentType =
  (typeof DQF_CHECKLIST_ITEMS)[number]["docType"];

export type ComplianceHealthStatus =
  | "missing"
  | "on_file"
  | "expiring"
  | "expired";

export type ComplianceExpirationThreshold =
  | "60_day"
  | "30_day"
  | "7_day"
  | "expired";

export type ComplianceExpirationItemType =
  | "medical_certificate"
  | "cdl"
  | "annual_vehicle_inspection"
  | "annual_mvr_review"
  | "clearinghouse_annual_query";

export type ComplianceExpirationSubjectType =
  | "driver"
  | "driver_document"
  | "vehicle";

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceHealthStatus, string> = {
  missing: "Missing",
  on_file: "On file",
  expiring: "Expiring",
  expired: "Expired",
};

export type ComplianceHealthDriverInput = {
  id: string;
  full_name: string;
  status: "active" | "inactive" | "terminated" | string;
  cdl_expiry: string | null;
  medical_cert_expiry: string | null;
};

export type ComplianceHealthDriverDocumentInput = {
  id: string;
  driver_id: string;
  doc_type: string;
  status: "current" | "expiring_soon" | "expired" | "missing" | string;
  completed_date: string | null;
  expiry_date: string | null;
  document_id: string | null;
};

export type ComplianceHealthVehicleInput = {
  id: string;
  unit_number: string | null;
  status: "active" | "inactive" | string;
  annual_inspection_date: string | null;
};

export type ComplianceHealthClearinghouseInput = {
  id: string;
  driver_id: string | null;
  query_date: string;
};

export type DqfChecklistHealthItem = {
  docType: DqfChecklistDocumentType;
  label: string;
  description: string;
  status: ComplianceHealthStatus;
  completedDate: string | null;
  dueDate: string | null;
  documentId: string | null;
  driverDocumentId: string | null;
};

export type DriverComplianceHealth = {
  id: string;
  name: string;
  overallStatus: ComplianceHealthStatus;
  cdlStatus: ComplianceHealthStatus;
  medicalCertificateStatus: ComplianceHealthStatus;
  clearinghouseStatus: ComplianceHealthStatus;
  dqfItems: DqfChecklistHealthItem[];
  nextDueDate: string | null;
};

export type VehicleComplianceHealth = {
  id: string;
  unitNumber: string | null;
  overallStatus: ComplianceHealthStatus;
  annualInspectionDate: string | null;
  annualInspectionDueDate: string | null;
  daysRemaining: number | null;
};

export type UpcomingComplianceItem = {
  key: string;
  itemType: ComplianceExpirationItemType;
  subjectType: ComplianceExpirationSubjectType;
  subjectId: string;
  subjectName: string;
  title: string;
  dueDate: string;
  daysRemaining: number;
  status: ComplianceHealthStatus;
  threshold: ComplianceExpirationThreshold;
  driverId: string | null;
  driverDocumentId: string | null;
  vehicleId: string | null;
};

type ComplianceHealthCountGroup<T> = {
  total: number;
  compliant: number;
  expiring: number;
  expired: number;
  missing: number;
  items: T[];
};

export type ComplianceHealth = {
  asOfDate: string;
  drivers: ComplianceHealthCountGroup<DriverComplianceHealth>;
  vehicles: ComplianceHealthCountGroup<VehicleComplianceHealth>;
  upcoming: UpcomingComplianceItem[];
};

export type BuildComplianceHealthInput = {
  asOfDate: string;
  drivers: ComplianceHealthDriverInput[];
  driverDocuments: ComplianceHealthDriverDocumentInput[];
  vehicles: ComplianceHealthVehicleInput[];
  clearinghouseRecords: ComplianceHealthClearinghouseInput[];
};

const DAY_MS = 24 * 60 * 60 * 1_000;

type DateParts = { year: number; month: number; day: number };

function parseDateOnly(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date-only value: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date-only value: ${value}`);
  }
  return { year, month, day };
}

function formatDateOnly(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0"
  )}-${String(parts.day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateOnlyEpoch(value: string): number {
  const { year, month, day } = parseDateOnly(value);
  return Date.UTC(year, month - 1, day);
}

export function deriveAnnualDueDate(value: string | null): string | null {
  if (!value) return null;
  const { year, month, day } = parseDateOnly(value);
  const nextYear = year + 1;
  return formatDateOnly({
    year: nextYear,
    month,
    day: Math.min(day, daysInMonth(nextYear, month)),
  });
}

export function daysUntilDate(
  dueDate: string | null,
  asOfDate: string
): number | null {
  parseDateOnly(asOfDate);
  if (!dueDate) return null;
  return Math.round((dateOnlyEpoch(dueDate) - dateOnlyEpoch(asOfDate)) / DAY_MS);
}

export function complianceThresholdForDays(
  daysRemaining: number | null
): ComplianceExpirationThreshold | null {
  if (daysRemaining === null || daysRemaining > 60) return null;
  if (daysRemaining <= 0) return "expired";
  if (daysRemaining <= 7) return "7_day";
  if (daysRemaining <= 30) return "30_day";
  return "60_day";
}

export function complianceStatusForDays(
  daysRemaining: number | null,
  hasRecord = true
): ComplianceHealthStatus {
  if (!hasRecord) return "missing";
  if (daysRemaining === null) return "on_file";
  if (daysRemaining <= 0) return "expired";
  if (daysRemaining <= 60) return "expiring";
  return "on_file";
}

export function complianceStatusLabel(status: ComplianceHealthStatus): string {
  return COMPLIANCE_STATUS_LABELS[status];
}

function worstStatus(statuses: ComplianceHealthStatus[]): ComplianceHealthStatus {
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("expiring")) return "expiring";
  return "on_file";
}

function documentHealthStatus(
  row: ComplianceHealthDriverDocumentInput | undefined,
  dueDate: string | null,
  asOfDate: string
): ComplianceHealthStatus {
  if (!row || row.status === "missing") return "missing";
  if (row.status === "expired") return "expired";
  const dateStatus = complianceStatusForDays(
    daysUntilDate(dueDate, asOfDate),
    true
  );
  if (dateStatus !== "on_file") return dateStatus;
  return row.status === "expiring_soon" ? "expiring" : "on_file";
}

function earliestDate(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => value !== null);
  if (dates.length === 0) return null;
  return dates.sort()[0] ?? null;
}

function summarize<T extends { overallStatus: ComplianceHealthStatus }>(
  items: T[]
): ComplianceHealthCountGroup<T> {
  return {
    total: items.length,
    compliant: items.filter((item) => item.overallStatus === "on_file").length,
    expiring: items.filter((item) => item.overallStatus === "expiring").length,
    expired: items.filter((item) => item.overallStatus === "expired").length,
    missing: items.filter((item) => item.overallStatus === "missing").length,
    items,
  };
}

function addUpcoming(
  upcoming: UpcomingComplianceItem[],
  input: Omit<UpcomingComplianceItem, "key" | "daysRemaining" | "status" | "threshold">,
  asOfDate: string
) {
  const daysRemaining = daysUntilDate(input.dueDate, asOfDate);
  const threshold = complianceThresholdForDays(daysRemaining);
  if (daysRemaining === null || threshold === null) return;
  upcoming.push({
    ...input,
    key: `${input.itemType}:${input.subjectId}:${input.dueDate}`,
    daysRemaining,
    status: complianceStatusForDays(daysRemaining),
    threshold,
  });
}

export function buildComplianceHealth(
  input: BuildComplianceHealthInput
): ComplianceHealth {
  parseDateOnly(input.asOfDate);
  const docsByDriver = new Map<
    string,
    Map<string, ComplianceHealthDriverDocumentInput>
  >();
  for (const row of input.driverDocuments) {
    const byType = docsByDriver.get(row.driver_id) ?? new Map();
    byType.set(row.doc_type, row);
    docsByDriver.set(row.driver_id, byType);
  }

  const clearinghouseByDriver = new Map<
    string,
    ComplianceHealthClearinghouseInput
  >();
  for (const row of input.clearinghouseRecords) {
    if (!row.driver_id) continue;
    const current = clearinghouseByDriver.get(row.driver_id);
    if (!current || current.query_date < row.query_date) {
      clearinghouseByDriver.set(row.driver_id, row);
    }
  }

  const upcoming: UpcomingComplianceItem[] = [];
  const drivers = input.drivers
    .filter((driver) => driver.status === "active")
    .map((driver): DriverComplianceHealth => {
      const documents = docsByDriver.get(driver.id) ?? new Map();
      const cdlDocument = documents.get("cdl");
      const medicalDocument = documents.get("medical_cert");
      const cdlStatus = complianceStatusForDays(
        daysUntilDate(driver.cdl_expiry, input.asOfDate),
        driver.cdl_expiry !== null
      );
      const medicalCertificateStatus = complianceStatusForDays(
        daysUntilDate(driver.medical_cert_expiry, input.asOfDate),
        driver.medical_cert_expiry !== null
      );
      const clearinghouse = clearinghouseByDriver.get(driver.id);
      const clearinghouseDueDate = deriveAnnualDueDate(
        clearinghouse?.query_date ?? null
      );
      const clearinghouseStatus = complianceStatusForDays(
        daysUntilDate(clearinghouseDueDate, input.asOfDate),
        clearinghouse !== undefined
      );

      const dqfItems = DQF_CHECKLIST_ITEMS.map((definition) => {
        const row = documents.get(definition.docType);
        const dueDate =
          row?.expiry_date ??
          (definition.annual
            ? deriveAnnualDueDate(row?.completed_date ?? null)
            : null);
        return {
          docType: definition.docType,
          label: definition.label,
          description: definition.description,
          status:
            definition.annual && !dueDate
              ? "missing"
              : documentHealthStatus(row, dueDate, input.asOfDate),
          completedDate: row?.completed_date ?? null,
          dueDate,
          documentId: row?.document_id ?? null,
          driverDocumentId: row?.id ?? null,
        } satisfies DqfChecklistHealthItem;
      });

      if (driver.cdl_expiry) {
        addUpcoming(
          upcoming,
          {
            itemType: "cdl",
            subjectType: "driver",
            subjectId: driver.id,
            subjectName: driver.full_name,
            title: `CDL — ${driver.full_name}`,
            dueDate: driver.cdl_expiry,
            driverId: driver.id,
            driverDocumentId: cdlDocument?.id ?? null,
            vehicleId: null,
          },
          input.asOfDate
        );
      }
      if (driver.medical_cert_expiry) {
        addUpcoming(
          upcoming,
          {
            itemType: "medical_certificate",
            subjectType: "driver",
            subjectId: driver.id,
            subjectName: driver.full_name,
            title: `Medical certificate — ${driver.full_name}`,
            dueDate: driver.medical_cert_expiry,
            driverId: driver.id,
            driverDocumentId: medicalDocument?.id ?? null,
            vehicleId: null,
          },
          input.asOfDate
        );
      }

      const annualMvr = documents.get("annual_mvr_review");
      const annualMvrDue =
        annualMvr?.expiry_date ??
        deriveAnnualDueDate(annualMvr?.completed_date ?? null);
      if (annualMvr && annualMvrDue) {
        addUpcoming(
          upcoming,
          {
            itemType: "annual_mvr_review",
            subjectType: "driver_document",
            subjectId: annualMvr.id,
            subjectName: driver.full_name,
            title: `Annual MVR review — ${driver.full_name}`,
            dueDate: annualMvrDue,
            driverId: driver.id,
            driverDocumentId: annualMvr.id,
            vehicleId: null,
          },
          input.asOfDate
        );
      }
      if (clearinghouseDueDate) {
        addUpcoming(
          upcoming,
          {
            itemType: "clearinghouse_annual_query",
            subjectType: "driver",
            subjectId: driver.id,
            subjectName: driver.full_name,
            title: `Annual Clearinghouse query — ${driver.full_name}`,
            dueDate: clearinghouseDueDate,
            driverId: driver.id,
            driverDocumentId: null,
            vehicleId: null,
          },
          input.asOfDate
        );
      }

      const dueDates = [
        driver.cdl_expiry,
        driver.medical_cert_expiry,
        clearinghouseDueDate,
        ...dqfItems.map((item) => item.dueDate),
      ];
      return {
        id: driver.id,
        name: driver.full_name,
        overallStatus: worstStatus([
          cdlStatus,
          medicalCertificateStatus,
          clearinghouseStatus,
          ...dqfItems.map((item) => item.status),
        ]),
        cdlStatus,
        medicalCertificateStatus,
        clearinghouseStatus,
        dqfItems,
        nextDueDate: earliestDate(dueDates),
      };
    });

  const vehicles = input.vehicles
    .filter((vehicle) => vehicle.status === "active")
    .map((vehicle): VehicleComplianceHealth => {
      const annualInspectionDueDate = deriveAnnualDueDate(
        vehicle.annual_inspection_date
      );
      const daysRemaining = daysUntilDate(
        annualInspectionDueDate,
        input.asOfDate
      );
      const overallStatus = complianceStatusForDays(
        daysRemaining,
        vehicle.annual_inspection_date !== null
      );
      if (annualInspectionDueDate) {
        const unitLabel = vehicle.unit_number
          ? `Unit ${vehicle.unit_number}`
          : "Vehicle without a unit number";
        addUpcoming(
          upcoming,
          {
            itemType: "annual_vehicle_inspection",
            subjectType: "vehicle",
            subjectId: vehicle.id,
            subjectName: unitLabel,
            title: `Annual DOT inspection — ${unitLabel}`,
            dueDate: annualInspectionDueDate,
            driverId: null,
            driverDocumentId: null,
            vehicleId: vehicle.id,
          },
          input.asOfDate
        );
      }
      return {
        id: vehicle.id,
        unitNumber: vehicle.unit_number,
        overallStatus,
        annualInspectionDate: vehicle.annual_inspection_date,
        annualInspectionDueDate,
        daysRemaining,
      };
    });

  upcoming.sort(
    (left, right) =>
      left.daysRemaining - right.daysRemaining ||
      left.title.localeCompare(right.title)
  );

  return {
    asOfDate: input.asOfDate,
    drivers: summarize(drivers),
    vehicles: summarize(vehicles),
    upcoming,
  };
}
