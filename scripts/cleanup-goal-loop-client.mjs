// One disposable goal-loop fixture only. Default is a read-only exact-ID preview.
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const clientId = '1ce377c6-d9cf-4b2f-8eb1-5b6dadb66d15';
const expectedName = 'ZZ TEST — Goal Loop Carrier';
const expectedDot = '3720456';
const tables = ["inspections","inspection_vehicles","violations","dataq_cases","carrier_profiles","subscriptions","client_credentials","users","action_items","clearinghouse_records","activity_log","reports","driver_documents","alerts","drivers","score_snapshots","burden_snapshots","client_invites","client_requests","fmcsa_ingest_files","client_attested_profiles","client_playbooks","mcs150_updates","carrier_profile_enrichments","client_activation_initializations","vehicles","documents","vehicle_maintenance","basic_measure_releases","case_agency_requests","client_compliance_profiles","compliance_expiration_events","compliance_expiration_digests","crashes","cpdp_cases","operator_item_acks","operator_manual_items","assessment_billing"];
const noId = new Set(['assessment_billing','client_activation_initializations']);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), {auth:{persistSession:false,autoRefreshToken:false}});
async function inspect() {
  const result = {};
  for (const table of tables) {
    const key = noId.has(table) ? 'client_id' : 'id';
    const {data,error,count} = await db.from(table).select(key,{count:'exact'}).eq('client_id',clientId).order(key);
    if(error) throw new Error(table+': '+error.message);
    assert.equal(data.length,count,table+' preview truncated');
    result[table] = data.map(row=>row[key]);
  }
  return result;
}
const {data:client,error} = await db.from('clients').select('id,name,dot_number').eq('id',clientId).maybeSingle();
if(error) throw new Error(error.message);
if(client) { assert.equal(client.name,expectedName); assert.equal(client.dot_number,expectedDot); }
const before = await inspect();
const preview = {client,rows:before};
console.log(JSON.stringify(preview,null,2));
writeFileSync('../scratch/goal-06-cleanup-preview.json',JSON.stringify(preview,null,2));
if(!process.argv.includes('--apply')) process.exit(0);
if(!client) { assert.ok(Object.values(before).every(rows=>rows.length===0),'Orphan fixture rows remain'); console.log('Already absent; zero scoped rows.'); process.exit(0); }
// Auth/session and uploaded-file deletion require their own reviewed scope. Do not leave orphans.
assert.equal(before.users.length,0,'Portal auth users exist; stop for scoped session/auth cleanup');
assert.equal(before.documents.length,0,'Uploaded documents exist; stop for scoped storage cleanup');
assert.equal(before.fmcsa_ingest_files.length,0,'Stored ingest files exist; stop for scoped storage cleanup');
assert.equal(before.dataq_cases.length,0,'Cases exist; stop for evidence/storage inspection');
assert.equal(before.cpdp_cases.length,0,'Cases exist; stop for evidence/storage inspection');
// Require a stable preview before the first deletion.
assert.deepEqual(await inspect(),before,'Fixture changed during preview');
for(const table of ['activity_log','inspection_vehicles']) {
  const {error:deleteError} = await db.from(table).delete().eq('client_id',clientId);
  if(deleteError) throw new Error(table+': '+deleteError.message);
}
const deleted = await db.from('clients').delete().eq('id',clientId).eq('name',expectedName).eq('dot_number',expectedDot).select('id');
if(deleted.error) throw new Error(deleted.error.message);
assert.deepEqual(deleted.data,[{id:clientId}],'Exact fixture row not deleted');
// Live FKs cascade remaining children. No table-wide or backup-table deletion.
const after = await inspect();
assert.ok(Object.values(after).every(rows=>rows.length===0),'Child rows remain');
const remaining = await db.from('clients').select('id',{count:'exact',head:true}).eq('id',clientId);
if(remaining.error) throw new Error(remaining.error.message);
assert.equal(remaining.count,0);
const proof = {clientId,remainingClientCount:0,remainingByTable:Object.fromEntries(Object.entries(after).map(([t,rows])=>[t,rows.length]))};
writeFileSync('../scratch/goal-06-cleanup-after.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify(proof,null,2));

