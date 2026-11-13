import assert from "node:assert/strict";
import test from "node:test";
import { planSend, type ApprovedRow } from "./send-plan";

const base: ApprovedRow = {
  id: "1", kind: "email", status: "approved", editable: true, edited: false,
  to_address: "a@b.com", cc: null, subject: "Hi", body_text: "Hello", body_html: "<p>Hello</p>",
  from_identity: "sunny", payload: {}, send_result: null,
};

test("only approved, unclaimed rows are sent", () => {
  assert.equal(planSend({ ...base, status: "pending" }).action, "skip");
  assert.equal(planSend({ ...base, status: "rejected" }).action, "skip");
  assert.equal(planSend({ ...base, send_result: { claimed: true } }).action, "skip");
  assert.equal(planSend(base).action, "email");
});

test("an edited body is rebuilt from the edited text", () => {
  const p = planSend({ ...base, edited: true });
  assert.equal(p.action, "email");
  if (p.action === "email") assert.equal(p.rerender, true);
  const q = planSend(base);
  if (q.action === "email") assert.equal(q.rerender, false);
});

test("bad recipient or empty content fails closed instead of sending", () => {
  assert.equal(planSend({ ...base, to_address: "not-an-email" }).action, "fail");
  assert.equal(planSend({ ...base, to_address: null }).action, "fail");
  assert.equal(planSend({ ...base, subject: " " }).action, "fail");
  assert.equal(planSend({ ...base, body_text: "", body_html: "" }).action, "fail");
});

test("playbook and filing rows apply hooks and send nothing; needs_info is never sent", () => {
  assert.equal(planSend({ ...base, kind: "playbook_publish", to_address: null }).action, "apply_only");
  assert.equal(planSend({ ...base, kind: "filing_packet", to_address: null }).action, "apply_only");
  assert.equal(planSend({ ...base, kind: "needs_info" }).action, "skip");
});
