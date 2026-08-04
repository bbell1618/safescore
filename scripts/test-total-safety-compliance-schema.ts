import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260804182813_total_safety_compliance_layer.sql"
);
const sql = readFileSync(migrationPath, "utf8");

for (const fragment of [
  "alter type public.driver_doc_type add value if not exists 'prior_employer_checks'",
  "alter type public.driver_doc_type add value if not exists 'annual_mvr_review'",
  "alter type public.driver_doc_type add value if not exists 'clearinghouse_pre_employment'",
  "create table if not exists public.client_compliance_profiles",
  "create table if not exists public.compliance_expiration_events",
  "create table if not exists public.compliance_expiration_digests",
  "driver_documents_driver_type_unique",
  "driver_documents_driver_client_fkey",
  "vehicle_maintenance_vehicle_client_fkey",
  "clearinghouse_records_driver_client_fkey",
  "compliance_expiration_events_digest_client_fkey",
  "compliance_expiration_events_alert_client_fkey",
  "compliance_expiration_events_request_client_fkey",
  "compliance_total_safety_select_guard",
  "client_requests_compliance_tier_guard",
  "documents_compliance_tier_select_guard",
  "documents_compliance_tier_insert_guard",
  "unique (client_id, item_type, subject_id, due_date, threshold)",
  "unique (client_id, digest_date)",
]) {
  assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.doesNotMatch(
  sql,
  /update\s+public\.clients\s+set\s+driver_count/i,
  "the operational roster must never update the billing driver count"
);
assert.match(
  sql,
  /revoke execute on function public\.sync_vehicle_annual_inspection_date_v1\(\)[\s\S]*from public, anon, authenticated/i
);

function requestNeedsTotalSafety(category: string): boolean {
  return category.startsWith("compliance_") || category === "dqf_roster";
}

function documentNeedsTotalSafety(category: string): boolean {
  return ["dqf", "maintenance", "clearinghouse"].includes(category);
}

for (const category of [
  "compliance_medical_certificate",
  "compliance_cdl",
  "dqf_roster",
]) {
  assert.equal(requestNeedsTotalSafety(category), true, category);
}
for (const category of ["lane_b_evidence", "case_evidence", "fmcsa_portal_pin"]) {
  assert.equal(requestNeedsTotalSafety(category), false, category);
}
for (const category of ["dqf", "maintenance", "clearinghouse"]) {
  assert.equal(documentNeedsTotalSafety(category), true, category);
}
for (const category of ["evidence", "report", "auth_agreement", "other"]) {
  assert.equal(documentNeedsTotalSafety(category), false, category);
}

assert.match(sql, /category not like 'compliance\\_%' escape '\\'/);
assert.match(sql, /and category <> 'dqf_roster'/);
assert.match(
  sql,
  /category not in \([\s\S]*'dqf'::public\.document_category,[\s\S]*'maintenance'::public\.document_category,[\s\S]*'clearinghouse'::public\.document_category[\s\S]*\)/
);

console.log(
  JSON.stringify(
    {
      migration: migrationPath,
      idempotentObjects: true,
      billingDriverCountWrite: false,
      requestGate: {
        compliance: true,
        dqfRoster: true,
        unrelatedPreserved: true,
      },
      documentGate: {
        complianceCategories: true,
        unrelatedPreserved: true,
      },
    },
    null,
    2
  )
);
