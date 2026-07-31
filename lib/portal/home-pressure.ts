import {
  computeBurdenFromRows,
  timeWeightFor,
  type ViolationRow,
} from "@/lib/analysis/basic-measure";
import { mapViolationToFamily } from "@/lib/playbooks/families";

export type PortalHomePressureViolation = {
  id: string;
  code: string;
  description: string;
  inspectionDate: string;
  weightedPoints: number;
};

export type PortalHomePressureDetail = {
  basicCategory: string;
  topViolations: PortalHomePressureViolation[];
  hasCoachingPlan: boolean;
};

/**
 * Groups one canonical violation result set into BASIC details. The shared
 * burden calculator remains the sole source for time-window and point math.
 */
export function buildPortalHomePressureDetails(
  rows: ViolationRow[],
  options: {
    asOf: Date;
    presentPlaybookFamilies?: ReadonlySet<string>;
  }
): PortalHomePressureDetail[] {
  const rowsByBasic = new Map<string, ViolationRow[]>();

  for (const row of rows) {
    if (!row.basicCategory) continue;
    const grouped = rowsByBasic.get(row.basicCategory) ?? [];
    grouped.push(row);
    rowsByBasic.set(row.basicCategory, grouped);
  }

  return [...rowsByBasic.entries()]
    .map(([basicCategory, basicRows]) => {
      const burden = computeBurdenFromRows(basicRows, options.asOf);
      const hasCoachingPlan = basicRows.some(
        (row) =>
          row.severityWeight != null &&
          timeWeightFor(row.inspectionDate, options.asOf) > 0 &&
          (options.presentPlaybookFamilies?.has(
            mapViolationToFamily(row.violationCode).familyKey
          ) ?? false)
      );

      return {
        basicCategory,
        topViolations: burden.topViolations
          .slice(0, 3)
          .flatMap((violation) =>
            violation.inspectionDate
              ? [
                  {
                    id: violation.id,
                    code: violation.violationCode,
                    description:
                      violation.violationDescription?.trim() ||
                      "FMCSA did not provide a description.",
                    inspectionDate: violation.inspectionDate,
                    weightedPoints: violation.points,
                  },
                ]
              : []
          ),
        hasCoachingPlan,
      } satisfies PortalHomePressureDetail;
    })
    .sort((left, right) =>
      left.basicCategory.localeCompare(right.basicCategory)
    );
}
