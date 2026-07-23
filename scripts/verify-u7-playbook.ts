import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/$/,
  ""
);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const placeholderPattern = /\[[^\]\n]{1,80}\]/g;

type FamilyProgram = {
  familyKey: string;
  familyName: string;
  count: number;
  points: number;
  inflowCount: number;
  inflowRatePerMonth: number;
  violations: Array<{ code: string }>;
};

type GenerateResponse = {
  playbookId?: string;
  version?: number;
  generationAttempts?: number;
  familyCount?: number;
  laneCViolationCount?: number;
  laneCWeightedPoints?: number;
  unmappedCodes?: string[];
  error?: string;
};

const expectedFamilies: Record<
  string,
  { count: number; points: number; inflowCount: number; inflowRate: number }
> = {
  tires_wheels: { count: 7, points: 124, inflowCount: 2, inflowRate: 0.67 },
  lighting_electrical: {
    count: 13,
    points: 101,
    inflowCount: 0,
    inflowRate: 0,
  },
  brakes_air: { count: 8, points: 52, inflowCount: 0, inflowRate: 0 },
  log_integrity: { count: 4, points: 37, inflowCount: 0, inflowRate: 0 },
  steering_suspension: {
    count: 2,
    points: 30,
    inflowCount: 0,
    inflowRate: 0,
  },
  driver_behavior: { count: 3, points: 26, inflowCount: 0, inflowRate: 0 },
  eld_hygiene: { count: 12, points: 25, inflowCount: 0, inflowRate: 0 },
  conspicuity_body: { count: 3, points: 13, inflowCount: 0, inflowRate: 0 },
  emergency_cab: { count: 4, points: 12, inflowCount: 0, inflowRate: 0 },
  general_safety: { count: 1, points: 12, inflowCount: 0, inflowRate: 0 },
  hours_limits: { count: 1, points: 9, inflowCount: 0, inflowRate: 0 },
  driver_qualification: {
    count: 1,
    points: 4,
    inflowCount: 0,
    inflowRate: 0,
  },
  cargo_securement: { count: 1, points: 3, inflowCount: 0, inflowRate: 0 },
};

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const beforeResult = await service
    .from("client_playbooks")
    .select("version")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (beforeResult.error) throw beforeResult.error;
  const priorVersion = beforeResult.data?.version ?? 0;

  const unauthenticated = await fetch(`${baseUrl}/api/playbooks/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId }),
  });
  assert.equal(unauthenticated.status, 401);

  const session = await createDeployedStaffSession(baseUrl);
  try {
    const response = await fetch(`${baseUrl}/api/playbooks/generate`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ clientId }),
    });
    const rawResponse = await response.text();
    let generated: GenerateResponse;
    try {
      generated = JSON.parse(rawResponse) as GenerateResponse;
    } catch {
      throw new Error(
        `Playbook route returned non-JSON HTTP ${response.status}: ${rawResponse}`
      );
    }
    if (!response.ok) {
      throw new Error(
        `Playbook route returned HTTP ${response.status}: ${
          generated.error ?? rawResponse
        }`
      );
    }

    assert.ok(generated.playbookId);
    assert.equal(generated.version, priorVersion + 1);
    assert.equal(generated.familyCount, 13);
    assert.equal(generated.laneCViolationCount, 60);
    assert.equal(generated.laneCWeightedPoints, 448);
    assert.deepEqual(generated.unmappedCodes, ["39617CPI"]);

    const rowResult = await service
      .from("client_playbooks")
      .select("*")
      .eq("id", generated.playbookId)
      .single();
    if (rowResult.error || !rowResult.data) {
      throw rowResult.error ?? new Error("Saved playbook was not found.");
    }
    const row = rowResult.data;
    const owner = row.owner_curriculum as Array<{ key: string }>;
    const programs = row.family_programs as FamilyProgram[];
    const calendar = row.installment_calendar as Array<{ month: number }>;
    const source = row.source_snapshot as {
      canonicalInspectionSource: string;
      canonicalInspectionCount: number;
      sourceViolationCount: number;
      laneCViolationCount: number;
      laneCWeightedPoints: number;
      trailingWindowDays: number;
      unmappedCodes: string[];
    };

    assert.deepEqual(
      owner.map((module) => module.key),
      ["A1", "A2", "A3", "A4"]
    );
    assert.equal(calendar.length, 12);
    assert.deepEqual(
      calendar.map((entry) => entry.month),
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
    assert.equal(programs.length, 13);
    assert.equal(
      programs.reduce((total, program) => total + program.count, 0),
      60
    );
    assert.equal(
      programs.reduce((total, program) => total + program.points, 0),
      448
    );
    for (const program of programs) {
      const expected = expectedFamilies[program.familyKey];
      assert.ok(expected, `Unexpected family ${program.familyKey}`);
      assert.equal(program.count, expected.count);
      assert.equal(program.points, expected.points);
      assert.equal(program.inflowCount, expected.inflowCount);
      assert.equal(program.inflowRatePerMonth, expected.inflowRate);
    }
    assert.deepEqual(
      programs
        .find((program) => program.familyKey === "general_safety")
        ?.violations.map((violation) => violation.code),
      ["39617CPI"]
    );
    assert.deepEqual(source.unmappedCodes, ["39617CPI"]);
    assert.equal(source.canonicalInspectionSource, "public");
    assert.equal(source.canonicalInspectionCount, 76);
    assert.equal(source.sourceViolationCount, 71);
    assert.equal(source.laneCViolationCount, 60);
    assert.equal(source.laneCWeightedPoints, 448);
    assert.equal(source.trailingWindowDays, 90);
    assert.deepEqual(
      JSON.stringify({
        owner: row.owner_curriculum,
        programs: row.family_programs,
        calendar: row.installment_calendar,
        ai: row.ai_content,
      }).match(placeholderPattern) ?? [],
      []
    );

    const completionResult = await service
      .from("activity_log")
      .select("entity_id, metadata")
      .eq("action_type", "playbook_generated")
      .eq("entity_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (completionResult.error || !completionResult.data) {
      throw completionResult.error ?? new Error("Completion audit log missing.");
    }
    const completionMetadata = completionResult.data.metadata as {
      generation_id?: string;
      generation_attempts?: number;
    };
    assert.ok(completionMetadata.generation_id);

    const attemptsResult = await service
      .from("activity_log")
      .select("metadata")
      .eq("entity_type", "playbook_generation")
      .eq("entity_id", completionMetadata.generation_id)
      .eq("action_type", "playbook_generation_attempt")
      .order("created_at", { ascending: true });
    if (attemptsResult.error) throw attemptsResult.error;
    const attemptStatuses = (attemptsResult.data ?? []).map(
      (entry) => (entry.metadata as { status?: string }).status
    );
    assert.equal(attemptStatuses[0], "started");
    assert.equal(attemptStatuses.at(-1), "succeeded");

    const fallbackResult = await service
      .from("activity_log")
      .select("metadata")
      .eq("entity_type", "playbook_generation")
      .eq("entity_id", completionMetadata.generation_id)
      .eq("action_type", "playbook_family_unmapped")
      .single();
    if (fallbackResult.error || !fallbackResult.data) {
      throw fallbackResult.error ?? new Error("Fallback audit log missing.");
    }
    assert.deepEqual(
      (fallbackResult.data.metadata as { unmapped_codes?: string[] })
        .unmapped_codes,
      ["39617CPI"]
    );

    const [playbookPage, remediationPage] = await Promise.all([
      fetch(
        `${baseUrl}/console/clients/${clientId}/remediation/playbook?version=${row.version}`,
        { headers: { cookie: session.cookie }, redirect: "manual" }
      ),
      fetch(`${baseUrl}/console/clients/${clientId}/remediation`, {
        headers: { cookie: session.cookie },
        redirect: "manual",
      }),
    ]);
    const [playbookHtml, remediationHtml] = await Promise.all([
      playbookPage.text(),
      remediationPage.text(),
    ]);
    assert.equal(playbookPage.status, 200);
    assert.equal(remediationPage.status, 200);
    for (const expected of [
      "Owner curriculum",
      "Twelve-month calendar",
      "Family programs",
      "Tires &amp; Wheels",
      "General Safety",
      "39617CPI",
      "Version",
    ]) {
      assert.ok(
        playbookHtml.includes(expected),
        `Playbook page is missing ${expected}`
      );
    }
    for (const expected of [
      "Lane C family programs",
      "Tires &amp; Wheels",
      "0.67/mo",
      "Open program",
    ]) {
      assert.ok(
        remediationHtml.includes(expected),
        `Remediation page is missing ${expected}`
      );
    }

    const unauthenticatedPage = await fetch(
      `${baseUrl}/console/clients/${clientId}/remediation/playbook`,
      { redirect: "manual" }
    );
    assert.ok([302, 303, 307, 308].includes(unauthenticatedPage.status));

    console.log(
      JSON.stringify(
        {
          routeStatus: response.status,
          unauthenticatedRouteStatus: unauthenticated.status,
          playbookId: row.id,
          version: row.version,
          generationAttempts: generated.generationAttempts,
          generatedAt: row.generated_at,
          sourceAsOf: row.source_as_of,
          sourceSnapshot: source,
          familyStructure: programs.map((program) => ({
            familyKey: program.familyKey,
            familyName: program.familyName,
            count: program.count,
            points: program.points,
            inflowCount: program.inflowCount,
            inflowRatePerMonth: program.inflowRatePerMonth,
          })),
          placeholderMatches: [],
          audit: {
            completionEntityId: completionResult.data.entity_id,
            generationId: completionMetadata.generation_id,
            attemptStatuses,
            fallbackCodes: ["39617CPI"],
          },
          renderedRoutes: {
            playbook: playbookPage.status,
            remediation: remediationPage.status,
            unauthenticatedPlaybook: unauthenticatedPage.status,
          },
        },
        null,
        2
      )
    );
  } finally {
    await session.revoke();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
