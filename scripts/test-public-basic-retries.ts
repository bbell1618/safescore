import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchPublicBasicMeasures } from "../lib/fmcsa/public-basic-measures";

async function main() {
  const html = readFileSync("scripts/fixtures/public-basic-measures.html", "utf8");
  const waits: number[] = [], logs: Record<string, unknown>[] = [];
  let calls = 0;
  const result = await fetchPublicBasicMeasures("2533650", {
    fetcher: async (_url, options) => {
      assert.ok(options?.signal); assert.equal(options.cache, "no-store");
      calls++;
      return new Response(calls < 4 ? "source unavailable" : html, {status:calls < 4 ? 503 : 200});
    },
    sleep: async ms => { waits.push(ms); }, logFailure: (_message, details) => { logs.push(details); },
  });
  assert.equal(calls,4); assert.deepEqual(waits,[2000,6000,15000]); assert.equal(logs.length,3);
  assert.ok(logs.every(log=>log.timeoutMs===20000 && String(log.reason).includes("HTTP 503")));
  assert.equal(result.smsRunDate,"2026-08-28");
  calls=0; waits.length=0; logs.length=0;
  await assert.rejects(()=>fetchPublicBasicMeasures("2533650",{
    timeoutMs:1,
    fetcher:async (_url,options)=>{
      calls++; await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(options?.signal?.aborted,true); throw options?.signal?.reason;
    }, sleep:async ms=>{waits.push(ms);},logFailure:(_message,details)=>{logs.push(details);},
  }),/after 4 attempts: attempt 1: TimeoutError:.*attempt 4: TimeoutError:/);
  assert.equal(calls,4); assert.equal(logs.length,4); assert.deepEqual(waits,[2000,6000,15000]);
  calls=0;
  await assert.rejects(()=>fetchPublicBasicMeasures("2533650",{
    fetcher:async()=>{calls++;return new Response("<title>Access denied</title>");},
    sleep:async()=>{throw new Error("Malformed source should not retry");},logFailure:()=>{},
  }),/confirm.*USDOT/);
  assert.equal(calls,1);
  console.log("PASS: 20s request contract, initial + 3 retries, 2/6/15s backoff, timeout/HTTP detail, malformed source rejects");
}
main().catch(error=>{console.error(error);process.exit(1);});
