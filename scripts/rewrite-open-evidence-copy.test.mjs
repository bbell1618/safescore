import assert from "node:assert/strict";
import test from "node:test";
import { rebuildEvidenceCopy } from "./rewrite-open-evidence-copy.mjs";

const row = () => ({ status: "open", request_type: "evidence", response: null,
  evidence_class: "citation-dismissed", potential_points: 18,
  requested_items: [{ itemKey: "certified-court-disposition", label: "old", contextNote: "old", evidenceId: "keep-id", extra: { keep: [1, null] } }],
});
test("backfill changes only allowed copy and preserves arbitrary item properties", () => {
  const input = row(), before = structuredClone(input);
  const { patch } = rebuildEvidenceCopy(input, {});
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(patch).sort(), ["requested_items", "status_copy", "why_copy"]);
  assert.deepEqual(patch.requested_items[0], { ...before.requested_items[0], label: "Court paperwork showing how the ticket ended", contextNote: `${patch.status_copy} If the court dismissed or reduced the ticket, this could remove 18 points.` });
});
test("one unknown stored key skips the whole row", () => {
  const input = row();
  input.requested_items.push({ itemKey: "unrecognized" });
  assert.deepEqual(rebuildEvidenceCopy(input, {}), { reason: "Unknown stored itemKey: unrecognized" });
});
test("answered, closed, non-evidence and invalid rows never produce a patch", () => {
  for (const override of [{ response: {} }, { status: "fulfilled" }, { request_type: "question" }, { evidence_class: "unknown" }, { potential_points: null }, { requested_items: [] }]) {
    const result = rebuildEvidenceCopy({ ...row(), ...override }, {});
    assert.ok(result.reason);
    assert.equal(result.patch, undefined);
  }
});
