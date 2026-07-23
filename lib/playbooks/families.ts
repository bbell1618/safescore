import { timeWeightFor } from "@/lib/analysis/basic-measure";
import { scoreChallenge } from "@/lib/analysis/challengeability-v2";
import { FAMILY_DEFINITIONS } from "@/lib/playbooks/templates";
import type {
  LaneCFamilyGroup,
  PlaybookFamilyKey,
  PlaybookViolationFact,
  PlaybookViolationInput,
} from "@/lib/playbooks/types";

export type ViolationFamilyPrefix = {
  prefix: string;
  familyKey: Exclude<PlaybookFamilyKey, "general_safety">;
  basis: string;
};

/**
 * Curated from the locked U3 artifact and the FMCSA codes currently present
 * in Nationwide's canonical inspection layer. Matching is performed against
 * an uppercase alphanumeric code and always chooses the longest prefix.
 */
export const FAMILY_PREFIX_MAP: readonly ViolationFamilyPrefix[] = [
  {
    prefix: "39111B2Q",
    familyKey: "driver_qualification",
    basis: "English-language proficiency / driver qualification",
  },
  {
    prefix: "3922SLLMF",
    familyKey: "conspicuity_body",
    basis: "Mud flap / body equipment",
  },
  {
    prefix: "3922SLSNC",
    familyKey: "conspicuity_body",
    basis: "Seasonal snow-chain equipment",
  },
  {
    prefix: "39216",
    familyKey: "driver_behavior",
    basis: "Seat-belt behavior",
  },
  {
    prefix: "39222",
    familyKey: "driver_behavior",
    basis: "Driver use of warning flashers",
  },
  {
    prefix: "3922",
    familyKey: "driver_behavior",
    basis: "Traffic-control, speeding, phone, lane, and other state/local driving behavior",
  },
  {
    prefix: "3929A2C",
    familyKey: "cargo_securement",
    basis: "Cargo component and dunnage securement",
  },
  {
    prefix: "39311A1LCL",
    familyKey: "lighting_electrical",
    basis: "Clearance lamp",
  },
  {
    prefix: "39311A1C",
    familyKey: "conspicuity_body",
    basis: "Truck-tractor conspicuity sheeting",
  },
  {
    prefix: "39313C3C",
    familyKey: "conspicuity_body",
    basis: "Trailer conspicuity sheeting",
  },
  {
    prefix: "393207",
    familyKey: "steering_suspension",
    basis: "Suspension",
  },
  {
    prefix: "393209",
    familyKey: "steering_suspension",
    basis: "Steering",
  },
  {
    prefix: "39328",
    familyKey: "lighting_electrical",
    basis: "Vehicle wiring",
  },
  {
    prefix: "39345",
    familyKey: "brakes_air",
    basis: "Air/vacuum brake hoses and leaks",
  },
  {
    prefix: "39355",
    familyKey: "brakes_air",
    basis: "ABS warning systems",
  },
  {
    prefix: "39365C",
    familyKey: "conspicuity_body",
    basis: "Body-mounted fuel-tank securement",
  },
  {
    prefix: "39375",
    familyKey: "tires_wheels",
    basis: "Tire condition, inflation, and tread",
  },
  {
    prefix: "39395",
    familyKey: "emergency_cab",
    basis: "Fire extinguishers and warning devices",
  },
  {
    prefix: "39319",
    familyKey: "lighting_electrical",
    basis: "Hazard-warning lamps",
  },
  {
    prefix: "3939",
    familyKey: "lighting_electrical",
    basis: "Required lamps and turn signals",
  },
  {
    prefix: "39522",
    familyKey: "eld_hygiene",
    basis: "ELD mounting",
  },
  {
    prefix: "39524",
    familyKey: "eld_hygiene",
    basis: "ELD form, transfer, and shipping-document data",
  },
  {
    prefix: "39530",
    familyKey: "eld_hygiene",
    basis: "ELD review and certification",
  },
  {
    prefix: "39532",
    familyKey: "eld_hygiene",
    basis: "ELD unassigned-driving-time review",
  },
  {
    prefix: "3958E",
    familyKey: "log_integrity",
    basis: "False record of duty status",
  },
  {
    prefix: "3958A",
    familyKey: "eld_hygiene",
    basis: "Log form and manner",
  },
  {
    prefix: "3958",
    familyKey: "eld_hygiene",
    basis: "General record-of-duty-status hygiene",
  },
  {
    prefix: "3953",
    familyKey: "hours_limits",
    basis: "Property-carrier driving-hour limits",
  },
  {
    prefix: "3965B",
    familyKey: "tires_wheels",
    basis: "Hub and wheel-seal condition",
  },
] as const;

const PREFIXES_LONGEST_FIRST = [...FAMILY_PREFIX_MAP].sort(
  (left, right) =>
    right.prefix.length - left.prefix.length ||
    left.prefix.localeCompare(right.prefix)
);

export function normalizeViolationCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function mapViolationToFamily(code: string): {
  familyKey: PlaybookFamilyKey;
  matchedPrefix: string | null;
  fallback: boolean;
} {
  const normalized = normalizeViolationCode(code);
  const match = PREFIXES_LONGEST_FIRST.find(({ prefix }) =>
    normalized.startsWith(prefix)
  );
  return match
    ? {
        familyKey: match.familyKey,
        matchedPrefix: match.prefix,
        fallback: false,
      }
    : {
        familyKey: "general_safety",
        matchedPrefix: null,
        fallback: true,
      };
}

function round(value: number, digits = 2): number {
  const power = 10 ** digits;
  return Math.round((value + Number.EPSILON) * power) / power;
}

function utcDateOnly(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

function validInspectionDate(value: string | null): value is string {
  if (!value) return false;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

export function buildLaneCFamilyGroups(
  violations: PlaybookViolationInput[],
  options: {
    asOf?: Date;
    trailingWindowDays?: number;
  } = {}
): LaneCFamilyGroup[] {
  const asOf = utcDateOnly(options.asOf ?? new Date());
  const trailingWindowDays = options.trailingWindowDays ?? 90;
  if (
    !Number.isInteger(trailingWindowDays) ||
    trailingWindowDays < 1 ||
    trailingWindowDays > 730
  ) {
    throw new Error("Playbook trailingWindowDays must be an integer from 1 to 730.");
  }
  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - trailingWindowDays);

  const factsByFamily = new Map<PlaybookFamilyKey, PlaybookViolationFact[]>();

  for (const violation of violations) {
    const timeWeight = timeWeightFor(violation.inspection_date, asOf);
    if (
      !validInspectionDate(violation.inspection_date) ||
      violation.severity_weight == null ||
      violation.basic_category == null ||
      timeWeight === 0
    ) {
      continue;
    }

    const challenge = scoreChallenge({
      violationCode: violation.violation_code,
      basicCategory: violation.basic_category,
      severityWeight: violation.severity_weight,
      timeWeight,
      challengeReason: violation.challenge_reason ?? null,
      oosViolation: violation.oos_violation,
      convicted: violation.convicted ?? null,
      citationNumber: violation.citation_number ?? null,
      citationResult: violation.citation_result ?? null,
      challengeTier: violation.challenge_tier ?? null,
      basicPercentile: null,
    });
    if (
      challenge.label === "strong" ||
      challenge.label === "moderate" ||
      challenge.label === "investigate"
    ) {
      continue;
    }

    const familyKey = mapViolationToFamily(violation.violation_code).familyKey;
    const weightedPoints =
      timeWeight *
      (violation.severity_weight + (violation.oos_violation ? 2 : 0));
    const facts = factsByFamily.get(familyKey) ?? [];
    facts.push({
      id: violation.id,
      code: violation.violation_code,
      description: violation.violation_description,
      basicCategory: violation.basic_category,
      severityWeight: violation.severity_weight,
      oos: violation.oos_violation,
      inspectionDate: violation.inspection_date,
      timeWeight,
      weightedPoints,
    });
    factsByFamily.set(familyKey, facts);
  }

  return [...factsByFamily.entries()]
    .map(([familyKey, unsortedFacts]): LaneCFamilyGroup => {
      const definition = FAMILY_DEFINITIONS[familyKey];
      const violationsForFamily = [...unsortedFacts].sort(
        (left, right) =>
          right.inspectionDate.localeCompare(left.inspectionDate) ||
          right.weightedPoints - left.weightedPoints ||
          left.code.localeCompare(right.code) ||
          left.id.localeCompare(right.id)
      );
      const count = violationsForFamily.length;
      const points = violationsForFamily.reduce(
        (total, fact) => total + fact.weightedPoints,
        0
      );
      const oosCount = violationsForFamily.filter((fact) => fact.oos).length;
      const averageSeverity = round(
        violationsForFamily.reduce(
          (total, fact) => total + fact.severityWeight,
          0
        ) / count
      );
      const inflowCount = violationsForFamily.filter(
        (fact) =>
          new Date(`${fact.inspectionDate}T00:00:00Z`).getTime() >=
          cutoff.getTime()
      ).length;
      const inflowRatePerMonth = round(
        inflowCount / (trailingWindowDays / 30)
      );
      const oosMultiplier = 1 + oosCount / count;

      return {
        familyKey,
        familyCode: definition.code,
        familyName: definition.name,
        familyPriority: definition.priority,
        count,
        points,
        inflowCount,
        inflowRatePerMonth,
        trailingWindowDays,
        latestViolationDate: violationsForFamily[0]?.inspectionDate ?? null,
        oosCount,
        averageSeverity,
        priorityScore: round(
          inflowCount * averageSeverity * oosMultiplier
        ),
        violations: violationsForFamily,
      };
    })
    .sort(
      (left, right) =>
        left.familyPriority - right.familyPriority ||
        right.priorityScore - left.priorityScore ||
        left.familyName.localeCompare(right.familyName)
    );
}
