import {
  FAMILY_DEFINITIONS,
  OWNER_CURRICULUM,
  PLAYBOOK_TEMPLATE_VERSION,
  buildInstallmentCalendar,
} from "@/lib/playbooks/templates";
import type {
  LaneCFamilyGroup,
  PlaybookFamilyKey,
  PlaybookFamilyProgram,
  PlaybookGenerationAttemptEvent,
  PlaybookGenerationData,
  PlaybookInstallment,
  PlaybookNarrative,
  PlaybookNarrativeSlot,
  PlaybookSourceSnapshot,
} from "@/lib/playbooks/types";

export const PLAYBOOK_PLACEHOLDER_PATTERN = /\[[^\]\n]{1,80}\]/g;

type PlaybookTextGenerator = (params: {
  system: string;
  user: string;
  attempt: number;
}) => Promise<string>;

type PlaybookGenerationOptions = {
  onAttempt?: (
    event: PlaybookGenerationAttemptEvent
  ) => Promise<void> | void;
};

export interface PlaybookPrompts {
  system: string;
  user: string;
}

export interface ValidatedPlaybookNarrative {
  narrative: PlaybookNarrative;
  rawOutput: string;
  attempts: number;
}

function cloneOwnerCurriculum() {
  return OWNER_CURRICULUM.map((module) => ({
    ...module,
    deliverables: [...module.deliverables],
  }));
}

export function buildPlaybookGenerationData(params: {
  carrier: PlaybookGenerationData["carrier"];
  familyGroups: LaneCFamilyGroup[];
  sourceSnapshot: PlaybookSourceSnapshot;
}): PlaybookGenerationData {
  if (params.familyGroups.length === 0) {
    throw new Error(
      "No in-window Lane C violations are available for playbook generation."
    );
  }
  const data: PlaybookGenerationData = {
    templateVersion: PLAYBOOK_TEMPLATE_VERSION,
    carrier: params.carrier,
    ownerCurriculum: cloneOwnerCurriculum(),
    familyGroups: params.familyGroups,
    installmentCalendar: buildInstallmentCalendar(params.familyGroups),
    sourceSnapshot: params.sourceSnapshot,
  };
  const issues = validatePlaybookStructure(data);
  if (issues.length > 0) {
    throw new Error(
      `Deterministic playbook structure failed validation: ${issues.join("; ")}`
    );
  }
  return data;
}

export function findPlaybookPlaceholders(content: string): string[] {
  return [...new Set(content.match(PLAYBOOK_PLACEHOLDER_PATTERN) ?? [])];
}

export function findPlaybookPlaceholdersInValue(value: unknown): string[] {
  const matches = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      for (const match of findPlaybookPlaceholders(candidate)) {
        matches.add(match);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const item of Object.values(candidate)) visit(item);
    }
  };
  visit(value);
  return [...matches];
}

function hasPlaceholders(value: unknown): boolean {
  return findPlaybookPlaceholdersInValue(value).length > 0;
}

function duplicateValues<T extends string | number>(values: T[]): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validatePlaybookStructure(
  data: PlaybookGenerationData
): string[] {
  const issues: string[] = [];
  if (data.templateVersion !== PLAYBOOK_TEMPLATE_VERSION) {
    issues.push(`unexpected template version ${data.templateVersion}`);
  }
  const moduleKeys = data.ownerCurriculum.map((module) => module.key);
  if (
    moduleKeys.length !== 4 ||
    moduleKeys.join(",") !== "A1,A2,A3,A4"
  ) {
    issues.push("owner curriculum must contain A1, A2, A3, and A4 in order");
  }
  if (
    data.ownerCurriculum.some(
      (module) =>
        !module.title.trim() ||
        !module.installment.trim() ||
        !module.content.trim() ||
        module.deliverables.length === 0
    )
  ) {
    issues.push("every owner module must contain its deterministic content");
  }

  const familyKeys = data.familyGroups.map((group) => group.familyKey);
  const duplicateFamilies = duplicateValues(familyKeys);
  if (duplicateFamilies.length > 0) {
    issues.push(`duplicate family group(s): ${duplicateFamilies.join(", ")}`);
  }
  for (const group of data.familyGroups) {
    if (!FAMILY_DEFINITIONS[group.familyKey]) {
      issues.push(`unknown family group ${group.familyKey}`);
    }
    if (
      group.count < 1 ||
      group.violations.length !== group.count ||
      group.points < 1
    ) {
      issues.push(`${group.familyKey} has inconsistent live metrics`);
    }
    if (
      group.inflowCount < 0 ||
      group.inflowCount > group.count ||
      group.inflowRatePerMonth < 0
    ) {
      issues.push(`${group.familyKey} has an invalid inflow metric`);
    }
  }

  if (
    data.installmentCalendar.length !== 12 ||
    data.installmentCalendar.some(
      (entry, index) => entry.month !== index + 1
    )
  ) {
    issues.push("installment calendar must contain months 1 through 12 in order");
  }
  const presentFamilies = new Set(familyKeys);
  const unknownCalendarFamilies = new Set<PlaybookFamilyKey>();
  for (const installment of data.installmentCalendar) {
    for (const familyKey of installment.familyKeys) {
      if (!presentFamilies.has(familyKey)) {
        unknownCalendarFamilies.add(familyKey);
      }
    }
  }
  if (unknownCalendarFamilies.size > 0) {
    issues.push(
      `calendar references absent family group(s): ${[
        ...unknownCalendarFamilies,
      ].join(", ")}`
    );
  }
  if (hasPlaceholders(data)) {
    issues.push("deterministic structure contains a forbidden bracketed token");
  }
  return issues;
}

function narrativeFactPayload(data: PlaybookGenerationData) {
  return {
    carrier: data.carrier,
    generatedAt: data.sourceSnapshot.generatedAt,
    asOfDate: data.sourceSnapshot.asOfDate,
    trailingWindowDays: data.sourceSnapshot.trailingWindowDays,
    families: data.familyGroups.map((group) => ({
      familyKey: group.familyKey,
      familyName: group.familyName,
      count: group.count,
      currentWeightedPoints: group.points,
      inflowCount: group.inflowCount,
      inflowRatePerMonth: group.inflowRatePerMonth,
      latestViolationDate: group.latestViolationDate,
      oosCount: group.oosCount,
      averageSeverity: group.averageSeverity,
      priorityScore: group.priorityScore,
      curatedRiskContext: FAMILY_DEFINITIONS[group.familyKey].riskContext,
      violations: group.violations.map((violation) => ({
        code: violation.code,
        description: violation.description,
        inspectionDate: violation.inspectionDate,
        severityWeight: violation.severityWeight,
        oos: violation.oos,
        currentWeightedPoints: violation.weightedPoints,
      })),
    })),
  };
}

export function buildPlaybookPrompts(
  data: PlaybookGenerationData
): PlaybookPrompts {
  const familyKeys = data.familyGroups.map((group) => group.familyKey);
  return {
    system:
      "You write only bounded narrative glue for a carrier safety playbook. The server owns every module, program step, metric, and installment. Use only facts in the supplied JSON. Do not invent drivers, causes, documents, outcomes, dates, legal claims, promises, or measurements. Do not claim passive score decay as work performed. Use direct, candid coaching language in the Golden Era SafeScore voice. Never emit square-bracketed text or a placeholder. Return strict JSON only, with no Markdown fence or commentary.",
    user: `Write exactly two short narrative slots for each listed family and no other content.

Required JSON shape:
{
  "familyNarratives": [
    {
      "familyKey": "one exact key from the required list",
      "introduction": "One or two sentences that describe this family's live pattern from the supplied facts.",
      "coachingLanguage": "One or two sentences that introduce the deterministic program without adding facts."
    }
  ]
}

Rules:
- Return exactly one object for each required family key and no extra family.
- Required family keys, in order: ${familyKeys.join(", ")}
- Keep each field under 900 characters.
- Use "current weighted points" for the local point calculation; never call them SMS points.
- If the facts do not support a detail, omit it.
- Do not copy the program steps into the narrative; the server renders them separately.
- No square brackets and no fill-in patterns.

Structured facts:
${JSON.stringify(narrativeFactPayload(data), null, 2)}`,
  };
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function parseNarrative(raw: string): {
  narrative: PlaybookNarrative | null;
  parseIssue: string | null;
} {
  try {
    const value = JSON.parse(stripJsonFence(raw)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        narrative: null,
        parseIssue: "response root must be a JSON object",
      };
    }
    const object = value as { familyNarratives?: unknown };
    if (!Array.isArray(object.familyNarratives)) {
      return {
        narrative: null,
        parseIssue: "familyNarratives must be an array",
      };
    }
    return {
      narrative: {
        familyNarratives:
          object.familyNarratives as PlaybookNarrativeSlot[],
      },
      parseIssue: null,
    };
  } catch (error) {
    return {
      narrative: null,
      parseIssue:
        error instanceof Error
          ? `response was not valid JSON: ${error.message}`
          : "response was not valid JSON",
    };
  }
}

export function validatePlaybookNarrative(
  narrative: PlaybookNarrative,
  data: PlaybookGenerationData
): string[] {
  const issues: string[] = [];
  const requiredKeys = data.familyGroups.map((group) => group.familyKey);
  const slots = narrative.familyNarratives;

  if (slots.length !== requiredKeys.length) {
    issues.push(
      `expected ${requiredKeys.length} family narrative(s), received ${slots.length}`
    );
  }

  const returnedKeys: PlaybookFamilyKey[] = [];
  for (const [index, slot] of slots.entries()) {
    if (!slot || typeof slot !== "object") {
      issues.push(`family narrative ${index + 1} must be an object`);
      continue;
    }
    if (typeof slot.familyKey !== "string") {
      issues.push(`family narrative ${index + 1} is missing familyKey`);
      continue;
    }
    returnedKeys.push(slot.familyKey);
    if (!requiredKeys.includes(slot.familyKey)) {
      issues.push(`unexpected family key ${slot.familyKey}`);
    }
    for (const field of ["introduction", "coachingLanguage"] as const) {
      const value = slot[field];
      if (typeof value !== "string" || !value.trim()) {
        issues.push(`${slot.familyKey}.${field} must be non-empty text`);
      } else if (value.length > 900) {
        issues.push(`${slot.familyKey}.${field} exceeds 900 characters`);
      }
    }
  }

  const duplicates = duplicateValues(returnedKeys);
  if (duplicates.length > 0) {
    issues.push(`duplicate family narrative(s): ${duplicates.join(", ")}`);
  }
  for (const key of requiredKeys) {
    if (!returnedKeys.includes(key)) {
      issues.push(`missing family narrative ${key}`);
    }
  }
  if (
    returnedKeys.length === requiredKeys.length &&
    returnedKeys.some((key, index) => key !== requiredKeys[index])
  ) {
    issues.push("family narratives are not in the required order");
  }
  const placeholders = findPlaybookPlaceholdersInValue(narrative);
  if (placeholders.length > 0) {
    issues.push(`forbidden bracketed token(s): ${placeholders.join(", ")}`);
  }
  if (/\bSMS points?\b/i.test(JSON.stringify(narrative))) {
    issues.push("narrative mislabels current weighted points as SMS points");
  }
  return issues;
}

export async function generateValidatedPlaybookNarrative(
  prompts: PlaybookPrompts,
  data: PlaybookGenerationData,
  generateText: PlaybookTextGenerator,
  options: PlaybookGenerationOptions = {}
): Promise<ValidatedPlaybookNarrative> {
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const correctiveNote =
      attempt === 1
        ? ""
        : `\n\nCorrective system note: The previous JSON was rejected for these reasons: ${lastIssues.join(
            "; "
          )}. Return the entire corrected JSON object. Remove every bracketed token and correct every listed issue.`;
    await options.onAttempt?.({
      attempt,
      status: "started",
      reason:
        attempt === 1
          ? "Initial generation attempt."
          : `Retrying after validation failed: ${lastIssues.join("; ")}`,
    });

    let rawOutput: string;
    try {
      rawOutput = await generateText({
        system: `${prompts.system}${correctiveNote}`,
        user: prompts.user,
        attempt,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.message
          ? error.message
          : "The text provider failed without an error message.";
      await options.onAttempt?.({
        attempt,
        status: "failed",
        reason,
      });
      throw error;
    }

    const parsed = parseNarrative(rawOutput);
    const issues = parsed.narrative
      ? validatePlaybookNarrative(parsed.narrative, data)
      : [parsed.parseIssue ?? "response could not be parsed"];
    if (issues.length === 0 && parsed.narrative) {
      await options.onAttempt?.({
        attempt,
        status: "succeeded",
        reason: "Generated narrative passed validation.",
        rawOutput,
      });
      return {
        narrative: parsed.narrative,
        rawOutput,
        attempts: attempt,
      };
    }

    await options.onAttempt?.({
      attempt,
      status: "failed",
      reason: `Validation failed: ${issues.join("; ")}`,
      rawOutput,
      validationIssues: issues,
    });
    lastIssues = issues;
  }

  throw new Error(
    `Playbook generation failed validation after 3 attempts: ${lastIssues.join(
      "; "
    )}`
  );
}

export function mergeFamilyPrograms(
  data: PlaybookGenerationData,
  narrative: PlaybookNarrative
): PlaybookFamilyProgram[] {
  const narratives = new Map(
    narrative.familyNarratives.map((slot) => [slot.familyKey, slot])
  );
  return data.familyGroups.map((group) => {
    const definition = FAMILY_DEFINITIONS[group.familyKey];
    const slot = narratives.get(group.familyKey);
    if (!slot) {
      throw new Error(
        `Validated playbook narrative is missing ${group.familyKey}.`
      );
    }
    return {
      ...group,
      riskContext: definition.riskContext,
      program: [...definition.program],
      workingWhen: [...definition.workingWhen],
      installments: [...definition.installments],
      introduction: slot.introduction.trim(),
      coachingLanguage: slot.coachingLanguage.trim(),
    };
  });
}

export function cloneInstallmentCalendar(
  calendar: PlaybookInstallment[]
): PlaybookInstallment[] {
  return calendar.map((entry) => ({
    ...entry,
    ownerModuleKeys: [...entry.ownerModuleKeys],
    familyKeys: [...entry.familyKeys],
    deliverables: [...entry.deliverables],
  }));
}
