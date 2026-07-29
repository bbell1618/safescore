import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/+$/,
  ""
);
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

type JsonObject = Record<string, unknown>;

type AttemptProof = {
  id: string;
  clientId: string;
  generationId: string;
  attempt: number;
  status: "started" | "succeeded" | "failed";
  reason: string;
  rawOutputPresent: boolean;
  validationIssues: unknown[];
  createdAt: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

async function readJson(response: Response): Promise<JsonObject> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as JsonObject;
  } catch {
    throw new Error(
      `Expected JSON from ${response.url}; received HTTP ${response.status}: ${raw.slice(0, 300)}`
    );
  }
}

function asAttemptProof(
  row: {
    id: string;
    client_id: string | null;
    entity_id: string | null;
    metadata: unknown;
    created_at: string;
  },
  generationId: string
): AttemptProof {
  const metadata = row.metadata as JsonObject;
  const status = metadata.status;
  assert.ok(
    status === "started" || status === "succeeded" || status === "failed",
    `Unexpected report-attempt status ${String(status)}`
  );
  assert.equal(row.client_id, clientId);
  assert.equal(row.entity_id, generationId);
  assert.equal(metadata.generation_id, generationId);
  assert.equal(typeof metadata.attempt, "number");
  assert.equal(typeof metadata.reason, "string");
  assert.ok(String(metadata.reason).trim().length > 0);

  return {
    id: row.id,
    clientId: row.client_id,
    generationId,
    attempt: metadata.attempt as number,
    status,
    reason: metadata.reason as string,
    rawOutputPresent:
      typeof metadata.raw_output === "string" &&
      metadata.raw_output.length > 0,
    validationIssues: Array.isArray(metadata.validation_issues)
      ? metadata.validation_issues
      : [],
    createdAt: row.created_at,
  };
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

  let staffSession:
    | Awaited<ReturnType<typeof createDeployedStaffSession>>
    | null = null;
  let sessionRevoked = false;
  let proof:
    | {
        report: {
          id: string;
          clientId: string;
          type: string;
          status: string;
          aiContentPresent: boolean;
          finalContentPresent: boolean;
          createdAt: string;
          preservedAsDraft: true;
        };
        completion: {
          id: string;
          clientId: string;
          generationId: string;
          attemptsReportedByRoute: number;
          createdAt: string;
        };
        attempts: AttemptProof[];
      }
    | null = null;

  try {
    staffSession = await createDeployedStaffSession(baseUrl);

    const reportResponse = await fetch(
      `${baseUrl}/api/reports/generate-text`,
      {
        method: "POST",
        headers: {
          cookie: staffSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientId, type: "monthly" }),
      }
    );
    const reportBody = await readJson(reportResponse);
    if (!reportResponse.ok) {
      throw new Error(
        `Report generation returned HTTP ${reportResponse.status}: ${String(reportBody.error)}`
      );
    }

    assert.equal(typeof reportBody.reportId, "string");
    assert.equal(typeof reportBody.generationAttempts, "number");
    const reportId = String(reportBody.reportId);
    const generationAttempts = Number(reportBody.generationAttempts);

    const reportResult = await service
      .from("reports")
      .select(
        "id, client_id, type, status, ai_content, final_content, created_at"
      )
      .eq("id", reportId)
      .single();
    if (reportResult.error || !reportResult.data) {
      throw (
        reportResult.error ??
        new Error(`Generated report ${reportId} was not found`)
      );
    }
    const report = reportResult.data;
    assert.equal(report.client_id, clientId);
    assert.equal(report.type, "monthly");
    assert.equal(report.status, "draft");
    assert.equal(typeof report.ai_content, "string");
    assert.equal(typeof report.final_content, "string");
    assert.equal(report.ai_content, report.final_content);

    const completionResult = await service
      .from("activity_log")
      .select("id, client_id, entity_id, metadata, created_at")
      .eq("action_type", "report_generated")
      .eq("entity_type", "reports")
      .eq("entity_id", reportId)
      .single();
    if (completionResult.error || !completionResult.data) {
      throw (
        completionResult.error ??
        new Error(`Completion log for report ${reportId} was not found`)
      );
    }
    const completion = completionResult.data;
    const completionMetadata = completion.metadata as JsonObject;
    const generationId = String(completionMetadata.generation_id ?? "");
    assert.match(
      generationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.equal(completion.client_id, clientId);
    assert.equal(Number(completionMetadata.generation_attempts), generationAttempts);

    const attemptsResult = await service
      .from("activity_log")
      .select("id, client_id, entity_id, metadata, created_at")
      .eq("action_type", "report_generation_attempt")
      .eq("entity_type", "report_generation")
      .eq("entity_id", generationId)
      .order("created_at", { ascending: true });
    if (attemptsResult.error) throw attemptsResult.error;

    const attempts = (attemptsResult.data ?? []).map((row) =>
      asAttemptProof(row, generationId)
    );
    assert.ok(attempts.length >= 2, "No complete attempt lifecycle was logged");
    assert.equal(attempts[0]?.attempt, 1);
    assert.equal(attempts[0]?.status, "started");
    assert.equal(attempts.at(-1)?.status, "succeeded");
    assert.equal(attempts.at(-1)?.attempt, generationAttempts);

    for (let attempt = 1; attempt <= generationAttempts; attempt += 1) {
      const lifecycle = attempts
        .filter((event) => event.attempt === attempt)
        .map((event) => event.status);
      assert.equal(lifecycle[0], "started");
      assert.ok(
        lifecycle.at(-1) === "failed" || lifecycle.at(-1) === "succeeded"
      );
      assert.equal(lifecycle.length, 2);
    }

    proof = {
      report: {
        id: report.id,
        clientId: report.client_id,
        type: report.type,
        status: report.status,
        aiContentPresent: report.ai_content.length > 0,
        finalContentPresent: report.final_content.length > 0,
        createdAt: report.created_at,
        preservedAsDraft: true,
      },
      completion: {
        id: completion.id,
        clientId: completion.client_id,
        generationId,
        attemptsReportedByRoute: generationAttempts,
        createdAt: completion.created_at,
      },
      attempts,
    };
  } finally {
    if (staffSession) {
      await staffSession.revoke();
      sessionRevoked = true;
    }
  }

  assert.ok(proof);
  assert.equal(sessionRevoked, true);
  console.log(
    JSON.stringify(
      {
        passed: true,
        target: {
          baseUrl,
          clientId,
        },
        ...proof,
        cleanup: {
          verificationSessionRevoked: sessionRevoked,
          generatedDraftDeleted: false,
        },
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
