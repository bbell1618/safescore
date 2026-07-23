export type AlertSeverity = "info" | "warning" | "critical";

export type MonitoringAlertCandidate = {
  clientId: string;
  type: "new_violation" | "new_inspection" | "new_crash" | "oos_change";
  severity: AlertSeverity;
  title: string;
  message: string;
  entityType: "violations" | "inspections" | "crashes" | "score_snapshots";
  entityId: string;
};

export type MonitoringViolationRow = {
  id: string;
  violation_code: string | null;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean | null;
  inspections:
    | { inspection_date: string | null }
    | Array<{ inspection_date: string | null }>
    | null;
};

export type MonitoringCrashRow = {
  id: string;
  report_number: string | null;
  crash_date: string | null;
  city: string | null;
  state: string | null;
  fatalities: number | null;
  injuries: number | null;
  tow_away: boolean | null;
};

export type MonitoringInspectionRow = {
  id: string;
  report_number: string | null;
  inspection_date: string | null;
  state: string | null;
  level: string | null;
  total_violations: number | null;
  oos_violations: number | null;
};

export type MonitoringOosRateChange = {
  scoreSnapshotId: string;
  changes: Array<{
    label: string;
    previous: number;
    current: number;
  }>;
};

export type MonitoringOosRateSnapshot = {
  id: string;
  oos_vehicle_rate: unknown;
  oos_driver_rate: unknown;
  oos_hazmat_rate: unknown;
};

const OOS_RATE_FIELDS = [
  { column: "oos_vehicle_rate", label: "Vehicle" },
  { column: "oos_driver_rate", label: "Driver" },
  { column: "oos_hazmat_rate", label: "Hazmat" },
] as const;

function numericRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function detectOosRateChange(
  previous: MonitoringOosRateSnapshot | null,
  current: MonitoringOosRateSnapshot
): MonitoringOosRateChange | null {
  if (!previous) return null;
  const changes = OOS_RATE_FIELDS.flatMap(({ column, label }) => {
    const previousRate = numericRate(previous[column]);
    const currentRate = numericRate(current[column]);
    return previousRate !== null &&
      currentRate !== null &&
      previousRate !== currentRate
      ? [{ label, previous: previousRate, current: currentRate }]
      : [];
  });
  return changes.length > 0
    ? { scoreSnapshotId: current.id, changes }
    : null;
}

function inspectionDate(row: MonitoringViolationRow): string {
  const inspection = Array.isArray(row.inspections)
    ? row.inspections[0] ?? null
    : row.inspections;
  return inspection?.inspection_date ?? "an unknown date";
}

/**
 * Pure planner used by both the production emitter and the isolated unit gate.
 * Only IDs explicitly returned by inserts can produce candidates.
 */
export function planRefreshAlerts({
  clientId,
  newViolationIds,
  newInspectionIds,
  newCrashIds,
  violations,
  inspections,
  crashes,
  oosRateChange,
}: {
  clientId: string;
  newViolationIds: string[];
  newInspectionIds: string[];
  newCrashIds: string[];
  violations: MonitoringViolationRow[];
  inspections: MonitoringInspectionRow[];
  crashes: MonitoringCrashRow[];
  oosRateChange: MonitoringOosRateChange | null;
}): MonitoringAlertCandidate[] {
  const violationIds = new Set(newViolationIds);
  const inspectionIds = new Set(newInspectionIds);
  const crashIds = new Set(newCrashIds);
  const candidates: MonitoringAlertCandidate[] = [];

  for (const violation of violations) {
    if (!violationIds.has(violation.id)) continue;
    const code = violation.violation_code ?? "Unknown code";
    const description = violation.violation_description ?? "No description supplied";
    const isCritical =
      Boolean(violation.oos_violation) || (violation.severity_weight ?? 0) >= 8;
    candidates.push({
      clientId,
      type: "new_violation",
      severity: isCritical ? "critical" : "info",
      title: isCritical ? "High-priority violation detected" : "New violation detected",
      message: `FMCSA added violation ${code} (${description}) from the ${inspectionDate(
        violation
      )} inspection. Review its challengeability in SafeScore.`,
      entityType: "violations",
      entityId: violation.id,
    });
  }

  for (const inspection of inspections) {
    if (!inspectionIds.has(inspection.id)) continue;
    const report = inspection.report_number
      ? `report ${inspection.report_number}`
      : "an unnumbered report";
    const location = inspection.state ?? "an unknown state";
    const level = inspection.level ? `, level ${inspection.level}` : "";
    const violations = inspection.total_violations ?? 0;
    const oosViolations = inspection.oos_violations ?? 0;
    candidates.push({
      clientId,
      type: "new_inspection",
      severity: oosViolations > 0 ? "warning" : "info",
      title: "New inspection detected",
      message: `FMCSA added inspection ${report} from ${inspection.inspection_date ?? "an unknown date"} in ${location}${level} (${violations} violation${violations === 1 ? "" : "s"}, ${oosViolations} OOS).`,
      entityType: "inspections",
      entityId: inspection.id,
    });
  }

  for (const crash of crashes) {
    if (!crashIds.has(crash.id)) continue;
    const report = crash.report_number ? `report ${crash.report_number}` : "an unnumbered report";
    const place = [crash.city, crash.state].filter(Boolean).join(", ") || "an unknown location";
    candidates.push({
      clientId,
      type: "new_crash",
      severity: "critical",
      title: "New crash detected",
      message: `FMCSA added crash ${report} from ${crash.crash_date ?? "an unknown date"} in ${place} (${crash.fatalities ?? 0} fatalities, ${crash.injuries ?? 0} injuries${crash.tow_away ? ", tow-away" : ""}).`,
      entityType: "crashes",
      entityId: crash.id,
    });
  }

  if (oosRateChange) {
    const increased = oosRateChange.changes.some(
      (change) => change.current > change.previous
    );
    candidates.push({
      clientId,
      type: "oos_change",
      severity: increased ? "warning" : "info",
      title: increased ? "FMCSA OOS rate increased" : "FMCSA OOS rate changed",
      message: `FMCSA OOS rate change: ${oosRateChange.changes
        .map(
          (change) =>
            `${change.label} from ${change.previous}% to ${change.current}%`
        )
        .join("; ")}.`,
      entityType: "score_snapshots",
      entityId: oosRateChange.scoreSnapshotId,
    });
  }

  return candidates;
}
