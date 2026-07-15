import { loadEnvConfig } from "@next/env";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const clientId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";

async function page(path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: response.status, html: await response.text() };
}

async function main() {
  const staff = await createDeployedStaffSession(baseUrl);
  try {
    const [existing, fresh, client] = await Promise.all([
      page("/console/assess/2533650", staff.cookie),
      page("/console/assess/80806", staff.cookie),
      page(`/console/clients/${clientId}`, staff.cookie),
    ]);
    const [oosResponse, jbhOosResponse] = await Promise.all([
      fetch(`${baseUrl}/api/fmcsa/oos/2533650`, { headers: { cookie: staff.cookie } }),
      fetch(`${baseUrl}/api/fmcsa/oos/80806`, { headers: { cookie: staff.cookie } }),
    ]);
    const [oos, jbhOos] = await Promise.all([oosResponse.json(), jbhOosResponse.json()]);
    const oosData = oos.oos;
    const hazmatAt = existing.html.indexOf("Hazmat OOS rate");
    const hazmatFragment = hazmatAt >= 0 ? existing.html.slice(hazmatAt, hazmatAt + 500) : "";
    const renderedHazmat = hazmatFragment.replaceAll("<!-- -->", "");
    const jbhHazmatAt = fresh.html.indexOf("Hazmat OOS rate");
    const jbhHazmatFragment = jbhHazmatAt >= 0 ? fresh.html.slice(jbhHazmatAt, jbhHazmatAt + 350) : "";

    const invalidUpload = new FormData();
    invalidUpload.set("evidence_id", "00000000-0000-4000-8000-000000000000");
    invalidUpload.set("file", new Blob(["round-1 invalid-token proof"], { type: "text/plain" }), "proof.txt");
    const [nonRoute, invalidToken, extraSegment] = await Promise.all([
      fetch(`${baseUrl}/api/evidence/not-a-route`, { redirect: "manual" }),
      fetch(`${baseUrl}/api/evidence/not-a-token/upload`, { method: "POST", body: invalidUpload, redirect: "manual" }),
      fetch(`${baseUrl}/api/evidence/not-a-token/upload/extra`, { redirect: "manual" }),
    ]);

    const proof = {
      existingDot: {
        status: existing.status,
        existingState: existing.html.includes("Already a SafeScore client"),
        clientLink: existing.html.includes(`/console/clients/${clientId}`),
        addFormAbsent: !existing.html.includes("Add as SafeScore client"),
        hazmatCurrent100: renderedHazmat.includes(`${oosData.hazmatOosRate}%`),
        hazmatBenchmark: renderedHazmat.includes(`National avg: ${oosData.nationalHazmatOosRate}%`),
        hazmatAmber: oosData.hazmatOosRate > oosData.nationalHazmatOosRate && hazmatFragment.includes("text-[#C67A1E]"),
        oosApiStatus: oosResponse.status,
        hazmatRate: oosData.hazmatOosRate,
        nationalHazmatRate: oosData.nationalHazmatOosRate,
        hazmatFragment,
      },
      newDot: {
        status: fresh.status,
        addForm: fresh.html.includes("Add as SafeScore client"),
        existingStateAbsent: !fresh.html.includes("Already a SafeScore client"),
        jbhHazmatZero: jbhOos.oos.hazmatOosRate === 0 && jbhHazmatFragment.includes("0%"),
        jbhHazmatGreen: jbhHazmatFragment.includes("text-green-600"),
        jbhOosApiStatus: jbhOosResponse.status,
        jbhHazmatRate: jbhOos.oos.hazmatOosRate,
      },
      clientFile: {
        status: client.status,
        fullAuthority: client.html.includes("AUTHORIZED FOR: Motor Carrier of Property (Except Household Goods)"),
        reconciliationLabels: [
          "In-window weighted burden (points)",
          "Scored violations (count)",
          "Potential removal impact (points)",
        ].every((label) => client.html.includes(label)),
        challengeAction: client.html.includes("Re-run challengeability analysis"),
        uploadControlNamed: client.html.includes('id="fmcsa-export-file"') && client.html.includes('name="fmcsa_export_file"'),
      },
      evidenceBoundary: {
        nonRoute: nonRoute.status,
        invalidToken: invalidToken.status,
        extraSegment: extraSegment.status,
      },
    };

    const allTrue = Object.entries(proof).every(([, group]) =>
      Object.entries(group).every(([key, value]) =>
        key === "status" || key.endsWith("Status") || key.endsWith("Route") || key.endsWith("Token") || key.endsWith("Segment") || key.endsWith("Rate") || key === "hazmatFragment"
          ? true
          : value === true
      )
    );
    const expectedStatuses = existing.status === 200 && fresh.status === 200 && client.status === 200 &&
      nonRoute.status === 401 && invalidToken.status === 404 && extraSegment.status === 401;
    console.log(JSON.stringify(proof, null, 2));
    if (!allTrue || !expectedStatuses) process.exitCode = 1;
  } finally {
    await staff.revoke();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
