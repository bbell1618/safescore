export type AlertSeverity = "info" | "warning" | "critical";

export type MonitoringAlertCandidate = {
  clientId: string;
  type: "new_violation" | "new_crash";
  severity: AlertSeverity;
  title: string;
  message: string;
  entityType: "violations" | "crashes";
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
  newCrashIds,
  violations,
  crashes,
}: {
  clientId: string;
  newViolationIds: string[];
  newCrashIds: string[];
  violations: MonitoringViolationRow[];
  crashes: MonitoringCrashRow[];
}): MonitoringAlertCandidate[] {
  const violationIds = new Set(newViolationIds);
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

  return candidates;
}
