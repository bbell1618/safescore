import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCanonicalInspectionScope } from "@/lib/fmcsa/canonical-inspection-scope";
import {
  buildLaneCFamilyGroups,
} from "@/lib/playbooks/families";
import {
  buildPlaybookGenerationData,
  buildPlaybookPrompts,
  cloneInstallmentCalendar,
  generateValidatedPlaybookNarrative,
  mergeFamilyPrograms,
} from "@/lib/playbooks/playbook-generation";
import type {
  PlaybookGenerationAttemptEvent,
  PlaybookViolationInput,
} from "@/lib/playbooks/types";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeClientTier, tierHasFeature } from "@/lib/tiers";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  clientId: z.string().uuid(),
});

const TRAILING_WINDOW_DAYS = 90;

type ClientRow = {
  id: string;
  name: string;
  dot_number: string;
  tier: string | null;
};

type StoredViolationRow = Omit<PlaybookViolationInput, "inspection_date"> & {
  inspection_id: string;
  inspections:
    | { inspection_date: string | null }
    | Array<{ inspection_date: string | null }>
    | null;
};

type InsertedPlaybook = {
  id: string;
  version: number;
  generated_at: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function inspectionDate(row: StoredViolationRow): string | null {
  return Array.isArray(row.inspections)
    ? row.inspections[0]?.inspection_date ?? null
    : row.inspections?.inspection_date ?? null;
}

function pacificDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function openRouterError(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    // A bounded raw provider response still surfaces a useful real error.
  }
  return rawBody.trim().slice(0, 500) || "No provider error body returned";
}

async function requestPlaybookNarrative(params: {
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Playbook generation is unavailable because OPENROUTER_API_KEY is not configured."
    );
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL || "https://safescore.app",
      "X-Title": "Golden Era SafeScore",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat-v3-0324",
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      temperature: 0.15,
      max_tokens: 2600,
    }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with HTTP ${response.status}: ${openRouterError(
        rawBody
      )}`
    );
  }

  let data: {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string | null;
    }>;
  };
  try {
    data = JSON.parse(rawBody) as typeof data;
  } catch {
    throw new Error("OpenRouter returned a non-JSON response.");
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error(
      "OpenRouter truncated the generated playbook narrative before completion."
    );
  }
  const content = choice?.message?.content;
  if (!content?.trim()) {
    throw new Error("OpenRouter returned an empty playbook narrative.");
  }
  return content;
}

export async function POST(request: Request) {
  const sessionSupabase = await createClient();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = await createServiceClient();
  const userResult = await serviceSupabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (userResult.error) {
    return NextResponse.json(
      {
        error: `Unable to verify playbook permissions: ${userResult.error.message}`,
      },
      { status: 500 }
    );
  }
  const role: string = userResult.data?.role ?? "client_user";
  if (role !== "geia_admin" && role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { clientId } = parsed.data;

  const clientResult = await serviceSupabase
    .from("clients")
    .select("id, name, dot_number, tier")
    .eq("id", clientId)
    .single();
  if (clientResult.error || !clientResult.data) {
    const status = clientResult.error?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      {
        error:
          status === 404
            ? "Client not found"
            : `Unable to load client: ${
                clientResult.error?.message ?? "Unknown database error"
              }`,
      },
      { status }
    );
  }
  const client = clientResult.data as ClientRow;
  const clientTier = normalizeClientTier(client.tier);
  if (!tierHasFeature(clientTier, "playbook_coach")) {
    return NextResponse.json(
      {
        error:
          "Playbook Coach requires the Remediate or Total Safety service tier.",
      },
      { status: 403 }
    );
  }

  let canonicalScope;
  try {
    canonicalScope = await getCanonicalInspectionScope(
      clientId,
      serviceSupabase
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: errorMessage(
          error,
          "Unable to load the canonical inspection scope."
        ),
      },
      { status: 500 }
    );
  }
  if (canonicalScope.inspectionIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "No canonical inspections are available for playbook generation.",
      },
      { status: 422 }
    );
  }

  const storedViolations: StoredViolationRow[] = [];
  const pageSize = 1_000;
  const violationCountResult = await serviceSupabase
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (violationCountResult.error) {
    return NextResponse.json(
      {
        error: `Unable to count playbook violation facts: ${violationCountResult.error.message}`,
      },
      { status: 500 }
    );
  }
  const expectedViolationCount = violationCountResult.count ?? 0;
  while (storedViolations.length < expectedViolationCount) {
    const violationsResult = await serviceSupabase
      .from("violations")
      .select(
        "id, inspection_id, violation_code, violation_description, basic_category, severity_weight, oos_violation, citation_number, citation_result, convicted, challenge_reason, challenge_tier, inspections(inspection_date)"
      )
      .eq("client_id", clientId)
      .order("id", { ascending: true })
      .range(storedViolations.length, storedViolations.length + pageSize - 1);
    if (violationsResult.error) {
      return NextResponse.json(
        {
          error: `Unable to load playbook violation facts: ${violationsResult.error.message}`,
        },
        { status: 500 }
      );
    }
    const page = (violationsResult.data ?? []) as unknown as StoredViolationRow[];
    if (page.length === 0) {
      return NextResponse.json(
        {
          error: `Unable to load playbook violation facts: expected ${expectedViolationCount} rows but received ${storedViolations.length}.`,
        },
        { status: 500 }
      );
    }
    storedViolations.push(...page);
  }

  const canonicalInspectionIds = new Set(canonicalScope.inspectionIds);
  const sourceViolations = storedViolations
    .filter((row) => canonicalInspectionIds.has(row.inspection_id))
    .map((row): PlaybookViolationInput => ({
      id: row.id,
      violation_code: row.violation_code,
      violation_description: row.violation_description,
      basic_category: row.basic_category,
      severity_weight: row.severity_weight,
      oos_violation: row.oos_violation,
      citation_number: row.citation_number ?? null,
      citation_result: row.citation_result ?? null,
      convicted: row.convicted ?? null,
      challenge_reason: row.challenge_reason ?? null,
      challenge_tier: row.challenge_tier ?? null,
      inspection_date: inspectionDate(row),
    }));

  const generatedAt = new Date();
  const sourceAsOf = pacificDateString(generatedAt);
  const asOf = new Date(`${sourceAsOf}T00:00:00Z`);
  let familyGroups;
  try {
    familyGroups = buildLaneCFamilyGroups(sourceViolations, {
      asOf,
      trailingWindowDays: TRAILING_WINDOW_DAYS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: errorMessage(error, "Unable to build Lane C family groups."),
      },
      { status: 422 }
    );
  }

  const unmappedCodes = [
    ...new Set(
      familyGroups
        .filter((group) => group.familyKey === "general_safety")
        .flatMap((group) =>
          group.violations.map((violation) => violation.code)
        )
    ),
  ].sort();
  const generationId = randomUUID();

  if (unmappedCodes.length > 0) {
    const unmappedLog = await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "playbook_family_unmapped",
      entity_type: "playbook_generation",
      entity_id: generationId,
      description: `${unmappedCodes.length} violation code(s) fell to General Safety during playbook generation.`,
      metadata: {
        generation_id: generationId,
        unmapped_codes: unmappedCodes,
        mapping_behavior: "general_safety_fallback",
        template_version: "u7-golden-artifact-2026-07-22",
      },
    });
    if (unmappedLog.error) {
      return NextResponse.json(
        {
          error: `Unable to durably log unmapped playbook codes: ${unmappedLog.error.message}`,
        },
        { status: 500 }
      );
    }
  }

  let playbookData;
  try {
    playbookData = buildPlaybookGenerationData({
      carrier: {
        id: client.id,
        name: client.name,
        dotNumber: client.dot_number,
      },
      familyGroups,
      sourceSnapshot: {
        generatedAt: generatedAt.toISOString(),
        asOfDate: sourceAsOf,
        canonicalInspectionSource: canonicalScope.source,
        canonicalInspectionCount: canonicalScope.inspectionIds.length,
        sourceViolationCount: sourceViolations.length,
        laneCViolationCount: familyGroups.reduce(
          (total, group) => total + group.count,
          0
        ),
        laneCWeightedPoints: familyGroups.reduce(
          (total, group) => total + group.points,
          0
        ),
        trailingWindowDays: TRAILING_WINDOW_DAYS,
        unmappedCodes,
      },
    });
  } catch (error) {
    const message = errorMessage(
      error,
      "Unable to assemble the deterministic playbook."
    );
    const failureLog = await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "playbook_generation_failed",
      entity_type: "playbook_generation",
      entity_id: generationId,
      description: `Playbook generation failed before narrative generation: ${message}`,
      metadata: {
        generation_id: generationId,
        reason: message,
        family_groups: familyGroups,
        unmapped_codes: unmappedCodes,
      },
    });
    return NextResponse.json(
      {
        error: failureLog.error
          ? `${message} Failure evidence could not be persisted: ${failureLog.error.message}`
          : message,
      },
      { status: failureLog.error ? 500 : 422 }
    );
  }

  const prompts = buildPlaybookPrompts(playbookData);
  const attemptEvidence: PlaybookGenerationAttemptEvent[] = [];
  const recordAttempt = async (event: PlaybookGenerationAttemptEvent) => {
    attemptEvidence.push(event);
    const result = await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "playbook_generation_attempt",
      entity_type: "playbook_generation",
      entity_id: generationId,
      description: `Playbook generation attempt ${event.attempt} ${event.status}: ${event.reason}`,
      metadata: {
        generation_id: generationId,
        attempt: event.attempt,
        status: event.status,
        reason: event.reason,
        raw_output: event.rawOutput ?? null,
        validation_issues: event.validationIssues ?? [],
        template_version: playbookData.templateVersion,
        family_keys: playbookData.familyGroups.map(
          (group) => group.familyKey
        ),
      },
    });
    if (result.error) {
      throw new Error(
        `Could not write playbook generation attempt ${event.attempt} ${event.status} to the activity log: ${result.error.message}`
      );
    }
  };

  let validatedNarrative;
  try {
    validatedNarrative = await generateValidatedPlaybookNarrative(
      prompts,
      playbookData,
      ({ system, user: userPrompt }) =>
        requestPlaybookNarrative({ system, user: userPrompt }),
      { onAttempt: recordAttempt }
    );
  } catch (error) {
    const message = errorMessage(error, "Playbook generation failed.");
    const failureResult = await serviceSupabase.from("activity_log").insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "playbook_generation_failed",
      entity_type: "playbook_generation",
      entity_id: generationId,
      description: `Playbook generation failed: ${message}`,
      metadata: {
        generation_id: generationId,
        reason: message,
        fact_payload: playbookData,
        attempt_outputs: attemptEvidence,
      },
    });
    return NextResponse.json(
      {
        error: failureResult.error
          ? `${message} Failure evidence could not be persisted: ${failureResult.error.message}`
          : message,
      },
      { status: 502 }
    );
  }

  let familyPrograms;
  try {
    familyPrograms = mergeFamilyPrograms(
      playbookData,
      validatedNarrative.narrative
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: errorMessage(
          error,
          "Unable to merge the validated playbook narrative."
        ),
      },
      { status: 500 }
    );
  }

  let insertedPlaybook: InsertedPlaybook | null = null;
  for (let saveAttempt = 1; saveAttempt <= 2; saveAttempt += 1) {
    const latestResult = await serviceSupabase
      .from("client_playbooks")
      .select("version")
      .eq("client_id", clientId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestResult.error) {
      return NextResponse.json(
        {
          error: `Unable to determine the next playbook version: ${latestResult.error.message}`,
        },
        { status: 500 }
      );
    }
    const version =
      ((latestResult.data as { version: number } | null)?.version ?? 0) + 1;
    const insertResult = await serviceSupabase
      .from("client_playbooks")
      .insert({
        client_id: clientId,
        version,
        template_version: playbookData.templateVersion,
        trailing_window_days: TRAILING_WINDOW_DAYS,
        source_as_of: sourceAsOf,
        owner_curriculum: playbookData.ownerCurriculum,
        family_programs: familyPrograms,
        installment_calendar: cloneInstallmentCalendar(
          playbookData.installmentCalendar
        ),
        ai_content: validatedNarrative.narrative,
        source_snapshot: playbookData.sourceSnapshot,
        generated_by: user.id,
        generated_at: generatedAt.toISOString(),
      })
      .select("id, version, generated_at")
      .single();
    if (!insertResult.error && insertResult.data) {
      insertedPlaybook =
        insertResult.data as unknown as InsertedPlaybook;
      break;
    }
    if (insertResult.error?.code !== "23505" || saveAttempt === 2) {
      return NextResponse.json(
        {
          error: `Could not save the generated playbook: ${
            insertResult.error?.message ?? "No playbook row returned"
          }`,
        },
        { status: 500 }
      );
    }
  }
  if (!insertedPlaybook) {
    return NextResponse.json(
      { error: "Could not save the generated playbook." },
      { status: 500 }
    );
  }

  const completionResult = await serviceSupabase
    .from("activity_log")
    .insert({
      client_id: clientId,
      user_id: user.id,
      action_type: "playbook_generated",
      entity_type: "client_playbooks",
      entity_id: insertedPlaybook.id,
      description: `Lane C playbook version ${insertedPlaybook.version} generated for ${client.name}.`,
      metadata: {
        generation_id: generationId,
        generation_attempts: validatedNarrative.attempts,
        playbook_version: insertedPlaybook.version,
        template_version: playbookData.templateVersion,
        service_tier: clientTier,
        family_keys: familyPrograms.map((program) => program.familyKey),
        family_count: familyPrograms.length,
        lane_c_violation_count:
          playbookData.sourceSnapshot.laneCViolationCount,
        lane_c_weighted_points:
          playbookData.sourceSnapshot.laneCWeightedPoints,
        unmapped_codes: unmappedCodes,
      },
    });
  if (completionResult.error) {
    return NextResponse.json(
      {
        error: `Playbook ${insertedPlaybook.id} was saved, but its completion audit log failed: ${completionResult.error.message}`,
        playbookId: insertedPlaybook.id,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    playbookId: insertedPlaybook.id,
    version: insertedPlaybook.version,
    generationAttempts: validatedNarrative.attempts,
    familyCount: familyPrograms.length,
    laneCViolationCount: playbookData.sourceSnapshot.laneCViolationCount,
    laneCWeightedPoints: playbookData.sourceSnapshot.laneCWeightedPoints,
    unmappedCodes,
  });
}
