import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reassessViolationOnChange,
  type TargetedChallengeabilityAssessment,
  type ViolationEnrichmentRow,
} from "../lib/challengeability/reassess-on-change";

const clientId = "11111111-1111-4111-8111-111111111111";
const violationId = "22222222-2222-4222-8222-222222222222";
const supabase = {} as SupabaseClient;
const baseline: ViolationEnrichmentRow = {
  id: violationId,
  client_id: clientId,
  citation_number: "DA251770",
  citation_result: null,
  convicted: null,
};

const calls: Array<{
  clientId: string;
  violationIds: string[];
  force: true;
}> = [];
const assess: TargetedChallengeabilityAssessment = async (
  _supabase,
  assessedClientId,
  options
) => {
  calls.push({ clientId: assessedClientId, ...options });
  return {
    requested: 1,
    assessed: 1,
    challengeable: 1,
    failures: [],
    hasMore: false,
    nextCursor: violationId,
  };
};

const failedAssessment: TargetedChallengeabilityAssessment = async () => ({
  requested: 1,
  assessed: 0,
  challengeable: 0,
  failures: [{ violationId, error: "upstream model unavailable" }],
  hasMore: false,
  nextCursor: violationId,
});

async function main() {
  const unchanged = await reassessViolationOnChange(
    supabase,
    {
      clientId,
      violationId,
      before: baseline,
      after: { ...baseline },
    },
    { assess }
  );
  assert.deepEqual(unchanged, { reassessed: false, changedFields: [] });
  assert.equal(calls.length, 0, "unchanged enrichment must not invoke assessment");

  const changed = await reassessViolationOnChange(
    supabase,
    {
      clientId,
      violationId,
      before: baseline,
      after: {
        ...baseline,
        citation_result: "Dismissed",
        convicted: false,
      },
    },
    { assess }
  );
  assert.equal(changed.reassessed, true);
  assert.deepEqual(changed.changedFields, ["citation_result", "convicted"]);
  assert.equal(calls.length, 1, "one write with multiple changed fields must assess once");
  assert.deepEqual(calls[0], {
    clientId,
    violationIds: [violationId],
    force: true,
  });

  await assert.rejects(
    reassessViolationOnChange(
      supabase,
      {
        clientId,
        violationId,
        before: baseline,
        after: { ...baseline, citation_number: "DA251771" },
      },
      { assess: failedAssessment }
    ),
    /upstream model unavailable/
  );

  console.log(
    JSON.stringify(
      {
        passed: true,
        unchangedAssessmentCalls: 0,
        changedAssessmentCalls: calls.length,
        multipleChangedFieldsAssessedOnce: true,
        failuresSurfaced: true,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
