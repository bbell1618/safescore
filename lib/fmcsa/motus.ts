/**
 * Current FMCSA registration and insurance data.
 *
 * FMCSA retired updates to the legacy Licensing & Insurance public system on
 * 2026-05-14. Motus is its current successor. These endpoints are public but
 * undocumented, so every structural assumption is validated and failures are
 * loud; the last validated database row remains intact on layout drift.
 */

const MOTUS_API = "https://motus.dot.gov/api";
const REQUEST_TIMEOUT_MS = 15_000;
const FINANCIAL_PAGE_SIZE = 100;
const MAX_FINANCIAL_ROWS = 5_000;

export type MotusAuthority = {
  registrationId: string;
  docketNumber: string | null;
  type: string;
  status: string;
  minimumBipdCoverage: number | null;
  filedBipdCoverage: number | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  pendingActions: string[];
};

export type MotusInsuranceFiling = {
  filingId: string;
  authorityType: string | null;
  status: string | null;
  statusReason: string | null;
  formType: string | null;
  formDescription: string | null;
  filedAmount: number | null;
  insuranceClass: string | null;
  policyNumber: string | null;
  receivedDate: string | null;
  effectiveDate: string | null;
  cancellationDate: string | null;
  insuranceCompanyName: string | null;
  submittedBy: string | null;
};

export type MotusCarrierSnapshot = {
  dotNumber: string;
  legalName: string;
  usdotStatus: string;
  outOfService: boolean;
  docketNumbers: string[];
  authorities: MotusAuthority[];
  insuranceFilings: MotusInsuranceFiling[];
  pendingActions: string[];
  authorityHistory: [];
  sourceAsOf: null;
  legacyLiStatus: "historical_only_since_2026-05-14";
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[motus] Layout drift: ${label} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`[motus] Layout drift: ${label} must be an array`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[motus] Layout drift: ${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[motus] Layout drift: expected a finite numeric value`);
  }
  return parsed;
}

function canonicalDocket(value: unknown): string | null {
  const raw = optionalString(value);
  if (!raw) return null;
  const match = /^(MC|MX|FF)-?(\d+)$/i.exec(raw.replace(/\s+/g, ""));
  if (!match) {
    throw new Error(`[motus] Layout drift: invalid docket number ${raw}`);
  }
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function thousandsToDollars(value: unknown): number | null {
  const amount = optionalNumber(value);
  return amount === null ? null : amount * 1_000;
}

function pendingActionsForRegistration(registration: JsonObject): string[] {
  const fields: Array<[string, string]> = [
    ["commonAppPend", "Common-carrier application pending"],
    ["contractAppPend", "Contract-carrier application pending"],
    ["brokerAppPend", "Broker application pending"],
    ["commonRevPend", "Common-carrier revocation pending"],
    ["contractRevPend", "Contract-carrier revocation pending"],
    ["brokerRevPend", "Broker revocation pending"],
    ["processingProtestPeriod", "Authority protest period in progress"],
  ];
  const actions: string[] = [];
  for (const [field, label] of fields) {
    const value = registration[field];
    if (value === true) {
      actions.push(label);
    } else if (typeof value === "string" && value.trim()) {
      actions.push(`${label}: ${value.trim()}`);
    }
  }
  return actions;
}

function parseAuthorities(registrationsValue: unknown): {
  authorities: MotusAuthority[];
  pendingActions: string[];
  registrationIds: string[];
} {
  const registrations = array(
    registrationsValue,
    "carrier.entityRegistrations",
  );
  const authorities: MotusAuthority[] = [];
  const aggregateActions: string[] = [];
  const registrationIds: string[] = [];

  for (const [registrationIndex, rawRegistration] of registrations.entries()) {
    const registration = object(
      rawRegistration,
      `carrier.entityRegistrations[${registrationIndex}]`,
    );
    const registrationId = requiredString(
      registration.entityRegistrationId,
      `carrier.entityRegistrations[${registrationIndex}].entityRegistrationId`,
    );
    registrationIds.push(registrationId);
    const registrationActions = pendingActionsForRegistration(registration);
    aggregateActions.push(...registrationActions);
    const links = array(
      registration.entityRegistrationOperatingAuthorities,
      `carrier.entityRegistrations[${registrationIndex}].entityRegistrationOperatingAuthorities`,
    );

    for (const [authorityIndex, rawLink] of links.entries()) {
      const link = object(
        rawLink,
        `carrier.entityRegistrations[${registrationIndex}].authority[${authorityIndex}]`,
      );
      const authority = object(
        link.entityOperatingAuthority,
        `carrier.entityRegistrations[${registrationIndex}].authority[${authorityIndex}].entityOperatingAuthority`,
      );
      const type = object(
        authority.operatingAuthorityType,
        `authority[${authorityIndex}].operatingAuthorityType`,
      );
      const status = object(
        authority.operatingAuthorityStatus,
        `authority[${authorityIndex}].operatingAuthorityStatus`,
      );
      const authorityActions = [...registrationActions];
      const protestStart = optionalString(authority.protestPeriodStartDate);
      if (protestStart) {
        authorityActions.push(`Protest period started ${protestStart}`);
      }
      authorities.push({
        registrationId,
        docketNumber: canonicalDocket(authority.docketNumber),
        type: requiredString(
          type.operatingAuthorityType,
          `authority[${authorityIndex}].operatingAuthorityType.operatingAuthorityType`,
        ),
        status: requiredString(
          status.operatingAuthorityStatusName,
          `authority[${authorityIndex}].operatingAuthorityStatus.operatingAuthorityStatusName`,
        ),
        minimumBipdCoverage: thousandsToDollars(
          registration.minCovAmount,
        ),
        filedBipdCoverage: thousandsToDollars(registration.bipdFile),
        sourceCreatedAt: optionalString(authority.createDate),
        sourceUpdatedAt: optionalString(authority.updateDate),
        pendingActions: [...new Set(authorityActions)],
      });
    }
  }

  return {
    authorities,
    pendingActions: [...new Set(aggregateActions)],
    registrationIds,
  };
}

function parseInsurancePage(
  value: unknown,
  label: string,
): { rows: MotusInsuranceFiling[]; total: number } {
  const page = object(value, label);
  const tableData = array(page.tableData, `${label}.tableData`);
  if (typeof page.total !== "number" || !Number.isInteger(page.total)) {
    throw new Error(`[motus] Layout drift: ${label}.total must be an integer`);
  }
  return {
    total: page.total,
    rows: tableData.map((rawRow, index) => {
      const row = object(rawRow, `${label}.tableData[${index}]`);
      return {
        filingId: requiredString(
          row.filingId,
          `${label}.tableData[${index}].filingId`,
        ),
        authorityType: optionalString(row.opAuthType),
        status: optionalString(row.filingStatus),
        statusReason: optionalString(row.filingStatusReason),
        formType: optionalString(row.insFormType),
        formDescription: optionalString(row.insuranceFormDesc),
        filedAmount: optionalNumber(row.insFiled),
        insuranceClass: optionalString(row.insClass),
        policyNumber: optionalString(row.policyNum),
        receivedDate: optionalString(row.recDate),
        effectiveDate: optionalString(row.polEffDate),
        cancellationDate: optionalString(row.polCancelDate),
        insuranceCompanyName: optionalString(row.insuranceCompanyName),
        submittedBy: optionalString(row.submittedBy),
      };
    }),
  };
}

export function parseMotusCarrierSnapshot(input: {
  dotNumber: string;
  detail: unknown;
  financialPages: unknown[];
  allHistory: unknown;
  registrationHistories: unknown[];
}): MotusCarrierSnapshot {
  const normalizedDot = input.dotNumber.replace(/\D/g, "");
  const detail = object(input.detail, "carrier");
  const dot = object(detail.entityDotNumber, "carrier.entityDotNumber");
  const sourceDot = requiredString(
    dot.dotNumber,
    "carrier.entityDotNumber.dotNumber",
  ).replace(/\D/g, "");
  if (sourceDot !== normalizedDot) {
    throw new Error(
      `[motus] DOT mismatch: requested ${normalizedDot}, received ${sourceDot}`,
    );
  }
  const dotStatus = object(
    dot.dotNumberStatus,
    "carrier.entityDotNumber.dotNumberStatus",
  );
  if (typeof detail.outOfService !== "boolean") {
    throw new Error(
      "[motus] Layout drift: carrier.outOfService must be boolean",
    );
  }
  const { authorities, pendingActions } = parseAuthorities(
    detail.entityRegistrations,
  );

  if (input.financialPages.length === 0) {
    throw new Error("[motus] No financial-responsibility page was supplied");
  }
  const parsedPages = input.financialPages.map((page, index) =>
    parseInsurancePage(page, `financial[${index}]`),
  );
  const total = parsedPages[0].total;
  const insuranceFilings = parsedPages.flatMap((page) => page.rows);
  if (parsedPages.some((page) => page.total !== total)) {
    throw new Error(
      "[motus] Layout drift: financial-responsibility totals changed during pagination",
    );
  }
  if (insuranceFilings.length !== total) {
    throw new Error(
      `[motus] Incomplete financial-responsibility pagination: expected ${total}, received ${insuranceFilings.length}`,
    );
  }

  const allHistory = array(input.allHistory, "authorityHistoryAll");
  for (const [index, history] of input.registrationHistories.entries()) {
    array(history, `authorityHistory[${index}]`);
  }
  if (
    allHistory.length > 0 ||
    input.registrationHistories.some(
      (history) => (history as unknown[]).length > 0,
    )
  ) {
    throw new Error(
      "[motus] Authority-history records appeared without a verified public schema; parser update required",
    );
  }

  const docketNumbers = [
    ...new Set(
      authorities
        .map((authority) => authority.docketNumber)
        .filter((value): value is string => value !== null),
    ),
  ];
  return {
    dotNumber: sourceDot,
    legalName: requiredString(detail.entityName, "carrier.entityName"),
    usdotStatus: requiredString(
      dotStatus.dotNumberStatus,
      "carrier.entityDotNumber.dotNumberStatus.dotNumberStatus",
    ),
    outOfService: detail.outOfService,
    docketNumbers,
    authorities,
    insuranceFilings,
    pendingActions,
    authorityHistory: [],
    sourceAsOf: null,
    legacyLiStatus: "historical_only_since_2026-05-14",
  };
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `[motus] ${label} HTTP ${response.status} ${response.statusText}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`[motus] ${label} returned invalid JSON`);
  }
}

export async function getMotusCarrierSnapshot(
  dotNumber: string,
): Promise<MotusCarrierSnapshot> {
  const normalizedDot = dotNumber.replace(/\D/g, "");
  if (!normalizedDot) throw new Error("[motus] A DOT number is required");

  const detail = object(
    await fetchJson(
      `${MOTUS_API}/carriers/${encodeURIComponent(normalizedDot)}`,
      "carrier detail",
    ),
    "carrier",
  );
  const entityId = requiredString(detail.entityId, "carrier.entityId");
  const entityTypes = array(detail.entityTypes, "carrier.entityTypes");
  if (entityTypes.length === 0) {
    throw new Error("[motus] Layout drift: carrier.entityTypes is empty");
  }
  const entityTypeId = requiredString(
    object(entityTypes[0], "carrier.entityTypes[0]").entityTypeId,
    "carrier.entityTypes[0].entityTypeId",
  );
  const registrations = array(
    detail.entityRegistrations,
    "carrier.entityRegistrations",
  );
  const registrationIds = registrations.map((registration, index) =>
    requiredString(
      object(
        registration,
        `carrier.entityRegistrations[${index}]`,
      ).entityRegistrationId,
      `carrier.entityRegistrations[${index}].entityRegistrationId`,
    ),
  );

  const financialPages: unknown[] = [];
  let page = 0;
  let total = 1;
  while (financialPages.length * FINANCIAL_PAGE_SIZE < total) {
    const financial = await fetchJson(
      `${MOTUS_API}/filings/financialResponsibility/${entityId}` +
        `?entityId=${encodeURIComponent(entityId)}` +
        `&entityType=${encodeURIComponent(entityTypeId)}` +
        `&page=${page}&pageSize=${FINANCIAL_PAGE_SIZE}&searchValue=`,
      `financial responsibility page ${page}`,
    );
    const parsed = parseInsurancePage(financial, `financial[${page}]`);
    total = parsed.total;
    if (total > MAX_FINANCIAL_ROWS) {
      throw new Error(
        `[motus] Refusing unexpectedly large insurance result (${total} rows)`,
      );
    }
    financialPages.push(financial);
    page += 1;
    if (total === 0) break;
  }

  const allHistory = await fetchJson(
    `${MOTUS_API}/entity/entity-registration-history-all/${entityId}`,
    "authority history",
  );
  const registrationHistories: unknown[] = [];
  for (const registrationId of registrationIds) {
    registrationHistories.push(
      await fetchJson(
        `${MOTUS_API}/entity/entity-registration-history/${registrationId}`,
        `authority history ${registrationId}`,
      ),
    );
  }

  return parseMotusCarrierSnapshot({
    dotNumber: normalizedDot,
    detail,
    financialPages,
    allHistory,
    registrationHistories,
  });
}
