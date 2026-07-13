import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";
import { createDeployedClientSession } from "./lib/deployed-client-session";

loadEnvConfig(process.cwd());

const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const clientEmail = "safescore-phase11-acme@example.com";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type RouteResult = {
  route: string;
  status: number;
  finalPath: string;
  bytes: number;
  rendered: boolean;
};

async function fetchRoute(route: string, cookie: string): Promise<RouteResult> {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie }, redirect: "follow" });
  const body = await response.text();
  const badMarkers = ["Internal Server Error", "Application error", "This page could not be found"];
  return {
    route,
    status: response.status,
    finalPath: new URL(response.url).pathname,
    bytes: Buffer.byteLength(body),
    rendered: body.length > 500 && !badMarkers.some((marker) => body.includes(marker)),
  };
}

async function main() {
  const { data: cpdpCase } = await service.from("cpdp_cases")
    .select("id,client_id,crashes!inner(id)")
    .limit(1)
    .maybeSingle();

  const staffRoutes = [
    "/console",
    "/console/activity",
    "/console/assess/2533650",
    ...["", "/account", "/cases", "/compliance", "/cpdp", "/dataq", "/monitoring", "/remediation", "/reports", "/requests", "/violations"]
      .map((suffix) => `/console/clients/${nationwideId}${suffix}`),
    ...(cpdpCase ? [`/console/clients/${cpdpCase.client_id}/cpdp/${cpdpCase.id}`] : []),
  ];
  if (!cpdpCase) throw new Error("No CPDP case with crash exists for the dynamic route gate");

  const portalRoutes = [
    "/portal",
    "/portal/cases",
    "/portal/documents",
    "/portal/onboarding",
    "/portal/onboarding/success",
    "/portal/plan",
    "/portal/profile",
    "/portal/reports",
    "/portal/requests",
    "/portal/safety",
    "/onboarding",
    "/onboarding/success",
  ];

  const staff = await createDeployedStaffSession(baseUrl);
  const client = await createDeployedClientSession(baseUrl, clientEmail);
  try {
    const staffResults: RouteResult[] = [];
    for (const route of staffRoutes) staffResults.push(await fetchRoute(route, staff.cookie));
    const portalResults: RouteResult[] = [];
    for (const route of portalRoutes) portalResults.push(await fetchRoute(route, client.cookie));
    const failed = [...staffResults, ...portalResults].filter((row) => row.status !== 200 || !row.rendered);

    const unauthPage = await fetch(`${baseUrl}/console`, { redirect: "manual" });
    const unauthApi = await fetch(`${baseUrl}/api/cases/dataq/not-a-case`, { method: "POST", redirect: "manual" });
    const clientConsole = await fetch(`${baseUrl}/console`, { headers: { cookie: client.cookie }, redirect: "manual" });
    const clientStaffApi = await fetch(`${baseUrl}/api/requests/reminders`, { method: "POST", headers: { cookie: client.cookie }, redirect: "manual" });
    const staffPortal = await fetch(`${baseUrl}/portal`, { headers: { cookie: staff.cookie }, redirect: "manual" });
    const staffPortalApi = await fetch(`${baseUrl}/api/portal/me`, { headers: { cookie: staff.cookie }, redirect: "manual" });
    const authBoundaries = {
      unauthenticatedConsole: unauthPage.status,
      unauthenticatedProtectedApi: unauthApi.status,
      clientToConsole: clientConsole.status,
      clientToStaffApi: clientStaffApi.status,
      staffToPortal: staffPortal.status,
      staffToPortalApi: staffPortalApi.status,
    };
    const expected = {
      unauthenticatedConsole: 307,
      unauthenticatedProtectedApi: 401,
      clientToConsole: 307,
      clientToStaffApi: 403,
      staffToPortal: 307,
      staffToPortalApi: 403,
    };
    if (failed.length > 0 || JSON.stringify(authBoundaries) !== JSON.stringify(expected)) {
      throw new Error(JSON.stringify({ failed, authBoundaries, expected }, null, 2));
    }
    console.log(JSON.stringify({ staffRoutes: staffResults, portalRoutes: portalResults, authBoundaries }, null, 2));
  } finally {
    await staff.revoke();
    await client.revoke();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
