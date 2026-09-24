import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { STAFF_TEST_RECIPIENTS, isStaffTestRecipient } from "../lib/email/staff-test-policy";

const compile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;

async function main() {
  const saved: Record<string, unknown>[] = [], sent: Record<string, unknown>[] = [];
  const runtime: { env: Record<string, string | undefined> } = { env: { EMAIL_DRY_RUN: "true", SMTP_HOST: "smtp.invalid", SMTP_USER: "fixture", SMTP_PASSWORD: "fixture" } };
  let failure: string | null = null;
  const copy = { exports: {} }; vm.runInNewContext(compile("lib/email/copy.ts"), { module: copy, exports: copy.exports });
  const email = { exports: {} };
  vm.runInNewContext(compile("lib/email/client.ts"), { module: email, exports: email.exports, process: runtime, Error,
    require: (name: string) => {
      if (name === "./copy") return copy.exports;
      if (name === "./staff-test-policy") return { isStaffTestRecipient };
      if (name === "./outbox") return { writeDryRunOutbox: async (message: Record<string, unknown>) => { if (failure) throw new Error(failure); saved.push(message); return "outbox-id"; } };
      if (name === "nodemailer") return { createTransport: () => ({ sendMail: async (message: Record<string, unknown>) => { if (failure) throw new Error(failure); sent.push(message); return { messageId: "provider-id" }; } }) };
      throw new Error(name);
    },
  });
  const sender = email.exports as typeof import("../lib/email/client");
  for (const to of STAFF_TEST_RECIPIENTS) {
    const result = await sender.sendStaffTestEmail(to);
    assert.equal(result.dryRun, true); assert.equal(result.messageId, "outbox-id");
  }
  assert.equal(saved.length, 2); assert.equal(sent.length, 0);
  assert.ok(saved.every(message => message.clientId === null && message.template === "staff_email_test"));
  assert.equal(saved[0].htmlBody, saved[1].htmlBody);
  assert.equal((await sender.sendStaffTestEmail("other@example.test")).success, false);
  assert.equal(saved.length, 2);
  failure = "outbox denied";
  assert.equal((await sender.sendStaffTestEmail(STAFF_TEST_RECIPIENTS[0])).error, failure);
  assert.equal(sent.length, 0); failure = null;
  // SMTP is an in-memory fake only. No environment/key/network is loaded by this test.
  for (const value of ["false", "TRUE", " true ", "", undefined]) {
    runtime.env.EMAIL_DRY_RUN = value;
    assert.equal((await sender.sendStaffTestEmail(STAFF_TEST_RECIPIENTS[0])).messageId, "provider-id");
  }
  assert.equal(sent.length, 5); assert.ok(sent.every(message => !message.cc && !message.bcc));
  failure = "535 Authentication failed";
  assert.equal((await sender.sendStaffTestEmail(STAFF_TEST_RECIPIENTS[0])).error, failure); failure = null;
  runtime.env.EMAIL_DRY_RUN = undefined;
  assert.equal((await sender.sendInviteEmail({to:"fixture@example.test",companyName:"TEST",magicLinkUrl:"https://example.test"})).dryRun,true,"ordinary mail must still fail closed");

  class AuthFailure extends Error { constructor(message: string, readonly status: number) { super(message); } }
  let authStatus = 0, deliveries = 0;
  let delivery: Record<string, unknown> = {success:true,dryRun:true,messageId:"outbox-id"};
  const route = { exports: {} };
  vm.runInNewContext(compile("app/api/staff/email-test/route.ts"), {
    module:route,exports:route.exports,Error,SyntaxError,URL,
    require:(name:string)=>{
      if(name==="next/server")return {NextResponse:{json:(data:unknown,options?:{status:number})=>({data,status:options?.status??200})}};
      if(name==="zod")return {z};
      if(name==="@/lib/email/staff-test-policy")return {STAFF_TEST_RECIPIENTS};
      if(name==="@/lib/onboarding/server")return {OnboardingRouteFailure:AuthFailure,requireStaffOnboardingUser:async()=>{if(authStatus)throw new AuthFailure("Access denied",authStatus);}};
      if(name==="@/lib/email/client")return {sendStaffTestEmail:async()=>{deliveries++;return delivery;}};
      throw new Error(name);
    },
  });
  const post=(route.exports as {POST:(request:Request)=>Promise<{status:number;data:Record<string,unknown>}>}).POST;
  const request=(body:unknown,origin="https://example.test")=>new Request("https://example.test/api/staff/email-test",{method:"POST",headers:{origin},body:JSON.stringify(body)});
  for(const status of [401,403]) { authStatus=status; assert.equal((await post(request({to:STAFF_TEST_RECIPIENTS[0]}))).status,status); }
  authStatus=0; assert.equal(deliveries,0);
  for(const body of [{to:"other@example.test"},{to:[...STAFF_TEST_RECIPIENTS]},{to:STAFF_TEST_RECIPIENTS[0],subject:"arbitrary"},{to:STAFF_TEST_RECIPIENTS[0],cc:STAFF_TEST_RECIPIENTS[1]}])assert.equal((await post(request(body))).status,400);
  assert.equal((await post(request({to:STAFF_TEST_RECIPIENTS[0]},"https://other.test"))).status,403);
  assert.equal(deliveries,0);
  const dry=await post(request({to:STAFF_TEST_RECIPIENTS[0]})); assert.equal(dry.status,200); assert.equal(dry.data.mode,"dry_run"); assert.equal(dry.data.outboxId,"outbox-id"); assert.equal(deliveries,1);
  delivery={success:true,messageId:"provider-id"}; assert.equal((await post(request({to:STAFF_TEST_RECIPIENTS[0]}))).data.messageId,"provider-id");
  delivery={success:false,error:"SMTP provider failure"}; const bad=await post(request({to:STAFF_TEST_RECIPIENTS[0]})); assert.equal(bad.status,502); assert.equal(bad.data.error,"SMTP provider failure");
  const component=readFileSync("components/console/staff-email-test.tsx","utf8"); assert.doesNotMatch(component,/from ["'][^"']*(?:email\/client|email\/outbox|onboarding\/server)/);
  console.log("PASS staff-only exact-recipient fixed single-email route, literal dry-run, unassociated outbox, mocked SMTP IDs/errors, no ordinary-mail behavior change");
}
main().catch(error=>{console.error(error);process.exit(1);});
