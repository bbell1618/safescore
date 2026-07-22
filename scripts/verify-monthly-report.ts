import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  PREPARER_BLOCK,
  findReportPlaceholders,
  formatReportDate,
} from "../lib/reports/report-generation";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/$/,
  ""
);
const existingReportId = process.argv[3] ?? null;
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

type GeneratedResponse = {
  reportId?: string;
  content?: string;
  generationAttempts?: number;
  error?: string;
};

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const session = existingReportId
    ? null
    : await createDeployedStaffSession(baseUrl);

  try {
    let generated: GeneratedResponse;
    let routeStatus: number | "existing-row";
    let monthlyRowsBefore: number | null = null;
    let monthlyRowsAfter: number | null = null;

    if (existingReportId) {
      generated = { reportId: existingReportId };
      routeStatus = "existing-row";
    } else {
      const baseline = await service
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("type", "monthly");
      if (baseline.error) throw baseline.error;
      monthlyRowsBefore = baseline.count ?? 0;

      const response = await fetch(`${baseUrl}/api/reports/generate-text`, {
        method: "POST",
        headers: {
          cookie: session!.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          type: "monthly",
        }),
      });
      routeStatus = response.status;
      const rawResponse = await response.text();
      try {
        generated = JSON.parse(rawResponse) as GeneratedResponse;
      } catch {
        throw new Error(
          `Monthly report route returned non-JSON HTTP ${response.status}: ${rawResponse}`
        );
      }
      if (!response.ok) {
        throw new Error(
          `Monthly report route returned HTTP ${response.status}: ${generated.error ?? rawResponse}`
        );
      }
      if (!generated.reportId || !generated.content) {
        throw new Error("Monthly report route did not return a saved report and content.");
      }
    }

    const savedResult = await service
      .from("reports")
      .select(
        "id, client_id, type, title, status, ai_content, final_content, created_by, created_at, sent_at"
      )
      .eq("id", generated.reportId)
      .single();
    if (savedResult.error || !savedResult.data) {
      throw savedResult.error ?? new Error("Saved report row was not found.");
    }

    if (!existingReportId) {
      const after = await service
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("type", "monthly");
      if (after.error) throw after.error;
      monthlyRowsAfter = after.count ?? 0;
    }

    const saved = savedResult.data;
    const content = saved.final_content ?? "";
    const placeholders = findReportPlaceholders(content);
    const expectedDate = formatReportDate();

    assert.equal(saved.client_id, clientId);
    assert.equal(saved.type, "monthly");
    assert.equal(saved.status, "draft");
    assert.equal(saved.sent_at, null);
    assert.ok(saved.created_by);
    assert.ok(saved.ai_content);
    assert.ok(saved.final_content);
    assert.equal(saved.ai_content, saved.final_content);
    if (generated.content) assert.equal(generated.content, saved.final_content);
    assert.deepEqual(placeholders, []);
    if (monthlyRowsBefore !== null && monthlyRowsAfter !== null) {
      assert.equal(monthlyRowsAfter, monthlyRowsBefore + 1);
    }

    for (const expected of [
      expectedDate,
      "582",
      "599",
      "17",
      "123",
      "113",
      "39375A3TAOLTIS",
      "3965BHWSL",
      "6103911",
      "6123719",
      PREPARER_BLOCK,
    ]) {
      assert.ok(content.includes(expected), `Report is missing expected text: ${expected}`);
    }
    assert.match(content, /wheel seal/i);
    assert.match(content, /crash preventability/i);
    assert.match(content, /39530B1|ELD/i);
    assert.match(content, /6103911[\s\S]{0,120}filed|filed[\s\S]{0,120}6103911/i);
    assert.match(content, /6123719[\s\S]{0,120}filed|filed[\s\S]{0,120}6123719/i);
    assert.match(content, /39375A3TAOLTIS[\s\S]{0,500}severity weight(?:\s|\*)*(?:of(?:\s|\*)*)?8/i);
    assert.match(content, /3965BHWSL[\s\S]{0,500}severity weight(?:\s|\*)*(?:of(?:\s|\*)*)?2/i);
    assert.match(content, /39375A3TAOLTIS[\s\S]{0,600}OOS(?:\s|\*)*(?:value(?:\s|\*)*)?no/i);
    assert.match(content, /3965BHWSL[\s\S]{0,600}OOS(?:\s|\*)*(?:value(?:\s|\*)*)?yes/i);
    assert.match(content, /June 19, 2026|2026-06-19/);

    console.log(
      JSON.stringify(
        {
          routeStatus,
          reportId: saved.id,
          generationAttempts: generated.generationAttempts,
          monthlyRowsBefore,
          monthlyRowsAfter,
          placeholderMatches: placeholders,
          savedRow: {
            id: saved.id,
            client_id: saved.client_id,
            type: saved.type,
            title: saved.title,
            status: saved.status,
            ai_content_non_null: saved.ai_content !== null,
            final_content_non_null: saved.final_content !== null,
            contents_identical: saved.ai_content === saved.final_content,
            created_by: saved.created_by,
            created_at: saved.created_at,
            sent_at: saved.sent_at,
          },
          fullReportText: content,
        },
        null,
        2
      )
    );
  } finally {
    await session?.revoke();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
