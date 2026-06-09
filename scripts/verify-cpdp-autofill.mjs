/**
 * CPDP PAR Auto-fill Verification Script
 * ----------------------------------------
 * Tests the PAR upload → eligibility assessment → DB persistence pipeline.
 * Uses two synthetic Police Accident Reports:
 *   1. Eligible fixture   — CMV stopped at red light, struck from behind
 *   2. At-fault fixture   — CMV driver ran stop sign, struck other vehicle
 *
 * Usage:
 *   node scripts/verify-cpdp-autofill.mjs [BASE_URL]
 *   BASE_URL defaults to https://safescore.app
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in env
 *   (or pass them as SUPABASE_URL and SUPABASE_KEY env vars)
 */

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.argv[2] ?? "https://safescore.app";

// ─── Live test case (case fff5abb0) ──────────────────────────────────────────
const CASE_ID = "fff5abb0-9667-4ab2-a12c-f84a359d9c3d";
const PAR_EVID_ID = "c1c8583a-5eef-4f2f-b682-a91658966e5d";

// ─── Minimal PDF builder ──────────────────────────────────────────────────────
// Generates a valid PDF-1.4 document with Courier text content.
// Claude's document reading extracts the text for grounding.
function buildMinimalPdf(text) {
  const lines = text.split("\n");

  const escapePdfText = (s) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const streamLines = lines.map((line, i) => {
    const safe = escapePdfText(line.trim());
    if (i === 0) {
      return `BT\n/F1 9 Tf\n50 750 Td\n(${safe}) Tj`;
    }
    return `0 -12 Td\n(${safe}) Tj`;
  });
  streamLines.push("ET");
  const stream = streamLines.join("\n");
  const streamLen = Buffer.byteLength(stream, "utf8");

  // Build object bodies
  const objs = [
    null,
    "1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n",
    "2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n",
    "3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n",
    `4 0 obj\n<</Length ${streamLen}>>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Courier>>\nendobj\n",
  ];

  const header = "%PDF-1.4\n";
  let buf = header;
  const offsets = [];

  for (let i = 1; i <= 5; i++) {
    offsets.push(Buffer.byteLength(buf, "utf8"));
    buf += objs[i];
  }

  const xrefOffset = Buffer.byteLength(buf, "utf8");
  const xrefHeader = "xref\n0 6\n0000000000 65535 f \n";
  const xrefEntries = offsets
    .map((o) => String(o).padStart(10, "0") + " 00000 n ")
    .join("\n");
  const trailer = `\ntrailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(buf + xrefHeader + xrefEntries + trailer, "utf8");
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────
const ELIGIBLE_PAR_TEXT = `
STATE OF CALIFORNIA - HIGHWAY PATROL
TRAFFIC COLLISION REPORT
Report Number: CA2652600387
Date: January 31 2026
Time: 14:22
Location: Interstate 5 Northbound at Lathrop Road Overpass, Lathrop CA 95330

UNIT 1 - COMMERCIAL MOTOR VEHICLE
Carrier: Nationwide Transport Inc
DOT: 2846190
VIN: 1XPBD49X3GD123456
Driver: John D. Smith, CDL Class A
Violations/Citations: NONE ISSUED

UNIT 2 - PASSENGER VEHICLE
Driver: Maria L. Garcia
Violations/Citations: VC 21703 Following Too Closely - CITED

SEQUENCE OF EVENTS:
Unit 1 was a fully stopped tractor-trailer at the end of a traffic queue due to
a red light signal at Lathrop Road. Unit 1 had been stopped for approximately
45 seconds. Unit 2 was traveling northbound on I-5 at an estimated 52 mph
and failed to observe the stopped traffic. Unit 2 struck the rear of Unit 1
with no apparent attempt to brake.

CONTRIBUTING CIRCUMSTANCES:
Unit 2 - Following too closely. Unit 2 driver distracted by mobile device per
witness statement #1. Unit 1 driver had no evasive action available.

OFFICER NARRATIVE:
Based on physical evidence including skid marks (or absence thereof), damage
patterns, and witness accounts, this officer concludes that Unit 1 (CMV) had
no contributing factor in this collision. Unit 2 was solely responsible.
Unit 1 driver cooperated fully and was cleared of any violations.

DIAGRAM: Unit 1 stationary. Unit 2 rear-impact vector.

Reporting Officer: Ofc. R. Torres Badge 4821
CHP San Joaquin Valley Area - Lathrop
`.trim();

const AT_FAULT_PAR_TEXT = `
STATE OF CALIFORNIA - HIGHWAY PATROL
TRAFFIC COLLISION REPORT
Report Number: CA2652600388
Date: January 31 2026
Time: 09:47
Location: State Route 99 Southbound at Airport Way, Lathrop CA 95330

UNIT 1 - COMMERCIAL MOTOR VEHICLE
Carrier: Nationwide Transport Inc
DOT: 2846190
VIN: 1XPBD49X3GD654321
Driver: Robert T. Jones, CDL Class A
Violations/Citations: VC 22450(a) Failure to Stop at Stop Sign - CITED

UNIT 2 - PASSENGER VEHICLE
Driver: Susan B. Williams
Violations/Citations: NONE ISSUED

SEQUENCE OF EVENTS:
Unit 1 (CMV tractor-trailer) was traveling southbound on SR-99 service road
approaching the intersection with Airport Way which has a posted STOP sign.
Unit 1 entered the intersection without stopping. Unit 2 was traveling westbound
on Airport Way with right-of-way and the collision occurred in the intersection.

CONTRIBUTING CIRCUMSTANCES:
Unit 1 driver failed to obey stop sign per physical evidence (no skid marks
before stop bar) and witness statements. Unit 1 was fully at fault.

OFFICER NARRATIVE:
Physical evidence confirms Unit 1 did not stop at the posted stop sign.
Unit 1 driver was cited for VC 22450(a). Unit 2 had right-of-way and no
contributing factors. Fault determined: Unit 1 (CMV) at fault.

DIAGRAM: Unit 1 entered from north, failed stop sign, struck Unit 2.

Reporting Officer: Ofc. K. Martinez Badge 4917
CHP San Joaquin Valley Area - Lathrop
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function uploadParFixture(label, pdfBuffer, filename) {
  console.log(`\n[${label}] Uploading ${filename} (${pdfBuffer.length} bytes)…`);

  const url = `${BASE_URL}/api/cases/cpdp/${CASE_ID}/evidence/${PAR_EVID_ID}/upload`;
  const fd = new FormData();
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  fd.append("file", blob, filename);

  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`  HTTP ${res.status}:`, data);
    return null;
  }

  return data;
}

async function checkDb(supabase) {
  const { data, error } = await supabase
    .from("cpdp_cases")
    .select(
      "id, status, ai_eligibility_verdict, ai_eligibility_rationale, ai_suggested_types, cpdp_eligible_types, ai_assessed_at"
    )
    .eq("id", CASE_ID)
    .single();
  if (error) throw error;
  return data;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "https://kzndtvkblfbrsnrnjodf.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";

if (!supabaseKey) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY not set. Pass it via env to verify DB results."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("=== CPDP PAR Auto-fill Verification ===");
console.log(`Base URL : ${BASE_URL}`);
console.log(`Case     : ${CASE_ID}`);
console.log(`PAR evid : ${PAR_EVID_ID}`);

// ── Test 1: Eligible fixture ─────────────────────────────────────────────────
const eligiblePdf = buildMinimalPdf(ELIGIBLE_PAR_TEXT);
const result1 = await uploadParFixture("ELIGIBLE FIXTURE", eligiblePdf, "par_eligible.pdf");

if (result1) {
  console.log("\n  Response:", JSON.stringify(result1, null, 2));
  const db1 = await checkDb(supabase);
  console.log("\n  DB state after eligible upload:");
  console.log("    verdict         :", db1.ai_eligibility_verdict);
  console.log("    suggested_types :", db1.ai_suggested_types);
  console.log("    eligible_types  :", db1.cpdp_eligible_types);
  console.log("    rationale       :", db1.ai_eligibility_rationale?.slice(0, 120));
  console.log("    assessed_at     :", db1.ai_assessed_at);

  const pass1 = db1.ai_eligibility_verdict === "ELIGIBLE";
  console.log(`\n  TEST 1: ${pass1 ? "PASS" : "FAIL"} — verdict should be ELIGIBLE, got ${db1.ai_eligibility_verdict}`);
}

// ── Test 2: At-fault fixture ─────────────────────────────────────────────────
// Small delay to avoid hammering the AI
await new Promise((r) => setTimeout(r, 2000));

const atFaultPdf = buildMinimalPdf(AT_FAULT_PAR_TEXT);
const result2 = await uploadParFixture("AT-FAULT FIXTURE", atFaultPdf, "par_at_fault.pdf");

if (result2) {
  console.log("\n  Response:", JSON.stringify(result2, null, 2));
  const db2 = await checkDb(supabase);
  console.log("\n  DB state after at-fault upload:");
  console.log("    verdict         :", db2.ai_eligibility_verdict);
  console.log("    suggested_types :", db2.ai_suggested_types);
  console.log("    eligible_types  :", db2.cpdp_eligible_types);
  console.log("    rationale       :", db2.ai_eligibility_rationale?.slice(0, 120));
  console.log("    assessed_at     :", db2.ai_assessed_at);

  const pass2 =
    db2.ai_eligibility_verdict === "NOT_ELIGIBLE" ||
    db2.ai_eligibility_verdict === "INDETERMINATE";
  console.log(
    `\n  TEST 2: ${pass2 ? "PASS" : "FAIL"} — verdict should be NOT_ELIGIBLE or INDETERMINATE, got ${db2.ai_eligibility_verdict}`
  );
}

console.log("\n=== Verification complete ===");
console.log("Check the CPDP case editor at:");
console.log(`  ${BASE_URL}/console/clients/c009ad18-8acb-4fce-b001-2778879dc16e/cpdp/${CASE_ID}`);
