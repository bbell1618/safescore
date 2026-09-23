// Run with node --require ./scripts/lib/goal-server-only.cjs --import <tsx-loader-file-URL> scripts/verify-goal-total-safety.ts [--seed]
// Only the explicitly disposable goal-loop client. No auth sign-in or real payment.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { buildComplianceHealth, DQF_CHECKLIST_ITEMS } from "../lib/compliance/health";
import { runComplianceExpirationSweep } from "../lib/compliance/expiration-sweep";
import { getClientChecklist } from "../lib/operator/checklist-server";
loadEnvConfig(process.cwd());
process.env.EMAIL_DRY_RUN = "true";
nodemailer.createTransport = (() => { throw new Error("SMTP forbidden in goal-loop verification"); }) as typeof nodemailer.createTransport;
const clientId = "1ce377c6-d9cf-4b2f-8eb1-5b6dadb66d15";
const staffId = "26ab525a-b7e3-461f-9e60-93a50cafa5b3";
const now = new Date("2026-09-23T22:12:00.000Z");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {auth:{persistSession:false,autoRefreshToken:false}});
async function rows(table: string) {
  const r = await db.from(table).select("*",{count:"exact"}).eq("client_id",clientId);
  if(r.error) throw new Error(table+": "+r.error.message);
  assert.equal(r.data.length,r.count,table+" rows truncated");
  return r.data;
}
async function main() {
  const {data:client,error} = await db.from("clients").select("id,name,dot_number,tier,status").eq("id",clientId).single();
  if(error) throw new Error(error.message);
  assert.equal(client.name,"ZZ TEST — Goal Loop Carrier"); assert.equal(client.dot_number,"3720456"); assert.equal(client.tier,"total_safety");
  if(process.argv.includes("--seed")) {
    assert.equal((await rows("drivers")).length,0,"Fixture already has drivers; use verification without --seed");
    assert.equal((await rows("vehicles")).length,0,"Fixture already has vehicles");
    const driverResult = await db.from("drivers").insert([
      {full_name:"ZZ TEST — Expired Medical",cdl_expiry:"2027-09-23",medical_cert_expiry:"2026-09-22"},
      {full_name:"ZZ TEST — CDL Due",cdl_expiry:"2026-10-13",medical_cert_expiry:"2027-09-23"},
      {full_name:"ZZ TEST — Missing DQF",cdl_expiry:"2027-09-23",medical_cert_expiry:"2027-09-23"},
    ].map(d=>({...d,client_id:clientId,status:"active",source:"operator",approved_at:now.toISOString(),approved_by:staffId,notes:"Synthetic verification fixture only; no real driver or credential."}))).select("id,full_name,medical_cert_expiry");
    if(driverResult.error) throw new Error(driverResult.error.message);
    const drivers = driverResult.data!;
    const docs = drivers.flatMap(d=>DQF_CHECKLIST_ITEMS.filter(x=>!(d.full_name.endsWith("Missing DQF")&&x.docType==="application")).map(x=>({
      client_id:clientId,driver_id:d.id,doc_type:x.docType,status:x.docType==="medical_cert"&&d.full_name.endsWith("Expired Medical")?"expired":"current",
      completed_date:"2026-09-01",expiry_date:x.docType==="medical_cert"?d.medical_cert_expiry:null,
      notes:"TEST metadata only. No uploaded document; never a real qualification attestation.",
    })));
    const docResult=await db.from("driver_documents").insert(docs); if(docResult.error)throw new Error(docResult.error.message);
    const vehicleResult=await db.from("vehicles").insert([{unit_number:"ZZ TEST UNIT 1",annual_inspection_date:"2026-09-01"},{unit_number:"ZZ TEST UNIT 2",annual_inspection_date:"2026-08-01"}].map(v=>({...v,client_id:clientId,status:"active"})));
    if(vehicleResult.error)throw new Error(vehicleResult.error.message);
    const queryResult=await db.from("clearinghouse_records").insert(drivers.map(d=>({client_id:clientId,driver_id:d.id,query_date:d.full_name.endsWith("Missing DQF")?"2025-09-22":"2026-09-01",result_type:"negative"})));
    if(queryResult.error)throw new Error(queryResult.error.message);
    // A disposable active fixture is needed by the real sweep. This is NOT purchase/onboarding proof.
    const activate=await db.from("clients").update({status:"active"}).eq("id",clientId).eq("name",client.name).eq("dot_number",client.dot_number).select("id");
    if(activate.error)throw new Error(activate.error.message); assert.equal(activate.data?.length,1);
    const audit=await db.from("activity_log").insert({client_id:clientId,user_id:staffId,action_type:"goal_loop_test_fixture",description:"Disposable Total Safety fixture activated for scoped compliance proof only; no payment, subscription, real person or legal attestation.",metadata:{purpose:"goal_loop_synthetic",drivers:3,vehicles:2}});
    if(audit.error)throw new Error(audit.error.message);
  }
  const drivers=await rows("drivers"),driverDocuments=await rows("driver_documents"),vehicles=await rows("vehicles"),clearinghouseRecords=await rows("clearinghouse_records");
  assert.equal(drivers.length,3);assert.equal(vehicles.length,2);
  const health=buildComplianceHealth({asOfDate:"2026-09-23",drivers:drivers as Parameters<typeof buildComplianceHealth>[0]["drivers"],driverDocuments:driverDocuments as Parameters<typeof buildComplianceHealth>[0]["driverDocuments"],vehicles:vehicles as Parameters<typeof buildComplianceHealth>[0]["vehicles"],clearinghouseRecords:clearinghouseRecords as Parameters<typeof buildComplianceHealth>[0]["clearinghouseRecords"]});
  assert.ok(health.upcoming.some(x=>x.itemType==="medical_certificate"&&x.daysRemaining===-1));
  assert.ok(health.upcoming.some(x=>x.itemType==="cdl"&&x.daysRemaining===20));
  assert.ok(health.upcoming.some(x=>x.itemType==="clearinghouse_annual_query"&&x.daysRemaining===-1));
  assert.ok(health.drivers.items.some(d=>d.dqfItems.some(x=>x.docType==="application"&&x.status==="missing")));
  const sweep=await runComplianceExpirationSweep(db,{clientId,now});
  assert.equal(sweep.status,"succeeded");assert.notEqual(sweep.operationsNotification,"sent");
  const checklist=await getClientChecklist(clientId,{service:db,now:now.toISOString(),authUsers:[]});
  for(const rule of ["compliance.dqf_gaps","compliance.expirations","compliance.clearinghouse"])assert.ok(checklist.items.some(i=>i.ruleKey===rule),rule);
  const events=await rows("compliance_expiration_events");
  for(const [type,threshold] of [["medical_certificate","expired"],["cdl","30_day"],["clearinghouse_annual_query","expired"]])assert.ok(events.some(e=>e.item_type===type&&e.threshold===threshold),type+" event");
  const notifications=(await rows("activity_log")).filter(a=>a.action_type==="operations_notification_email");
  assert.ok(notifications.length>0); assert.ok(notifications.every(a=>a.metadata?.email_delivery?.status==="dry_run"));
  const proof={clientId,fixtureActivationOnly:true,paidActivationVerified:false,asOf:now.toISOString(),health,sweep,events,checklist,notifications:notifications.map(a=>({id:a.id,status:a.metadata.email_delivery.status})),portalLiveVerified:false};
  writeFileSync("../scratch/goal-07-proof.json",JSON.stringify(proof,null,2));
  console.log(JSON.stringify({clientId,drivers:drivers.length,vehicles:vehicles.length,health:{drivers:health.drivers,vehicles:health.vehicles},sweep,checklistRules:checklist.items.map(x=>x.ruleKey),notificationStatuses:proof.notifications},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exit(1);});
