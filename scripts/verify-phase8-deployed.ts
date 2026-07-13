import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { createDeployedStaffSession } from "./lib/deployed-staff-session";

loadEnvConfig(process.cwd());

const baseUrl = process.env.SAFESCORE_BASE_URL ?? "https://safescore.vercel.app";
const clientId = "95139fb1-2d8d-4e1e-b90b-45e47fef08ae";
const reportNumber = "TEST-P8-GROUNDED-NARRATIVE";
const inspectionDate = "2026-06-15";
const storagePath = `${clientId}/phase8-grounding-fixture.pdf`;
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11 },
  heading: { fontSize: 17, marginBottom: 18 },
  row: { marginBottom: 9 },
  warning: { marginTop: 18, fontSize: 9 },
});

function EvidencePdf() {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: styles.page },
      React.createElement(Text, { style: styles.heading }, "Synthetic carrier-assignment evidence"),
      React.createElement(View, { style: styles.row }, React.createElement(Text, null, "Inspection date: June 15, 2026")),
      React.createElement(View, { style: styles.row }, React.createElement(Text, null, "Inspection report: TEST-P8-GROUNDED-NARRATIVE")),
      React.createElement(View, { style: styles.row }, React.createElement(Text, null, "USDOT recorded in SafeScore: 0000001")),
      React.createElement(View, { style: styles.row }, React.createElement(Text, null, "USDOT displayed on the source inspection document: 7654321")),
      React.createElement(View, { style: styles.row }, React.createElement(Text, null, "Violation code recorded: 395.8A-ELD")),
      React.createElement(Text, { style: styles.warning }, "Synthetic fixture only. Not a real carrier record or filing."),
    )
  );
}

async function main() {
  let inspectionId: string | undefined;
  let caseId: string | undefined;
  const staff = await createDeployedStaffSession(baseUrl);
  try {
    await service.from("inspections").delete().eq("client_id", clientId).eq("report_number", reportNumber);
    const inspection = await service.from("inspections").insert({
      client_id: clientId,
      dot_number: "0000001",
      report_number: reportNumber,
      inspection_date: inspectionDate,
      state: "CA",
      level: "1",
      facility_name: "Synthetic Scale Facility",
      total_violations: 1,
      oos_violations: 0,
    }).select("id").single();
    if (inspection.error) throw inspection.error;
    inspectionId = inspection.data.id;

    const violation = await service.from("violations").insert({
      client_id: clientId,
      inspection_id: inspectionId,
      violation_code: "395.8A-ELD",
      violation_description: "Synthetic ELD record attributed to the wrong carrier",
      basic_category: "hos_compliance",
      severity_weight: 5,
      oos_violation: false,
      convicted: false,
      challengeable: true,
      challenge_reason: "The inspection was assigned to the wrong carrier USDOT number.",
      challenge_priority: "high",
    }).select("id").single();
    if (violation.error) throw violation.error;

    const dataqCase = await service.from("dataq_cases").insert({
      client_id: clientId,
      inspection_id: inspectionId,
      violation_id: violation.data.id,
      case_number: "TEST-P8-NARRATIVE",
      status: "draft",
      priority: "high",
      canonical_inspection_date: inspectionDate,
    }).select("id").single();
    if (dataqCase.error) throw dataqCase.error;
    caseId = dataqCase.data.id;

    const pdf = await renderToBuffer(React.createElement(EvidencePdf));
    const upload = await service.storage.from("dataq-evidence").upload(storagePath, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    const evidence = await service.from("dataq_evidence").insert({
      case_id: caseId,
      doc_type: "synthetic_carrier_assignment",
      label: "Synthetic source inspection document",
      context_note: "Phase 8 evidence-grounding gate",
      fmcsa_category: "Inspection report",
      required: true,
      status: "received",
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      uploaded_by: "geia",
    });
    if (evidence.error) throw evidence.error;

    const guidanceResponse = await fetch(`${baseUrl}/console/clients/${clientId}/remediation`, {
      headers: { cookie: staff.cookie },
      redirect: "manual",
    });
    const guidanceHtml = await guidanceResponse.text();
    const guidanceProof = {
      status: guidanceResponse.status,
      whatNext: guidanceHtml.includes("What next"),
      casesOpen: guidanceHtml.includes("Cases open"),
      laneA: guidanceHtml.includes("CPDP"),
      laneB: guidanceHtml.includes("DataQs"),
      laneC: guidanceHtml.includes("Operational burden"),
      investigateCaveat: guidanceHtml.includes("evidence is needed, not that the violation is removable"),
    };
    if (guidanceResponse.status !== 200 || Object.values(guidanceProof).includes(false)) {
      throw new Error(`Guidance proof failed: ${JSON.stringify(guidanceProof)}`);
    }

    const response = await fetch(`${baseUrl}/api/cases/dataq/${caseId}`, {
      method: "POST",
      headers: { cookie: staff.cookie },
    });
    const body = await response.json();
    if (!response.ok || typeof body.narrative !== "string") {
      throw new Error(`Narrative route failed: ${response.status} ${JSON.stringify(body)}`);
    }
    const saved = await service.from("dataq_cases")
      .select("canonical_inspection_date,dataqs_reason_code,ai_narrative")
      .eq("id", caseId)
      .single();
    if (saved.error) throw saved.error;
    const narrative = body.narrative as string;
    const proof = {
      routeStatus: response.status,
      canonicalInspectionDate: saved.data.canonical_inspection_date,
      reasonCode: saved.data.dataqs_reason_code,
      mentionsRecordedDot: narrative.includes("0000001"),
      mentionsSourceDot: narrative.includes("7654321"),
      mentionsInspectionDate: narrative.includes("June 15, 2026") || narrative.includes("2026-06-15"),
      rejectedAsInsufficient: narrative.startsWith("INSUFFICIENT EVIDENCE"),
    };
    if (
      proof.canonicalInspectionDate !== inspectionDate ||
      proof.reasonCode !== "company_incorrect" ||
      !proof.mentionsRecordedDot ||
      !proof.mentionsSourceDot ||
      !proof.mentionsInspectionDate ||
      proof.rejectedAsInsufficient
    ) {
      throw new Error(`Narrative grounding proof failed: ${JSON.stringify(proof)}\n${narrative}`);
    }
    console.log(JSON.stringify({ guidance: guidanceProof, narrativeProof: proof, narrative }, null, 2));
  } finally {
    if (caseId) await service.from("dataq_cases").delete().eq("id", caseId);
    if (inspectionId) await service.from("inspections").delete().eq("id", inspectionId);
    await service.storage.from("dataq-evidence").remove([storagePath]);
    await staff.revoke();
    const [caseCount, inspectionCount, storageList] = await Promise.all([
      service.from("dataq_cases").select("id", { count: "exact", head: true }).eq("case_number", "TEST-P8-NARRATIVE"),
      service.from("inspections").select("id", { count: "exact", head: true }).eq("report_number", reportNumber),
      service.storage.from("dataq-evidence").list(clientId, { search: "phase8-grounding-fixture.pdf" }),
    ]);
    console.log(JSON.stringify({ cleanup: { cases: caseCount.count, inspections: inspectionCount.count, storageObjects: storageList.data?.length ?? null } }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
