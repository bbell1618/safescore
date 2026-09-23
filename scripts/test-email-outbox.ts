import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { emailTestRuntime } from "./lib/email-test-runtime";

async function main() {
  const test = emailTestRuntime();
  const secretUrl = "https://example.test/setup?token=DO_NOT_LOG&next=%2Fportal";
  const result = await test.email.sendInviteEmail({ to: "fixture@example.test", clientId: "fixture", companyName: "TEST", magicLinkUrl: secretUrl });
  assert.equal(result.success, true); assert.equal(result.dryRun, true); assert.equal(result.messageId, "outbox-1");
  assert.equal(test.saved[0].clientId, "fixture"); assert.match(String(test.saved[0].htmlBody), /DO_NOT_LOG&amp;next/);
  const recovery = await test.email.sendPasswordRecoveryEmail({ to: "fixture@example.test", clientId: "fixture", resetUrl: secretUrl });
  assert.equal(recovery.success, true); assert.equal(test.saved[1].template, "password_recovery");
  test.fail("outbox database unavailable");
  const failed = await test.email.sendInviteEmail({ to: "fixture@example.test", companyName: "TEST", magicLinkUrl: secretUrl });
  assert.equal(failed.success, false); assert.equal(failed.dryRun, true);
  assert.equal(failed.error, "outbox database unavailable"); assert.equal(test.saved.length, 2); assert.deepEqual(test.logs, []);

  const stored: Array<Record<string, unknown>> = [];
  let dbFailure: string | null = null;
  const output = { exports: {} };
  const source = readFileSync("lib/email/outbox.ts", "utf8");
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    module: output, exports: output.exports, URL, process:{env:{NEXT_PUBLIC_SUPABASE_URL:"https://example.test",SUPABASE_SERVICE_ROLE_KEY:"test"}},
    require: (name: string) => {
      if(name === "server-only") return {};
      if(name === "@supabase/supabase-js") return {createClient:()=>({from:(table:string)=>({insert:(row:Record<string,unknown>)=>{
        assert.equal(table,"email_dry_run_outbox"); stored.push(row);
        return {select:()=>({single:async()=>({data:dbFailure?null:{id:"saved"},error:dbFailure?{message:dbFailure}:null})})};
      }})})};
      throw new Error(name);
    },
  });
  const outbox = output.exports as typeof import("../lib/email/outbox");
  const html = `<style>secret CSS</style><p>Choose a password</p><a href="${secretUrl.replaceAll("&","&amp;")}">Open account</a><a href="javascript:alert(1)">Bad</a>`;
  assert.equal(await outbox.writeDryRunOutbox({to:"fixture@example.test",clientId:"fixture",template:"invite",subject:"Test",htmlBody:html}),"saved");
  assert.equal(stored[0].body_html,html);
  assert.equal(JSON.stringify(stored[0].action_links),JSON.stringify([{href:secretUrl,label:"Open account"}]));
  assert.doesNotMatch(String(stored[0].body_text),/secret CSS|<p>/);
  dbFailure="database insert denied";
  await assert.rejects(()=>outbox.writeDryRunOutbox({to:"x",clientId:"fixture",template:"x",subject:"x",htmlBody:html}),/database insert denied/);

  const route=readFileSync("app/api/clients/[id]/password-reset/route.ts","utf8");
  assert.doesNotMatch(route,/console\.(log|info|warn|error|debug)\([^;]*\b(resetUrl|tokenHash)\b[^;]*\);/);
  assert.match(route,/sendPasswordRecoveryEmail/);
  const page=readFileSync("app/staff/outbox/page.tsx","utf8");
  assert.ok(page.indexOf("requireStaffOnboardingUser().catch") < page.indexOf('.from("email_dry_run_outbox")'));
  assert.match(page,/\.limit\(50\)/); assert.match(page,/force-dynamic/); assert.doesNotMatch(page,/dangerouslySetInnerHTML/);
  const proxy=readFileSync("proxy.ts","utf8");
  assert.match(proxy,/matcher:/); assert.ok(!proxy.slice(proxy.indexOf("matcher:")).includes("staff"),"staff must not be excluded from middleware");
  console.log("PASS: outbox body/link persistence, no secret logging or SMTP, visible failure, staff-only last-50 page");
}
main().catch(error=>{console.error(error);process.exit(1);});
