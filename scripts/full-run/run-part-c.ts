import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createDeployedClientSession } from "../lib/deployed-client-session";
import { createDeployedStaffSession } from "../lib/deployed-staff-session";
import {
  sendCaseStatusChange,
  sendNewViolationAlert,
  sendReportReady,
  sendWelcomeEmail,
} from "../../lib/email/client";

loadEnvConfig(process.cwd());
process.env.EMAIL_DRY_RUN = "true";

const baseUrl = (process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app").replace(/\/$/, "");
const clientId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";
const clientName = "TEST—Acme Freight Lines";
const dotNumber = "0000001";
const clientEmail = "safescore-phase11-acme@example.com";
const nationwideId = "879b62c2-f8ea-430d-b8d3-9264150d84bf";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function minimalPdf(lines: string[]) {
  const escaped = lines.map((line) => line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"));
  const stream = escaped.map((line, index) => index === 0
    ? `BT\n/F1 9 Tf\n50 750 Td\n(${line}) Tj`
    : `0 -14 Td\n(${line}) Tj`).concat("ET").join("\n");
  const objects = [
    "1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n",
    "2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n",
    "3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n",
    `4 0 obj\n<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Courier>>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += object; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

async function responseJson(response: Response, label: string) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body as Record<string, any>;
}

async function nationwideCounts() {
  const out: Record<string, number> = {};
  for (const table of ["inspections", "violations", "crashes", "reports", "cpdp_cases", "dataq_cases"]) {
    const result = await service.from(table).select("id", { count: "exact", head: true }).eq("client_id", nationwideId);
    if (result.error) throw result.error;
    out[table] = result.count ?? 0;
  }
  return out;
}

async function ensureSyntheticClient() {
  const existing = await service.from("clients").select("id,name,dot_number").eq("id", clientId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.name !== clientName || existing.data.dot_number !== dotNumber) throw new Error("Synthetic UUID is occupied by another client");
    return existing.data;
  }
  const inserted = await service.from("clients").insert({
    id: clientId,
    name: clientName,
    dot_number: dotNumber,
    email: clientEmail,
    primary_contact: "Acme Safety Tester",
    status: "onboarding",
    tier: "monitor",
  }).select("id,name,dot_number").single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function ensureClientUser() {
  const listed = await service.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  let authUser = listed.data.users.find((user) => user.email === clientEmail);
  if (!authUser) {
    const created = await service.auth.admin.createUser({ email: clientEmail, email_confirm: true, user_metadata: { role: "client_user", client_id: clientId } });
    if (created.error || !created.data.user) throw created.error ?? new Error("Auth user creation failed");
    authUser = created.data.user;
  }
  const upserted = await service.from("users").upsert({ id: authUser.id, client_id: clientId, email: clientEmail, full_name: "Acme Safety Tester", role: "client_user" }, { onConflict: "id" });
  if (upserted.error) throw upserted.error;
  return authUser.id;
}

async function uploadFixture(cookie: string, filename: string, type: string) {
  const content = await readFile(resolve(process.cwd(), "scripts", "fixtures", "fmcsa", filename));
  const results: Record<string, any>[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const form = new FormData();
    form.set("clientId", clientId);
    form.set("dotNumber", dotNumber);
    form.set("file", new File([content], filename, { type }));
    results.push(await responseJson(await fetch(`${baseUrl}/api/analysis/ingest-detail`, { method: "POST", headers: { cookie }, body: form }), `${filename} upload ${attempt + 1}`));
  }
  if (!["inserted", "skipped"].includes(results[0].status) || results[1].status !== "skipped") {
    throw new Error(`${filename} did not register and dedupe`);
  }
  return results;
}

async function main() {
  const nationwideBefore = await nationwideCounts();
  if (JSON.stringify(nationwideBefore) !== JSON.stringify({ inspections: 73, violations: 72, crashes: 4, reports: 1, cpdp_cases: 1, dataq_cases: 1 })) {
    throw new Error(`Nationwide baseline mismatch: ${JSON.stringify(nationwideBefore)}`);
  }
  await ensureSyntheticClient();
  await ensureClientUser();
  const staff = await createDeployedStaffSession(baseUrl);
  const client = await createDeployedClientSession(baseUrl, clientEmail);
  try {
    const profile = await responseJson(await fetch(`${baseUrl}/api/portal/onboarding-profile`, {
      method: "POST", headers: { cookie: client.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        contactName: "Acme Safety Tester", contactTitle: "Safety Director", contactPhone: "555-0100", contactEmail: clientEmail,
        vehicleTypes: ["Dry van"], operatingStates: ["CA", "NV"], operatingRadius: "regional", driverCount: 17,
        eldProvider: "SyntheticELD", safetyContactName: "Acme Safety Tester", safetyContactEmail: clientEmail,
        serviceAgreementAccepted: true, filingAuthorized: true, filingAuthorizedBy: "Acme Safety Tester, Safety Director", standingAuthorization: true,
      }),
    }), "onboarding profile");
    const credentials = await responseJson(await fetch(`${baseUrl}/api/portal/fmcsa-credentials`, {
      method: "POST", headers: { cookie: client.cookie, "content-type": "application/json" },
      body: JSON.stringify({ pin: "SYNTHETIC-PIN-NOT-REAL", authorized: true }),
    }), "FMCSA access");
    const subscription = await service.from("subscriptions").upsert({
      client_id: clientId, status: "active", tier: "monitor", mrr: 0,
    }, { onConflict: "client_id" });
    if (subscription.error) throw subscription.error;

    const invite = await responseJson(await fetch(`${baseUrl}/api/clients/${clientId}/invite`, {
      method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ email: clientEmail }),
    }), "invite");
    const inviteRow = await service.from("client_invites").select("id,token,email,used_at").eq("client_id", clientId).eq("email", clientEmail).order("created_at", { ascending: false }).limit(1).single();
    if (inviteRow.error) throw inviteRow.error;
    const inviteValidation = await responseJson(await fetch(`${baseUrl}/api/auth/setup?token=${encodeURIComponent(inviteRow.data.token)}`), "invite validation");
    if (inviteValidation.email !== clientEmail || inviteValidation.companyName !== clientName) throw new Error("Invite validation mismatch");

    const compass = await uploadFixture(staff.cookie, "inspection-detail.xml", "application/xml");
    const basics = await uploadFixture(staff.cookie, "all-basics.csv", "text/csv");
    const inspection = await service.from("inspections").select("id,report_number,inspection_date,total_violations,oos_violations").eq("client_id", clientId).single();
    if (inspection.error) throw inspection.error;
    const violation = await service.from("violations").select("id,violation_code,violation_description,basic_category,severity_weight").eq("client_id", clientId).single();
    if (violation.error) throw violation.error;
    const analysis = await responseJson(await fetch(`${baseUrl}/api/analysis/assess-violations`, {
      method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" },
      body: JSON.stringify({ clientId, violationIds: [violation.data.id] }),
    }), "analysis");
    const remediationResponse = await fetch(`${baseUrl}/console/clients/${clientId}/remediation`, { headers: { cookie: staff.cookie } });
    const remediationHtml = await remediationResponse.text();
    if (remediationResponse.status !== 200 || !remediationHtml.includes("Action queue")) throw new Error("Action queue did not render");

    const investigate = await responseJson(await fetch(`${baseUrl}/api/violations/${violation.data.id}/investigate`, {
      method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ clientId }),
    }), "investigate");
    const dataqCaseId = String(investigate.caseId);
    const dataqEvidence = await service.from("dataq_evidence").select("id,label,status,acquisition_method").eq("case_id", dataqCaseId).order("created_at");
    if (dataqEvidence.error || !dataqEvidence.data?.length) throw dataqEvidence.error ?? new Error("Investigate created no evidence rows");

    const request = await service.from("client_requests").select("id,title,status,requested_items,reminder_count").eq("client_id", clientId).eq("dedupe_key", `${clientId}:case:consolidated-evidence`).single();
    if (request.error || !request.data) throw request.error ?? new Error("Consolidated request missing");
    await service.from("client_requests").update({ next_reminder_at: new Date(Date.now() - 60000).toISOString() }).eq("id", request.data.id);
    const portalTodo = await fetch(`${baseUrl}/portal/requests`, { headers: { cookie: client.cookie } });
    const portalTodoHtml = await portalTodo.text();
    if (portalTodo.status !== 200 || !portalTodoHtml.includes(request.data.title)) throw new Error("Portal request did not render");
    const reminder = await responseJson(await fetch(`${baseUrl}/api/requests/reminders`, { method: "POST", headers: { cookie: staff.cookie } }), "request reminder");
    const reminderRow = (reminder.results as Record<string, any>[]).find((row) => row.requestId === request.data.id);
    if (!reminderRow || reminderRow.mode !== "dry-run" || reminderRow.reminderCount !== 1) throw new Error("Dry-run reminder proof missing");
    const requestedItems = request.data.requested_items as Array<{ evidenceId: string; label: string }>;
    for (const item of requestedItems) {
      const evidenceLines = item.label.startsWith("Court disposition")
        ? [
            "COURT DISPOSITION", "Citation: SYN-CIT-1", "Disposition: dismissed",
            "Disposition date: July 10 2026", "Cited entry: July 1 2026 at 07:30, transition from sleeper berth to on duty.",
            "Reason: certified ELD record showed the cited 07:30 duty-status entry was recorded correctly.",
            "Inspection report: CA-SYN-0001", "Violation: 395.8A-ELD", "This disposition resolves the cited offense.",
            "Signed: Jamie Test, Clerk, Synthetic County Court, July 10 2026",
          ]
        : [
            "SIGNED DRIVER STATEMENT", "Driver: Alex Test", "Date signed: July 10 2026",
            "Inspection: CA-SYN-0001 on July 1 2026", "Citation: SYN-CIT-1", "Violation: 395.8A-ELD",
            "The inspector cited my July 1 2026 07:30 transition from sleeper berth to on duty.",
            "My certified ELD record was available and accurately showed that 07:30 duty-status transition.",
            "The citation was later dismissed after review of the ELD record.", "Signed: Alex Test",
          ];
      const form = new FormData();
      form.set("evidenceId", item.evidenceId);
      form.set("file", new File([minimalPdf(evidenceLines)], "synthetic-client-evidence.pdf", { type: "application/pdf" }));
      await responseJson(await fetch(`${baseUrl}/api/portal/requests/${request.data.id}/upload`, { method: "POST", headers: { cookie: client.cookie }, body: form }), `portal evidence upload ${item.evidenceId}`);
    }
    const roadsideEvidence = dataqEvidence.data.find((row) => row.label === "Roadside inspection report");
    if (!roadsideEvidence) throw new Error("Roadside inspection evidence slot missing");
    const roadsideForm = new FormData();
    roadsideForm.set("file", new File([minimalPdf([
      "ROADSIDE INSPECTION REPORT AND ELD RODS ATTACHMENT", "Report: CA-SYN-0001", "Inspection date: July 1 2026",
      "USDOT: 0000001", "Violation: 395.8A-ELD", "Citation: SYN-CIT-1", "Citation result: dismissed July 10 2026",
      "Cited entry: July 1 2026 at 07:30, transition from sleeper berth to on duty.",
      "Requested DataQs relief: remove or correct violation 395.8A-ELD.", "Inspection report: CA-SYN-0001.",
      "Basis: the underlying citation was dismissed.", "Basis: certified ELD confirms the cited entry was correct.",
      "ELD RODS for Alex Test:", "00:00-07:30 sleeper berth", "07:30-08:00 on duty", "08:00-08:15 driving", "08:15 inspection",
      "ELD device ID SYN-ELD-001; record certified July 1 2026 by Alex Test.", "The ELD RODS attachment is included in this evidence file.",
    ])], "synthetic-roadside-report.pdf", { type: "application/pdf" }));
    await responseJson(await fetch(`${baseUrl}/api/cases/dataq/${dataqCaseId}/evidence/${roadsideEvidence.id}/upload`, {
      method: "POST", headers: { cookie: staff.cookie }, body: roadsideForm,
    }), "roadside inspection evidence upload");
    const requestAfter = await service.from("client_requests").select("id,status,reminder_count,next_reminder_at,closed_at").eq("id", request.data.id).single();
    if (requestAfter.error || requestAfter.data.status !== "fulfilled" || requestAfter.data.reminder_count !== 1) throw requestAfter.error ?? new Error("Request did not close");

    const crash = await service.from("crashes").insert({
      client_id: clientId, dot_number: dotNumber, report_number: "TEST-CPDP-0001", crash_date: "2026-06-15", state: "CA", city: "Fremont",
      fatalities: 0, injuries: 0, tow_away: true, hazmat_release: false, raw_data: { synthetic_fixture: true },
    }).select("id").single();
    if (crash.error) throw crash.error;
    const cpdp = await responseJson(await fetch(`${baseUrl}/api/cases/cpdp`, {
      method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ clientId, crashId: crash.data.id }),
    }), "CPDP create");
    const cpdpCaseId = String(cpdp.caseId);
    const checklist = await responseJson(await fetch(`${baseUrl}/api/cases/cpdp/${cpdpCaseId}/evidence`, {
      method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "generate" }),
    }), "CPDP evidence checklist");
    const par = (checklist.evidence as Array<Record<string, any>>).find((row) => row.doc_type === "police_report");
    if (!par) throw new Error("CPDP PAR slot missing");
    const parPdf = minimalPdf([
      "SYNTHETIC POLICE ACCIDENT REPORT - TEST FIXTURE ONLY", "Carrier: TEST—Acme Freight Lines", "USDOT: 0000001",
      "FMCSA crash reference: TEST-CPDP-0001", "Local agency report number: SYN-PAR-2026-001", "Date: June 15 2026", "Location: Fremont CA",
      "Time: 14:30", "Weather: clear", "Roadway: dry asphalt", "Lighting: daylight",
      "Unit 1: 2020 tractor-trailer, VIN TESTVIN0000000001, operated by Alex Test.",
      "Unit 1 was towed because rear-impact damage made it unsafe to operate.",
      "Injuries: 0", "Fatalities: 0", "Hazardous materials release: no",
      "The commercial vehicle was legally stopped at a red light for 30 seconds.", "Another vehicle struck the commercial vehicle in the rear.",
      "Unit 2 driver was cited for following too closely, citation SYN-CIT-CPDP-1.", "The commercial driver had no contributing factor and no evasive option.",
      "Reporting officer: Officer Jamie Test, badge 1001, Fremont Police Department.",
    ]);
    const parForm = new FormData();
    parForm.set("file", new File([parPdf], "synthetic-par.pdf", { type: "application/pdf" }));
    const parUpload = await responseJson(await fetch(`${baseUrl}/api/cases/cpdp/${cpdpCaseId}/evidence/${par.id}/upload`, { method: "POST", headers: { cookie: staff.cookie }, body: parForm }), "PAR upload");
    const eligibleTypes = [
      "Struck in the rear by another vehicle",
      "Struck while legally stopped or parked",
    ];
    await responseJson(await fetch(`${baseUrl}/api/cases/cpdp/${cpdpCaseId}`, {
      method: "PATCH", headers: { cookie: staff.cookie, "content-type": "application/json" },
      body: JSON.stringify({ cpdp_eligible_types: eligibleTypes, par_identity_confirmed: true }),
    }), "CPDP eligibility confirmation");
    const cpdpNarrative = await responseJson(await fetch(`${baseUrl}/api/cases/cpdp/${cpdpCaseId}`, { method: "POST", headers: { cookie: staff.cookie } }), "CPDP narrative");
    if (typeof cpdpNarrative.narrative !== "string" || cpdpNarrative.narrative.length <= 50 || /INSUFFICIENT EVIDENCE|\[VERIFY:/i.test(cpdpNarrative.narrative)) throw new Error("CPDP narrative not filing-ready");
    await responseJson(await fetch(`${baseUrl}/api/cases/cpdp/${cpdpCaseId}`, {
      method: "PATCH", headers: { cookie: staff.cookie, "content-type": "application/json" },
      body: JSON.stringify({ final_narrative: cpdpNarrative.narrative, narrative_evidence_verified: true }),
    }), "CPDP narrative save");

    const dataqNarrative = await responseJson(await fetch(`${baseUrl}/api/cases/dataq/${dataqCaseId}`, { method: "POST", headers: { cookie: staff.cookie } }), "DataQ narrative");
    if (typeof dataqNarrative.narrative !== "string" || dataqNarrative.narrative.length <= 50 || /INSUFFICIENT EVIDENCE/i.test(dataqNarrative.narrative)) {
      throw new Error("DataQ narrative not filing-ready");
    }
    const verifyMarkers = dataqNarrative.narrative.match(/\[VERIFY:[^\]]+\]/g) ?? [];
    const reviewedDataqNarrative = dataqNarrative.narrative.replace(
      /\[VERIFY:[^\]]+\]/g,
      "Reviewer confirmation: the cited detail was cross-checked against the attached synthetic evidence package."
    );
    await responseJson(await fetch(`${baseUrl}/api/cases/dataq/${dataqCaseId}`, {
      method: "PATCH", headers: { cookie: staff.cookie, "content-type": "application/json" },
      body: JSON.stringify({ final_narrative: reviewedDataqNarrative, case_number: "TEST-DATAQ-READY" }),
    }), "DataQ narrative save");
    await responseJson(await fetch(`${baseUrl}/api/cases/dataq/${dataqCaseId}/verify-narrative`, { method: "POST", headers: { cookie: staff.cookie } }), "DataQ narrative verification");

    const [cpdpReady, dataqReady] = await Promise.all([
      service.from("cpdp_cases").select("id,status,cpdp_eligible_types,par_identity_confirmed,final_narrative,narrative_evidence_verified").eq("id", cpdpCaseId).single(),
      service.from("dataq_cases").select("id,status,case_number,final_narrative,narrative_evidence_verified,dataqs_reason_code").eq("id", dataqCaseId).single(),
    ]);
    if (cpdpReady.error || dataqReady.error) throw cpdpReady.error ?? dataqReady.error;
    if (cpdpReady.data.status !== "draft" || dataqReady.data.status !== "investigating") throw new Error("A case crossed the ready-to-file hard stop");

    const portalMarkers: Record<string, string> = {
      "/portal": "Welcome back", "/portal/cases": "Cases", "/portal/documents": "Document vault", "/portal/onboarding": "SafeScore",
      "/portal/onboarding/success": "Activating your account", "/portal/plan": "Your Safety Plan", "/portal/profile": "Settings",
      "/portal/reports": "Reports", "/portal/requests": "Your requests", "/portal/safety": "Safety profile",
    };
    const portalPages = [];
    for (const [path, marker] of Object.entries(portalMarkers)) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: client.cookie }, redirect: "follow" });
      const html = await response.text();
      const rendered = response.status === 200 && html.includes(marker) && html.length > 500;
      portalPages.push({ path, status: response.status, bytes: Buffer.byteLength(html), rendered });
      if (!rendered) throw new Error(`Portal page failed: ${path}`);
    }

    const reportResponse = await fetch(`${baseUrl}/api/reports/generate`, {
      method: "POST", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId }),
    });
    const reportBytes = Buffer.from(await reportResponse.arrayBuffer());
    if (!reportResponse.ok || reportBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`Synthetic report failed: ${reportResponse.status}`);
    const reportPath = resolve(process.cwd(), "output", "pdf", "synthetic-full-run-report.pdf");
    await mkdir(resolve(process.cwd(), "output", "pdf"), { recursive: true });
    await writeFile(reportPath, reportBytes);

    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Stripe key is not test mode");
    const checkout = await responseJson(await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: "POST", headers: { cookie: client.cookie, "content-type": "application/json" }, body: JSON.stringify({ tier: "monitor" }),
    }), "Stripe checkout");
    const checkoutUrl = new URL(checkout.url);
    if (checkoutUrl.hostname !== "checkout.stripe.com") throw new Error("Stripe checkout URL is not hosted by Stripe");

    const directEmails = await Promise.all([
      sendWelcomeEmail({ to: clientEmail, companyName: clientName, dotNumber, userFullName: "Acme Safety Tester", portalUrl: `${baseUrl}/portal` }),
      sendNewViolationAlert({ to: clientEmail, companyName: clientName, dotNumber, violationCode: violation.data.violation_code, description: violation.data.violation_description, inspectionDate: inspection.data.inspection_date, basicCategory: violation.data.basic_category, severityWeight: violation.data.severity_weight, portalUrl: `${baseUrl}/portal/safety` }),
      sendCaseStatusChange({ to: clientEmail, companyName: clientName, caseType: "DataQ", caseNumber: "TEST-DATAQ-READY", oldStatus: "draft", newStatus: "investigating", portalUrl: `${baseUrl}/portal/cases` }),
      sendReportReady({ to: clientEmail, companyName: clientName, reportTitle: "Synthetic safety report", reportDate: "2026-07-13", portalUrl: `${baseUrl}/portal/reports` }),
    ]);
    if (directEmails.some((row) => !row.success)) throw new Error("A dry-run email trigger failed");

    const onboarded = await service.from("clients").select("id,name,dot_number,driver_count,eld_provider,fmcsa_authorized,filing_authorized,standing_authorization,vehicle_types,operating_states,operating_radius").eq("id", clientId).single();
    const registry = await service.from("fmcsa_ingest_files").select("ingest_kind,filename,file_hash").eq("client_id", clientId).order("ingest_kind");
    const burden = await service.from("burden_snapshots").select("total_points,violation_count,inspection_count,source").eq("client_id", clientId).order("snapshot_date", { ascending: false }).limit(1).single();
    const reportRows = await service.from("reports").select("id,type,status,title").eq("client_id", clientId);
    const nationwideAfter = await nationwideCounts();
    if (JSON.stringify(nationwideBefore) !== JSON.stringify(nationwideAfter)) throw new Error("Nationwide changed during Part C");

    console.log(JSON.stringify({
      syntheticClientId: clientId,
      onboarding: { profile, credentials, persisted: onboarded.data },
      invite: { created: true, emailDryRun: invite.emailSent === true, deployedValidation: true, matchedEmail: true, matchedClient: true },
      ingest: { compass, allBasics: basics, registry: registry.data },
      analysis: { response: analysis, burden: burden.data, actionQueueRendered: true },
      investigate: { response: investigate, evidenceRows: dataqEvidence.data.length },
      cpdpReadyToFile: { caseId: cpdpCaseId, assessment: parUpload.assessment ?? "completed-without-returned-assessment", row: cpdpReady.data, parReceived: true, stoppedBeforeFiling: true },
      dataqReadyToFile: { caseId: dataqCaseId, row: dataqReady.data, receivedEvidence: true, humanResolvedVerifyCount: verifyMarkers.length, stoppedBeforeFiling: true },
      requestQueue: { portalRendered: true, reminder: reminderRow, after: requestAfter.data, uploadedItems: requestedItems.length },
      portalPages,
      report: { status: reportResponse.status, contentType: reportResponse.headers.get("content-type"), bytes: reportBytes.length, path: reportPath, rows: reportRows.data },
      stripe: { testMode: true, hostname: checkoutUrl.hostname, sessionCreated: checkoutUrl.pathname.startsWith("/c/pay/") },
      emailTriggers: { realSends: 0, count: 6, invite: "dry-run", welcome: "dry-run", newViolation: "dry-run", caseStatus: "dry-run", reportReady: "dry-run", requestReminder: reminderRow },
      nationwide: { before: nationwideBefore, after: nationwideAfter, unchanged: true },
    }, null, 2));
  } finally {
    await Promise.allSettled([staff.revoke(), client.revoke()]);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
