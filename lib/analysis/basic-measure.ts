/**
 * Self-computed per-BASIC weighted measure from corrected violation data.
 * Pure + client-safe. Mirrors FMCSA SMS time-weighted additive math:
 *   points = time_weight * (severity_weight + 2-if-OOS)
 * Canonical computation runs in SQL (see basic-measure-server.ts); this module
 * holds the shared types, display labels, and a pure aggregator for in-memory
 * rows / unit tests. SQL and TS must agree for the same as-of date.
 */

export const BASIC_LABELS: Record<string, string> = {
  unsafe_driving: "Unsafe Driving",
  hos_compliance: "Hours-of-Service Compliance",
  driver_fitness: "Driver Fitness",
  controlled_substance: "Controlled Substances/Alcohol",
  vehicle_maintenance: "Vehicle Maintenance",
  hazmat_compliance: "Hazardous Materials Compliance",
  crash_indicator: "Crash Indicator",
};

export interface ViolationRow {
  id: string;
  violationCode: string;
  violationDescription: string | null;
  basicCategory: string | null;
  severityWeight: number | null;
  oosViolation: boolean;
  inspectionDate: string | null;
  state?: string | null;
}

export interface ViolationPoints extends ViolationRow {
  timeWeight: 0 | 1 | 2 | 3;
  points: number;
}

export interface BasicBurden {
  basicCategory: string;
  label: string;
  weightedPoints: number;
  violationCount: number;
}

export interface BurdenResult {
  perBasic: BasicBurden[];
  totalPoints: number;
  topViolations: ViolationPoints[];
  asOf: string;
}

/** Calendar-month cutoff, UTC, mirroring Postgres `current_date - interval 'n months'`. */
function monthsAgo(asOf: Date, n: number): Date {
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - n, asOf.getUTCDate()));
}

export function timeWeightFor(inspectionDate: string | null, asOf: Date): 0 | 1 | 2 | 3 {
  if (!inspectionDate) return 0;
  const d = new Date(inspectionDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 0;
  if (d >= monthsAgo(asOf, 6)) return 3;
  if (d >= monthsAgo(asOf, 12)) return 2;
  if (d >= monthsAgo(asOf, 24)) return 1;
  return 0;
}

export function computeBurdenFromRows(rows: ViolationRow[], asOf: Date = new Date()): BurdenResult {
  const scored: ViolationPoints[] = [];
  for (const r of rows) {
    const tw = timeWeightFor(r.inspectionDate, asOf);
    const points =
      r.severityWeight != null && tw > 0
        ? tw * (r.severityWeight + (r.oosViolation ? 2 : 0))
        : 0;
    if (r.severityWeight != null && tw > 0 && r.basicCategory) {
      scored.push({ ...r, timeWeight: tw, points });
    }
  }

  const byBasic = new Map<string, { pts: number; n: number }>();
  for (const v of scored) {
    const cur = byBasic.get(v.basicCategory!) ?? { pts: 0, n: 0 };
    cur.pts += v.points;
    cur.n += 1;
    byBasic.set(v.basicCategory!, cur);
  }

  const perBasic: BasicBurden[] = [...byBasic.entries()]
    .map(([basicCategory, { pts, n }]) => ({
      basicCategory,
      label: BASIC_LABELS[basicCategory] ?? basicCategory,
      weightedPoints: pts,
      violationCount: n,
    }))
    .sort((a, b) => b.weightedPoints - a.weightedPoints);

  const totalPoints = perBasic.reduce((s, b) => s + b.weightedPoints, 0);

  const topViolations = [...scored]
    .sort((a, b) => b.points - a.points || (b.inspectionDate ?? "").localeCompare(a.inspectionDate ?? ""))
    .slice(0, 10);

  return { perBasic, totalPoints, topViolations, asOf: asOf.toISOString().slice(0, 10) };
}
