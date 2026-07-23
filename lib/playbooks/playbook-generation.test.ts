import assert from "node:assert/strict";
import test from "node:test";
import {
  FAMILY_PREFIX_MAP,
  buildLaneCFamilyGroups,
  mapViolationToFamily,
} from "@/lib/playbooks/families";
import {
  buildPlaybookGenerationData,
  buildPlaybookPrompts,
  generateValidatedPlaybookNarrative,
  mergeFamilyPrograms,
} from "@/lib/playbooks/playbook-generation";
import {
  FAMILY_DEFINITIONS,
  OWNER_CURRICULUM,
  PLAYBOOK_TEMPLATE_VERSION,
} from "@/lib/playbooks/templates";
import {
  CURATED_PLAYBOOK_FAMILY_KEYS,
  type PlaybookFamilyKey,
  type PlaybookGenerationAttemptEvent,
  type PlaybookViolationInput,
} from "@/lib/playbooks/types";

const NATIONWIDE_CODE_EXPECTATIONS: Record<string, PlaybookFamilyKey> = {
  "39111B2Q": "driver_qualification",
  "39216AD": "driver_behavior",
  "39222AD": "driver_behavior",
  "3922C": "driver_behavior",
  "3929A2C": "cargo_securement",
  "39311A1CSLRR": "conspicuity_body",
  "39311A1LCL": "lighting_electrical",
  "39313C3CSURR": "conspicuity_body",
  "39319": "lighting_electrical",
  "393207FSLAS": "steering_suspension",
  "393209DSTYCIS": "steering_suspension",
  "39328WS6": "lighting_electrical",
  "39345B2B": "brakes_air",
  "39345B2BAIR": "brakes_air",
  "39345B2BHTD": "brakes_air",
  "39345DB": "brakes_air",
  "39345DBAAL": "brakes_air",
  "39355D1B": "brakes_air",
  "39355D3B": "brakes_air",
  "39355EB": "brakes_air",
  "39365C": "conspicuity_body",
  "39375A1TEPBM": "tires_wheels",
  "39375A3TAOL": "tires_wheels",
  "39375A3TAOLTIS": "tires_wheels",
  "39375C": "tires_wheels",
  "39375CTAOTDLT232": "tires_wheels",
  "39395A1": "emergency_cab",
  "39395A4EEUS": "emergency_cab",
  "39395F": "emergency_cab",
  "3939ALCL": "lighting_electrical",
  "3939ALFTSI": "lighting_electrical",
  "3939ALHLI": "lighting_electrical",
  "3939ALHWS": "lighting_electrical",
  "3939ALSLI": "lighting_electrical",
  "3939ALSML": "lighting_electrical",
  "3939TS": "lighting_electrical",
  "39522GELDMFV": "eld_hygiene",
  "39524": "eld_hygiene",
  "39524C2III": "eld_hygiene",
  "39524C2IIIELDSDN": "eld_hygiene",
  "39524DELDPT": "eld_hygiene",
  "39530B1ELDDFR": "eld_hygiene",
  "39530B2ELDDFC24": "eld_hygiene",
  "39532BELDDFR": "eld_hygiene",
  "3953A3IHOSPDIT": "hours_limits",
  "3958A": "eld_hygiene",
  "3958EHOSPD": "log_integrity",
  "39617CPI": "general_safety",
  "3965BHWSL": "tires_wheels",
};

function violation(
  values: Partial<PlaybookViolationInput> & {
    id: string;
    violation_code: string;
    inspection_date: string;
  }
): PlaybookViolationInput {
  return {
    violation_description: "Grounded test description",
    basic_category: "vehicle_maintenance",
    severity_weight: 4,
    oos_violation: false,
    citation_number: null,
    citation_result: null,
    convicted: true,
    challenge_reason: "Operational control",
    challenge_tier: "operational",
    ...values,
  };
}

test("the curated family library contains the 12 locked families", () => {
  assert.equal(CURATED_PLAYBOOK_FAMILY_KEYS.length, 12);
  assert.deepEqual(
    Object.keys(FAMILY_DEFINITIONS).filter((key) => key !== "general_safety"),
    [...CURATED_PLAYBOOK_FAMILY_KEYS]
  );
  assert.deepEqual(
    OWNER_CURRICULUM.map((module) => module.key),
    ["A1", "A2", "A3", "A4"]
  );
  assert.equal(PLAYBOOK_TEMPLATE_VERSION, "u7-golden-artifact-2026-07-22");
});

test("Nationwide's live Lane C codes map deterministically with one explicit fallback", () => {
  for (const [code, expectedFamily] of Object.entries(
    NATIONWIDE_CODE_EXPECTATIONS
  )) {
    assert.equal(
      mapViolationToFamily(code).familyKey,
      expectedFamily,
      `${code} should map to ${expectedFamily}`
    );
  }
  assert.equal(mapViolationToFamily("39617CPI").fallback, true);
  assert.equal(
    Object.entries(NATIONWIDE_CODE_EXPECTATIONS).filter(
      ([, family]) => family === "general_safety"
    ).length,
    1
  );
  assert.ok(FAMILY_PREFIX_MAP.length >= 29);
});

test("longest-prefix collisions do not misclassify emergency or ELD codes", () => {
  assert.equal(mapViolationToFamily("39395F").familyKey, "emergency_cab");
  assert.equal(
    mapViolationToFamily("3939ALHLI").familyKey,
    "lighting_electrical"
  );
  assert.equal(mapViolationToFamily("39530B1").familyKey, "eld_hygiene");
  assert.equal(mapViolationToFamily("39532BELDDFR").familyKey, "eld_hygiene");
  assert.equal(mapViolationToFamily("3953A3IHOSPDIT").familyKey, "hours_limits");
  assert.equal(mapViolationToFamily("3958EHOSPD").familyKey, "log_integrity");
  assert.equal(mapViolationToFamily("3958A").familyKey, "eld_hygiene");
});

test("family groups use current weighted points, Lane C only, and a rolling 90-day rate", () => {
  const groups = buildLaneCFamilyGroups(
    [
      violation({
        id: "recent",
        violation_code: "39375A3TAOLTIS",
        inspection_date: "2026-06-19",
        severity_weight: 8,
        oos_violation: true,
      }),
      violation({
        id: "older",
        violation_code: "39375C",
        inspection_date: "2026-03-20",
        severity_weight: 4,
      }),
      violation({
        id: "fallback",
        violation_code: "39617CPI",
        inspection_date: "2026-03-20",
      }),
      violation({
        id: "investigate",
        violation_code: "3922SLLS4",
        inspection_date: "2026-02-24",
        basic_category: "unsafe_driving",
        challenge_tier: "investigate",
      }),
    ],
    { asOf: new Date("2026-07-23T12:00:00Z"), trailingWindowDays: 90 }
  );
  const tires = groups.find((group) => group.familyKey === "tires_wheels");
  assert.ok(tires);
  assert.equal(tires.count, 2);
  assert.equal(tires.points, 42);
  assert.equal(tires.inflowCount, 1);
  assert.equal(tires.inflowRatePerMonth, 0.33);
  assert.equal(tires.latestViolationDate, "2026-06-19");
  assert.ok(tires.priorityScore > 0);
  assert.equal(groups.some((group) => group.familyKey === "driver_behavior"), false);
  assert.equal(
    groups.find((group) => group.familyKey === "general_safety")?.count,
    1
  );
  assert.equal(
    groups.find((group) => group.familyKey === "general_safety")?.priorityScore,
    0
  );
});

test("family points use calendar-day boundaries at exactly 6, 12, and 24 months", () => {
  const groups = buildLaneCFamilyGroups(
    [
      violation({
        id: "six-month-boundary",
        violation_code: "39375C",
        inspection_date: "2026-01-23",
        severity_weight: 2,
      }),
      violation({
        id: "twelve-month-boundary",
        violation_code: "39375C",
        inspection_date: "2025-07-23",
        severity_weight: 2,
      }),
      violation({
        id: "twenty-four-month-boundary",
        violation_code: "39375C",
        inspection_date: "2024-07-23",
        severity_weight: 2,
      }),
    ],
    {
      asOf: new Date("2026-07-23T23:59:59Z"),
      trailingWindowDays: 90,
    }
  );
  assert.deepEqual(
    groups[0]?.violations.map((fact) => ({
      id: fact.id,
      timeWeight: fact.timeWeight,
      points: fact.weightedPoints,
    })),
    [
      { id: "six-month-boundary", timeWeight: 3, points: 6 },
      { id: "twelve-month-boundary", timeWeight: 2, points: 4 },
      { id: "twenty-four-month-boundary", timeWeight: 1, points: 2 },
    ]
  );
});

test("narrative validation retries bracketed output and merges only bounded slots", async () => {
  const groups = buildLaneCFamilyGroups(
    [
      violation({
        id: "recent",
        violation_code: "39375A3TAOLTIS",
        inspection_date: "2026-06-19",
      }),
    ],
    { asOf: new Date("2026-07-23T12:00:00Z") }
  );
  const data = buildPlaybookGenerationData({
    carrier: {
      id: "879b62c2-f8ea-430d-b8d3-9264150d84bf",
      name: "Nationwide Carrier Inc",
      dotNumber: "2533650",
    },
    familyGroups: groups,
    sourceSnapshot: {
      generatedAt: "2026-07-23T19:00:00.000Z",
      asOfDate: "2026-07-23",
      canonicalInspectionSource: "authenticated",
      canonicalInspectionCount: 10,
      sourceViolationCount: 1,
      laneCViolationCount: 1,
      laneCWeightedPoints: groups[0]!.points,
      trailingWindowDays: 90,
      unmappedCodes: [],
    },
  });
  const prompts = buildPlaybookPrompts(data);
  const events: PlaybookGenerationAttemptEvent[] = [];
  let call = 0;
  const result = await generateValidatedPlaybookNarrative(
    prompts,
    data,
    async () => {
      call += 1;
      return call === 1
        ? JSON.stringify({
            familyNarratives: [
              {
                familyKey: "tires_wheels",
                introduction: "[Insert tire summary]",
                coachingLanguage: "Start with the live record.",
              },
            ],
          })
        : JSON.stringify({
            familyNarratives: [
              {
                familyKey: "tires_wheels",
                introduction:
                  "The current tire family is grounded in the listed inspection facts.",
                coachingLanguage:
                  "Use the scheduled checks to stop new tire findings before the next inspection.",
              },
            ],
          });
    },
    {
      onAttempt: (event) => {
        events.push(event);
      },
    }
  );
  assert.equal(result.attempts, 2);
  assert.deepEqual(
    events.map((event) => `${event.attempt}:${event.status}`),
    ["1:started", "1:failed", "2:started", "2:succeeded"]
  );
  const programs = mergeFamilyPrograms(data, result.narrative);
  assert.equal(programs.length, 1);
  assert.equal(programs[0]!.familyKey, "tires_wheels");
  assert.equal(programs[0]!.program.length, 4);
  assert.equal(data.installmentCalendar.length, 12);
  assert.equal(
    data.installmentCalendar.every((entry) =>
      entry.familyKeys.every((key) => key === "tires_wheels")
    ),
    true
  );
  assert.deepEqual(
    data.installmentCalendar
      .filter((entry) => entry.month >= 9)
      .map((entry) => entry.familyKeys),
    [
      ["tires_wheels"],
      ["tires_wheels"],
      ["tires_wheels"],
      ["tires_wheels"],
    ]
  );
  assert.equal(
    data.installmentCalendar.some(
      (entry) => entry.title === "Hours limits" || entry.title === "Cargo securement"
    ),
    false
  );
});
