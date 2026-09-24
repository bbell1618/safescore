import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Stripe from "stripe";

// Offline cryptographic verification only: no credentials or Stripe requests.
const stripe = new Stripe("sk_placeholder_offline_only");
const runtime = { env: { STRIPE_WEBHOOK_SECRET: "whsec_offline_fixture" } };
const route = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync("app/api/billing/webhook/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module:route,exports:route.exports,process:runtime,Error,
  require:(name:string)=>{
    if(name==="next/server")return {NextResponse:{json:(data:unknown,options?:{status:number})=>({data,status:options?.status??200})}};
    if(name==="@/lib/stripe/client")return {stripe};
    if(name==="@/lib/onboarding/server")return {OnboardingRouteFailure:class extends Error {}};
    return new Proxy({}, {get:()=>()=>{throw new Error("No database or fulfillment allowed in signature probe");}});
  },
});
const post=(route.exports as {POST:(r:Request)=>Promise<{status:number;data:Record<string,unknown>}>}).POST;
async function main() {
  for(const livemode of [false,true]) {
    const payload=JSON.stringify({id:"evt_offline",object:"event",type:"readiness.offline_probe",livemode,data:{object:{}}});
    const header=stripe.webhooks.generateTestHeaderString({payload,secret:runtime.env.STRIPE_WEBHOOK_SECRET});
    const req=(body:string,signature?:string)=>new Request("https://example.test/api/billing/webhook",{method:"POST",body,headers:signature?{"stripe-signature":signature}:{}});
    assert.equal((await post(req(payload,header))).status,200);
    assert.equal((await post(req(payload))).status,400);
    assert.equal((await post(req(payload+" ",header))).status,400);
    const wrong=stripe.webhooks.generateTestHeaderString({payload,secret:"whsec_wrong_fixture"});
    assert.equal((await post(req(payload,wrong))).status,400);
  }
  runtime.env.STRIPE_WEBHOOK_SECRET="";
  assert.equal((await post(new Request("https://example.test/api/billing/webhook",{method:"POST",body:"{}"}))).status,503);
  console.log("PASS real Stripe signature verification for test/live event modes; tampered/missing/wrong signatures rejected; missing configuration 503; no network/payment");
}
main().catch(error=>{console.error(error);process.exit(1);});
