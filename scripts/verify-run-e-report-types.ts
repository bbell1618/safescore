import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PREPARER_BLOCK,
  REPORT_SECTION_HEADINGS,
  REPORT_TYPE_CONFIGS,
  findReportPlaceholders,
  type ReportType,
} from "../lib/reports/report-generation";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/+$/,
  ""
);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const reportTypes: ReportType[] = [
  "assessment",
  "monthly",
  "quarterly",
  "improvement",
  "underwriter",
];
const pauseBeforeCleanup = process.argv.includes("--pause-before-cleanup");
const legacyForbiddenHeadings = new Set([
  "Month-over-month comparison",
  "Coaching Program",
  "Compliance Sweep",
]);

const expectedHeadings = Object.fromEntries(
  reportTypes.map((type) => [
    type,
    REPORT_TYPE_CONFIGS[type].sections.map(
      (key) => REPORT_SECTION_HEADINGS[key]
    ),
  ])
) as Record<ReportType, string[]>;

const allKnownHeadings = new Set(Object.values(expectedHeadings).flat());
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;
type ReportRow = JsonObject & {
  id: string;
  client_id: string;
  type: string;
  title: string;
  status: string;
  ai_content: string | null;
  final_content: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
};

type GeneratedResponse = {
  reportId?: unknown;
  content?: unknown;
  generationAttempts?: unknown;
  error?: unknown;
};

type AttemptProof = {
  id: string;
  attempt: number;
  status: "started" | "succeeded" | "failed";
  reason: string;
  rawOutputSha256: string | null;
  validationIssues: unknown[];
  createdAt: string;
};

type GeneratedProof = {
  type: ReportType;
  routeStatus: number;
  reportId: string;
  title: string;
  status: string;
  contentSha256: string;
  contentLength: number;
  placeholderMatches: string[];
  headings: string[];
  generationAttempts: number;
  generationId: string;
  completionLogId: string;
  completionMetadata: JsonObject;
  attempts: AttemptProof[];
  content: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function rowProof(row: ReportRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    aiContentSha256: row.ai_content === null ? null : sha256(row.ai_content),
    finalContentSha256:
      row.final_content === null ? null : sha256(row.final_content),
    fullRowSha256: sha256(stableJson(row)),
  };
}

function sameStrings(actual: string[], expected: string[], label: string) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} did not match the exact allowlist`
  );
}

async function readJson(response: Response): Promise<GeneratedResponse> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as GeneratedResponse;
  } catch {
    throw new Error(
      `Expected JSON from ${response.url}; received HTTP ${response.status}: ${raw.slice(0, 500)}`
    );
  }
}

function exactHeadingLines(content: string, type: ReportType): string[] {
  const expected = expectedHeadings[type];
  const lines = content.split(/\r?\n/);
  const found = lines.filter((line) => allKnownHeadings.has(line));

  assert.deepEqual(
    found,
    expected,
    `${type} report did not contain exactly its required headings in order`
  );
  for (const heading of expected) {
    assert.equal(
      lines.filter((line) => line === heading).length,
      1,
      `${type} report heading ${heading} did not appear exactly once`
    );
  }

  const markdownHeadings = lines.filter((line) => /^#{1,6}\s+\S/.test(line));
  assert.deepEqual(
    markdownHeadings,
    [],
    `${type} report contained an unexpected Markdown heading`
  );

  const knownMetadata = new Set([
    ...allKnownHeadings,
    ...legacyForbiddenHeadings,
    ...PREPARER_BLOCK.split("\n"),
  ]);
  const unknownPlainHeadings = lines.flatMap((line, index) => {
    const trimmed = line.trim();
    const emphasizedMatch = trimmed.match(/^(?:\*\*|__)(.+?)(?:\*\*|__):?$/);
    if (emphasizedMatch) return [emphasizedMatch[1]!.trim()];
    if (index === 0 || trimmed.startsWith("Report date:")) return [];
    const candidate = trimmed.replace(/:$/, "").trim();
    if (
      candidate.length >= 3 &&
      candidate.length <= 70 &&
      /^[A-Z][A-Za-z0-9&/'()\-–— ]+$/.test(candidate) &&
      !/[.!?;]$/.test(candidate) &&
      !knownMetadata.has(candidate) &&
      (lines[index - 1]?.trim() === "" || lines[index + 1]?.trim() === "")
    ) {
      return [candidate];
    }
    return [];
  });
  assert.deepEqual(
    [...new Set(unknownPlainHeadings)],
    [],
    `${type} report contained an unexpected plain-text heading`
  );
  for (const heading of legacyForbiddenHeadings) {
    assert.ok(
      !lines.includes(heading),
      `${type} report contained legacy heading ${heading}`
    );
  }
  return found;
}

function sectionBody(
  content: string,
  heading: string,
  headings: string[]
): string {
  const lines = content.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headings.includes(lines[index]!)) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function validateContent(content: string, type: ReportType): {
  placeholderMatches: string[];
  headings: string[];
} {
  assert.ok(content.trim().length > 0, `${type} report content was empty`);
  assert.ok(
    content.includes(PREPARER_BLOCK),
    `${type} report omitted the exact preparer block`
  );
  assert.equal(
    content.split(PREPARER_BLOCK).length - 1,
    1,
    `${type} report did not contain the preparer block exactly once`
  );
  assert.match(
    content,
    /Report date: [A-Z][a-z]+ \d{1,2}, \d{4}/,
    `${type} report omitted its formatted report date`
  );

  const placeholderMatches = findReportPlaceholders(content);
  assert.deepEqual(
    placeholderMatches,
    [],
    `${type} report contained a bracketed placeholder`
  );
  assert.doesNotMatch(
    content,
    /\bSMS points?\b/i,
    `${type} report mislabeled weighted violation burden`
  );

  const headings = exactHeadingLines(content, type);
  for (const heading of ["Open Challenges", "Remediation Work Completed"]) {
    if (headings.includes(heading)) {
      assert.doesNotMatch(
        sectionBody(content, heading, headings),
        /\bdraft\b/i,
        `${type} report exposed a draft case in ${heading}`
      );
    }
  }
  if (type === "improvement" || type === "underwriter") {
    for (const phrase of [
      "evidence pending",
      "under investigation",
      "Operational priority",
    ]) {
      assert.ok(
        !content.toLowerCase().includes(phrase.toLowerCase()),
        `${type} report contained forbidden internal phrase ${phrase}`
      );
    }
    assert.doesNotMatch(
      content,
      /\bdraft\b/i,
      `${type} report contained forbidden draft language`
    );
    assert.doesNotMatch(
      content,
      /\b(?:internal|operations?|operational) queue\b/i,
      `${type} report contained forbidden queue language`
    );
    assert.doesNotMatch(
      content,
      /\bevidence (?:request|ask)s?\b/i,
      `${type} report contained forbidden evidence-request language`
    );
    assert.doesNotMatch(
      content,
      /\b(?:client )?weakness (?:ranking|rankings)\b/i,
      `${type} report contained forbidden weakness-ranking language`
    );
  }
  if (type === "underwriter") {
    assert.doesNotMatch(
      content,
      /\bguarantee\w*\b/i,
      "underwriter report contained forbidden guarantee language"
    );
  }
  if (type === "improvement") {
    assert.doesNotMatch(
      content,
      /\bpending\b/i,
      "improvement report contained forbidden pending language"
    );
    assert.doesNotMatch(
      sectionBody(content, "Current Standing", headings),
      /\b(?:cases?|challenges?|filed)\b/i,
      "improvement Current Standing contained case-work language"
    );
    assert.doesNotMatch(
      sectionBody(content, "Work Performed", headings),
      /\b(?:during|since) (?:the )?(?:SafeScore )?(?:engagement|service)\b/i,
      "improvement Work Performed misstated case timing"
    );
  }

  return { placeholderMatches, headings };
}

async function fetchAllReports(
  service: SupabaseClient
): Promise<ReportRow[]> {
  const result = await service
    .from("reports")
    .select("*")
    .eq("client_id", clientId)
    .order("id", { ascending: true });
  if (result.error) throw result.error;
  return (result.data ?? []) as ReportRow[];
}

async function fetchAttemptProof(
  service: SupabaseClient,
  reportId: string,
  generationAttempts: number
): Promise<{
  generationId: string;
  completionLogId: string;
  completionMetadata: JsonObject;
  attempts: AttemptProof[];
}> {
  const completionResult = await service
    .from("activity_log")
    .select("id, client_id, entity_id, metadata, created_at")
    .eq("action_type", "report_generated")
    .eq("entity_type", "reports")
    .eq("entity_id", reportId)
    .maybeSingle();
  if (completionResult.error || !completionResult.data) {
    throw (
      completionResult.error ??
      new Error(`Completion log for report ${reportId} was not found`)
    );
  }
  const completion = completionResult.data;
  assert.equal(completion.client_id, clientId);
  const completionMetadata = completion.metadata as JsonObject;
  const generationId = String(completionMetadata.generation_id ?? "");
  assert.match(generationId, uuidPattern);
  assert.equal(
    Number(completionMetadata.generation_attempts),
    generationAttempts,
    `Completion log for ${reportId} disagreed with the route attempt count`
  );

  const attemptsResult = await service
    .from("activity_log")
    .select("id, client_id, entity_id, metadata, created_at")
    .eq("action_type", "report_generation_attempt")
    .eq("entity_type", "report_generation")
    .eq("entity_id", generationId)
    .order("created_at", { ascending: true });
  if (attemptsResult.error) throw attemptsResult.error;

  const attempts = (attemptsResult.data ?? []).map((row) => {
    assert.equal(row.client_id, clientId);
    assert.equal(row.entity_id, generationId);
    const metadata = row.metadata as JsonObject;
    const status = metadata.status;
    assert.ok(
      status === "started" || status === "succeeded" || status === "failed",
      `Unexpected attempt status ${String(status)}`
    );
    assert.equal(metadata.generation_id, generationId);
    assert.equal(typeof metadata.attempt, "number");
    assert.equal(typeof metadata.reason, "string");
    assert.ok(String(metadata.reason).trim().length > 0);
    return {
      id: row.id,
      attempt: metadata.attempt as number,
      status,
      reason: metadata.reason as string,
      rawOutputSha256:
        typeof metadata.raw_output === "string"
          ? sha256(metadata.raw_output)
          : null,
      validationIssues: Array.isArray(metadata.validation_issues)
        ? metadata.validation_issues
        : [],
      createdAt: row.created_at,
    } satisfies AttemptProof;
  });

  assert.ok(
    attempts.length >= 2,
    `No attempt lifecycle was logged for ${reportId}`
  );
  assert.equal(attempts[0]?.attempt, 1);
  assert.equal(attempts[0]?.status, "started");
  assert.equal(attempts.at(-1)?.attempt, generationAttempts);
  assert.equal(attempts.at(-1)?.status, "succeeded");
  for (let attempt = 1; attempt <= generationAttempts; attempt += 1) {
    const lifecycle = attempts
      .filter((event) => event.attempt === attempt)
      .map((event) => event.status);
    assert.deepEqual(
      lifecycle,
      attempt === generationAttempts
        ? ["started", "succeeded"]
        : ["started", "failed"],
      `Attempt ${attempt} for ${reportId} did not have one complete lifecycle`
    );
  }

  return {
    generationId,
    completionLogId: completion.id,
    completionMetadata,
    attempts,
  };
}

async function deleteGeneratedDrafts(
  service: SupabaseClient,
  ids: string[],
  baselineIds: Set<string>,
  requireAll: boolean
): Promise<string[]> {
  const allowlist = [...new Set(ids)].sort();
  if (allowlist.length === 0) return [];
  assert.ok(
    allowlist.every((id) => !baselineIds.has(id)),
    "Cleanup allowlist contained a pre-existing report ID"
  );
  if (requireAll) {
    assert.equal(allowlist.length, reportTypes.length);
  }

  const candidatesResult = await service
    .from("reports")
    .select("id, client_id, status")
    .eq("client_id", clientId)
    .in("id", allowlist);
  if (candidatesResult.error) throw candidatesResult.error;
  const candidates = candidatesResult.data ?? [];
  if (requireAll) {
    sameStrings(
      candidates.map((row) => row.id),
      allowlist,
      "Cleanup candidates"
    );
  }
  assert.ok(
    candidates.every(
      (row) => row.client_id === clientId && row.status === "draft"
    ),
    "Cleanup refused because a generated report was not a Nationwide draft"
  );

  const presentIds = candidates.map((row) => row.id).sort();
  if (presentIds.length === 0) return [];
  const deleteResult = await service
    .from("reports")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "draft")
    .in("id", presentIds)
    .select("id");
  if (deleteResult.error) throw deleteResult.error;
  const deletedIds = (deleteResult.data ?? []).map((row) => row.id).sort();
  sameStrings(deletedIds, presentIds, "Deleted reports");
  return deletedIds;
}

async function main() {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const preExisting = await fetchAllReports(service);
  const preExistingProof = preExisting.map(rowProof);
  const baselineIds = new Set(preExisting.map((row) => row.id));
  const runStartedAt = new Date().toISOString();

  const session = await createDeployedStaffSession(baseUrl);
  const generatedIds: string[] = [];
  let cleanupComplete = false;
  let sessionRevoked = false;
  let finalProof: JsonObject | null = null;

  try {
    const generatedProofs: GeneratedProof[] = [];
    for (const type of reportTypes) {
      const response = await fetch(`${baseUrl}/api/reports/generate-text`, {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientId, type }),
      });
      const body = await readJson(response);
      const candidateId =
        typeof body.reportId === "string" && uuidPattern.test(body.reportId)
          ? body.reportId
          : null;
      if (candidateId && !baselineIds.has(candidateId)) {
        generatedIds.push(candidateId);
      }
      if (!response.ok) {
        throw new Error(
          `${type} report generation returned HTTP ${response.status}: ${String(body.error ?? "unknown error")}`
        );
      }
      assert.ok(candidateId, `${type} route omitted a valid reportId`);
      assert.ok(
        !baselineIds.has(candidateId),
        `${type} route returned a pre-existing report ID`
      );
      assert.equal(
        generatedIds.filter((id) => id === candidateId).length,
        1,
        `${type} route reused a generated report ID`
      );
      assert.equal(typeof body.content, "string");
      assert.equal(typeof body.generationAttempts, "number");
      const routeContent = body.content as string;
      const generationAttempts = body.generationAttempts as number;
      assert.ok(Number.isInteger(generationAttempts));
      assert.ok(generationAttempts >= 1 && generationAttempts <= 3);

      const savedResult = await service
        .from("reports")
        .select("*")
        .eq("id", candidateId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (savedResult.error || !savedResult.data) {
        throw (
          savedResult.error ??
          new Error(`Generated ${type} report ${candidateId} was not saved`)
        );
      }
      const saved = savedResult.data as ReportRow;
      assert.equal(saved.client_id, clientId);
      assert.equal(saved.type, type);
      assert.equal(saved.status, "draft");
      assert.equal(saved.sent_at, null);
      assert.ok(saved.created_by);
      assert.ok(
        saved.created_at >= runStartedAt,
        `${type} route returned a report created before this verification run`
      );
      assert.equal(typeof saved.ai_content, "string");
      assert.equal(typeof saved.final_content, "string");
      assert.equal(saved.ai_content, saved.final_content);
      assert.equal(saved.final_content, routeContent);

      const contentValidation = validateContent(routeContent, type);
      const attemptProof = await fetchAttemptProof(
        service,
        candidateId,
        generationAttempts
      );
      const proof: GeneratedProof = {
        type,
        routeStatus: response.status,
        reportId: candidateId,
        title: saved.title,
        status: saved.status,
        contentSha256: sha256(routeContent),
        contentLength: routeContent.length,
        placeholderMatches: contentValidation.placeholderMatches,
        headings: contentValidation.headings,
        generationAttempts,
        ...attemptProof,
        content: routeContent,
      };
      generatedProofs.push(proof);

      console.log(`===== BEGIN FULL REPORT ${type} ${candidateId} =====`);
      console.log(routeContent);
      console.log(`===== END FULL REPORT ${type} ${candidateId} =====`);
    }

    assert.equal(generatedProofs.length, reportTypes.length);
    sameStrings(
      generatedProofs.map((proof) => proof.type),
      reportTypes,
      "Generated report types"
    );
    sameStrings(
      generatedIds,
      generatedProofs.map((proof) => proof.reportId),
      "Generated IDs"
    );

    if (pauseBeforeCleanup) {
      console.log(
        JSON.stringify({
          browserVerificationPause: true,
          generatedDraftIds: [...generatedIds],
          instruction:
            "Visually verify the live report history and detail surfaces, then press Enter to run the scoped cleanup.",
        })
      );
      process.stdin.resume();
      await new Promise<void>((resolve) => {
        process.stdin.once("data", () => resolve());
      });
      process.stdin.pause();
    }

    const deletedIds = await deleteGeneratedDrafts(
      service,
      generatedIds,
      baselineIds,
      true
    );
    cleanupComplete = true;
    sameStrings(deletedIds, generatedIds, "Final cleanup");

    const deletedCheck = await service
      .from("reports")
      .select("id")
      .in("id", generatedIds);
    if (deletedCheck.error) throw deletedCheck.error;
    assert.deepEqual(
      deletedCheck.data ?? [],
      [],
      "One or more generated report drafts survived cleanup"
    );

    const afterCleanup = await fetchAllReports(service);
    const afterCleanupProof = afterCleanup.map(rowProof);
    assert.deepEqual(
      afterCleanupProof,
      preExistingProof,
      "A pre-existing Nationwide report changed during verification"
    );

    finalProof = {
      target: { baseUrl, clientId },
      preExistingReports: {
        count: preExistingProof.length,
        immutableProofBefore: preExistingProof,
        immutableProofAfter: afterCleanupProof,
        unchanged: true,
      },
      generatedReports: generatedProofs.map(({ content, ...proof }) => {
        assert.ok(content.length > 0);
        return proof;
      }),
      cleanup: {
        allowlist: [...generatedIds].sort(),
        statusGuard: "draft",
        deletedIds,
        generatedRowsRemaining: deletedCheck.data ?? [],
        preExistingReportsUnchanged: true,
      },
    };
  } finally {
    let cleanupError: unknown = null;
    if (!cleanupComplete && generatedIds.length > 0) {
      try {
        await deleteGeneratedDrafts(service, generatedIds, baselineIds, false);
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      await session.revoke();
      sessionRevoked = true;
    } catch (error) {
      if (!cleanupError) cleanupError = error;
    }
    if (cleanupError) throw cleanupError;
  }

  assert.equal(sessionRevoked, true);
  assert.ok(finalProof);
  console.log(
    JSON.stringify(
      {
        passed: true,
        ...finalProof,
        verificationSessionRevoked: sessionRevoked,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
