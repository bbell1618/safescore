import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const native = createRequire(import.meta.url);
const clientId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
let role, billing, price, signedIn, writes, queries, rpcCalls, sessions;
const env={NEXT_PUBLIC_APP_URL:'https://fixture.invalid'};
const client={id:clientId,name:'TEST',status:'onboarding',tier:'assessment',driver_count:1,primary_contact:'TEST',phone:'TEST',vehicle_types:['truck'],operating_states:['CA'],operating_radius:'local',citation_dismissed_last_24_months:false,service_agreement_accepted:true};
function reset(){role='client_user';billing=null;price={active:true,type:'one_time',unit_amount:29900,currency:'usd'};signedIn=true;writes=0;queries=0;rpcCalls=0;sessions=[];env.STRIPE_PRICE_ASSESSMENT='price_test';}
const db={
  auth:{getUser:async()=>({data:{user:signedIn?{id:userId,email:'fixture@example.invalid'}:null}})},
  from(table){queries++;let write=null;let kind=null; const query={
    select(){return query;},eq(){return query;},is(){return query;},
    insert(data){write=data;kind='insert';return query;},update(data){write=data;kind='update';return query;},
    async maybeSingle(){return query.single();},
    async single(){if(table==='users')return{data:{client_id:clientId,role},error:null};if(table==='clients')return{data:client,error:null};return{data:billing,error:null};},
    then(resolve){if(write){assert.equal(table,'assessment_billing');writes++;billing={...(kind==='insert'?{geia_insured:false,waived_at:null,waived_by:null,paid_at:null,stripe_checkout_session_id:null,stripe_livemode:null}:billing),...write};}return Promise.resolve({error:null}).then(resolve);}
  };return query;},
  rpc(){rpcCalls++;return{single:async()=>({data:{result_status:'awaiting_activation',result_tier:'assessment',already_submitted:false},error:null})};}
};
class Failure extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
const guards={OnboardingRouteFailure:Failure,transitionFailure:()=>new Error('transition failed'),requireStaffOnboardingUser:async()=>{if(role!=='geia_staff')throw new Failure('Forbidden',403,'FORBIDDEN');return{service:db,userId};},requirePortalOnboardingClient:async()=>{if(role!=='client_user')throw new Failure('Forbidden',403,'FORBIDDEN');return{service:db,userId,clientId};}};
const mocks={
  'server-only':{}, '@/lib/onboarding/server':guards,
  '@/lib/supabase/server':{createClient:async()=>db,createServiceClient:async()=>db},
  '@/lib/auth/access':{isClientPostOnboardingLifecycle:()=>false},
  '@/lib/tiers':{isSubscriptionTier:v=>['monitor','remediate','total_safety'].includes(v)},
  '@/lib/onboarding/completeness':{missingOnboardingProfileFields:()=>[]},
  '@/lib/billing/billable-drivers':{getBillableDriverCount:async()=>({billable:1})},
  '@/lib/stripe/client':{stripe:{prices:{retrieve:async()=>price},checkout:{sessions:{create:async p=>{sessions.push(p);return{url:'https://checkout.stripe.com/test'};}}}}}
};
function load(file){const compiled={exports:{}};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module:compiled,exports:compiled.exports,process:{env},Date,console,require:n=>mocks[n]??native(n)});return compiled.exports;}
const helper=load('lib/billing/assessment.ts');mocks['@/lib/billing/assessment']=helper;
const checkout=load('app/api/billing/create-checkout-session/route.ts');
const waiver=load('app/api/clients/[id]/assessment-waiver/route.ts');
const activation=load('app/api/portal/onboarding-activation/route.ts');
const status=load('app/api/billing/assessment-status/route.ts');
const req=body=>({json:async()=>body});
reset();delete env.STRIPE_PRICE_ASSESSMENT;
assert.equal((await checkout.POST(req({tier:'assessment'}))).status,503);assert.equal(sessions.length,0);
assert.equal((await (await status.GET()).json()).available,false);
reset();const response=await checkout.POST(req({tier:'assessment'}));assert.equal(response.status,200);
assert.equal(sessions[0].mode,'payment');assert.equal(sessions[0].subscription_data,undefined);assert.equal(sessions[0].line_items[0].quantity,1);assert.equal(sessions[0].metadata.client_id,clientId);
reset();price.type='recurring';assert.equal((await checkout.POST(req({tier:'assessment'}))).status,503);assert.equal(sessions.length,0);
reset();signedIn=false;assert.equal((await checkout.POST(req({tier:'assessment'}))).status,401);assert.equal(queries,0);
reset();assert.equal((await activation.POST()).status,409);assert.equal(rpcCalls,0);
assert.equal((await waiver.PATCH(req({geiaInsured:true}),{params:Promise.resolve({id:clientId})})).status,403);assert.equal(writes,0);
role='geia_staff';assert.equal((await waiver.PATCH(req({geiaInsured:true,waived_by:'spoof'}),{params:Promise.resolve({id:clientId})})).status,400);assert.equal(writes,0);
assert.equal((await waiver.PATCH(req({geiaInsured:true}),{params:Promise.resolve({id:clientId})})).status,200);assert.equal(billing.waived_by,userId);assert.ok(billing.waived_at);assert.equal(helper.assessmentCovered(billing),true);
role='client_user';assert.equal((await checkout.POST(req({tier:'assessment'}))).status,409);assert.equal(sessions.length,0);assert.equal((await activation.POST()).status,200);
role='geia_staff';assert.equal((await waiver.PATCH(req({geiaInsured:false}),{params:Promise.resolve({id:clientId})})).status,200);assert.equal(helper.assessmentCovered(billing),false);assert.equal(billing.waived_by,userId);
reset();const paid={id:'cs_test_fixture',mode:'payment',status:'complete',payment_status:'paid',amount_total:29900,currency:'usd',livemode:false,metadata:{tier:'assessment',client_id:clientId,user_id:userId}};
for(const override of [{payment_status:'unpaid'},{status:'open'},{amount_total:1},{currency:'eur'},{mode:'subscription'},{metadata:{tier:'assessment'}}])await assert.rejects(()=>helper.recordPaidAssessment(db,{...paid,...override}),/not a complete, paid/);
assert.equal(writes,0);assert.equal(rpcCalls,0);
await helper.recordPaidAssessment(db,paid);assert.equal(writes,1);assert.equal(billing.stripe_checkout_session_id,paid.id);assert.equal(billing.stripe_livemode,false);
await helper.recordPaidAssessment(db,paid);assert.equal(writes,1);assert.equal(rpcCalls,2);
await assert.rejects(()=>helper.recordPaidAssessment(db,{...paid,id:'different'}),/different Assessment payment/);
reset();role='geia_staff';await assert.rejects(()=>helper.recordPaidAssessment(db,paid),/purchaser does not belong/);assert.equal(writes,0);
console.log('PASS: Assessment payment mode, missing/invalid price 503, auth, staff-only actor-owned waiver, uncovered activation refusal, paid-only receipt, retries, duplicate/mismatched purchaser rejection; no network.');
