import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = (process.argv[2] ?? "https://safescore.vercel.app").replace(
  /\/$/,
  ""
);
const reportId = process.argv[3];
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

if (!reportId) {
  throw new Error(
    "Usage: npx tsx scripts/verify-report-review-routes.ts <base-url> <new-report-id>"
  );
}

type ReportFingerprint = {
  id: string;
  status: string;
  aiContentHash: string;
  finalContentHash: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

function digest(value: string | null) {
  return createHash("sha256").update(value ?? "").digest("hex");
}

function fingerprint(row: {
  id: string;
  status: string;
  ai_content: string | null;
  final_content: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}): ReportFingerprint {
  return {
    id: row.id,
    status: row.status,
    aiContentHash: digest(row.ai_content),
    finalContentHash: digest(row.final_content),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  };
}

async function fetchHtml(path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    html: await response.text(),
  };
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const reportColumns =
    "id, status, ai_content, final_content, reviewed_by, reviewed_at";
  const beforeResult = await service
    .from("reports")
    .select(reportColumns)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (beforeResult.error) throw beforeResult.error;

  const beforeRows = beforeResult.data ?? [];
  const newReport = beforeRows.find((row) => row.id === reportId);
  assert.ok(newReport, "The generated report was not found.");
  const legacy = beforeRows.find(
    (row) =>
      row.id !== reportId &&
      row.status === "reviewed" &&
      row.final_content === null
  );
  assert.ok(legacy, "A reviewed legacy report with null content was not found.");
  const before = beforeRows.map(fingerprint);
  const session = await createDeployedStaffSession(baseUrl);

  try {
    const historyPath = `/console/clients/${clientId}/reports`;
    const detailPath = `${historyPath}/${reportId}`;
    const printPath = `${detailPath}/print`;
    const legacyPath = `${historyPath}/${legacy.id}`;
    const legacyPrintPath = `${legacyPath}/print`;

    const [history, detail, print, legacyDetail, legacyPrint, account] =
      await Promise.all([
        fetchHtml(historyPath, session.cookie),
        fetchHtml(detailPath, session.cookie),
        fetchHtml(printPath, session.cookie),
        fetchHtml(legacyPath, session.cookie),
        fetchHtml(legacyPrintPath, session.cookie),
        fetchHtml(`/console/clients/${clientId}/account`, session.cookie),
      ]);

    for (const page of [
      history,
      detail,
      print,
      legacyDetail,
      legacyPrint,
      account,
    ]) {
      assert.equal(page.status, 200);
    }
    assert.ok(history.html.includes(detailPath));
    for (const text of [
      "Burden Trend",
      "Diagnostic Snapshot",
      "Priority Findings",
      "Open Challenges",
      "Edit final copy",
      "Mark reviewed",
      "Print view",
    ]) {
      assert.ok(detail.html.includes(text), `Detail route is missing: ${text}`);
    }
    assert.ok(print.html.includes("Print / Save PDF"));
    assert.ok(print.html.includes("Burden Trend"));
    assert.ok(
      legacyDetail.html.includes("No content recorded for this report.")
    );
    assert.ok(
      legacyPrint.html.includes("No content recorded for this report.")
    );
    assert.ok(account.html.includes("Total Safety"));

    const unauthenticated = await fetch(`${baseUrl}${detailPath}`, {
      redirect: "manual",
    });
    assert.ok([302, 303, 307, 308].includes(unauthenticated.status));
    assert.match(unauthenticated.headers.get("location") ?? "", /\/login/);

    const unauthenticatedAction = await fetch(
      `${baseUrl}/api/reports/${reportId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          action: "save",
          finalContent: "This request must not be authorized.",
        }),
      }
    );
    assert.equal(unauthenticatedAction.status, 401);

    const guardedDelete = await fetch(
      `${baseUrl}/api/reports/${legacy.id}`,
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientId }),
      }
    );
    assert.equal(guardedDelete.status, 409);
    const guardedDeleteBody = (await guardedDelete.json()) as {
      error?: string;
    };
    assert.equal(guardedDeleteBody.error, "Only draft reports can be deleted");

    const obsoleteRootRoute = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ clientId }),
    });
    assert.ok([404, 405].includes(obsoleteRootRoute.status));

    const afterResult = await service
      .from("reports")
      .select(reportColumns)
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    if (afterResult.error) throw afterResult.error;
    const after = (afterResult.data ?? []).map(fingerprint);
    assert.deepEqual(after, before, "Route verification mutated a report row.");

    console.log(
      JSON.stringify(
        {
          baseUrl,
          history: {
            status: history.status,
            reportLink: detailPath,
            linkRendered: history.html.includes(detailPath),
          },
          generatedReportDetail: {
            status: detail.status,
            renderedText: [
              "Burden Trend",
              "Diagnostic Snapshot",
              "Priority Findings",
              "Open Challenges",
              "Edit final copy",
              "Mark reviewed",
              "Print view",
            ],
          },
          generatedReportPrint: {
            status: print.status,
            renderedText: ["Print / Save PDF", "Burden Trend"],
          },
          legacyNoContent: {
            reportId: legacy.id,
            detailStatus: legacyDetail.status,
            printStatus: legacyPrint.status,
            renderedText: "No content recorded for this report.",
          },
          account: {
            status: account.status,
            renderedPlanLabel: "Total Safety",
          },
          enforcement: {
            unauthenticatedDetailStatus: unauthenticated.status,
            unauthenticatedDetailLocation:
              unauthenticated.headers.get("location"),
            unauthenticatedPatchStatus: unauthenticatedAction.status,
            reviewedDeleteStatus: guardedDelete.status,
            reviewedDeleteError: guardedDeleteBody.error,
            obsoleteRootRouteStatus: obsoleteRootRoute.status,
          },
          dataMutationCheck: {
            before,
            after,
            identical: true,
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
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
