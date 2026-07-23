import type { ChallengeTier } from "@/lib/analysis/challengeability-v2";

export const CURATED_PLAYBOOK_FAMILY_KEYS = [
  "tires_wheels",
  "lighting_electrical",
  "log_integrity",
  "brakes_air",
  "eld_hygiene",
  "driver_behavior",
  "emergency_cab",
  "conspicuity_body",
  "steering_suspension",
  "hours_limits",
  "cargo_securement",
  "driver_qualification",
] as const;

export type CuratedPlaybookFamilyKey =
  (typeof CURATED_PLAYBOOK_FAMILY_KEYS)[number];

export type PlaybookFamilyKey =
  | CuratedPlaybookFamilyKey
  | "general_safety";

export type PlaybookOwnerModuleKey = "A1" | "A2" | "A3" | "A4";

export interface PlaybookOwnerModule {
  key: PlaybookOwnerModuleKey;
  title: string;
  installment: string;
  content: string;
  deliverables: string[];
}

export interface PlaybookFamilyDefinition {
  key: PlaybookFamilyKey;
  code: string;
  name: string;
  priority: number;
  riskContext: string;
  program: string[];
  workingWhen: string[];
  installments: string[];
}

export interface PlaybookViolationInput {
  id: string;
  violation_code: string;
  violation_description: string | null;
  basic_category: string | null;
  severity_weight: number | null;
  oos_violation: boolean;
  citation_number?: string | null;
  citation_result?: string | null;
  convicted?: boolean | null;
  challenge_reason?: string | null;
  challenge_tier?: ChallengeTier | null;
  inspection_date: string | null;
}

export interface PlaybookViolationFact {
  id: string;
  code: string;
  description: string | null;
  basicCategory: string | null;
  severityWeight: number;
  oos: boolean;
  inspectionDate: string;
  timeWeight: 1 | 2 | 3;
  weightedPoints: number;
}

export interface LaneCFamilyGroup {
  familyKey: PlaybookFamilyKey;
  familyCode: string;
  familyName: string;
  familyPriority: number;
  count: number;
  points: number;
  inflowCount: number;
  inflowRatePerMonth: number;
  trailingWindowDays: number;
  latestViolationDate: string | null;
  oosCount: number;
  averageSeverity: number;
  priorityScore: number;
  violations: PlaybookViolationFact[];
}

export interface PlaybookNarrativeSlot {
  familyKey: PlaybookFamilyKey;
  introduction: string;
  coachingLanguage: string;
}

export interface PlaybookNarrative {
  familyNarratives: PlaybookNarrativeSlot[];
}

export interface PlaybookFamilyProgram extends LaneCFamilyGroup {
  riskContext: string;
  program: string[];
  workingWhen: string[];
  installments: string[];
  introduction: string;
  coachingLanguage: string;
}

export interface PlaybookInstallment {
  month: number;
  title: string;
  ownerModuleKeys: PlaybookOwnerModuleKey[];
  familyKeys: PlaybookFamilyKey[];
  objective: string;
  deliverables: string[];
}

export interface PlaybookSourceSnapshot {
  generatedAt: string;
  asOfDate: string;
  canonicalInspectionSource: "authenticated" | "public";
  canonicalInspectionCount: number;
  sourceViolationCount: number;
  laneCViolationCount: number;
  laneCWeightedPoints: number;
  trailingWindowDays: number;
  unmappedCodes: string[];
}

export interface PlaybookGenerationData {
  templateVersion: string;
  carrier: {
    id: string;
    name: string;
    dotNumber: string;
  };
  ownerCurriculum: PlaybookOwnerModule[];
  familyGroups: LaneCFamilyGroup[];
  installmentCalendar: PlaybookInstallment[];
  sourceSnapshot: PlaybookSourceSnapshot;
}

export type PlaybookGenerationAttemptEvent = {
  attempt: number;
  status: "started" | "succeeded" | "failed";
  reason: string;
  rawOutput?: string;
  validationIssues?: string[];
};
