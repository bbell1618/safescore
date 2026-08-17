import assert from "node:assert/strict";
import {
  rosterDriverCreateSchema,
  rosterDriverUpdateSchema,
} from "../lib/roster-collection/roster-validation";

const created = rosterDriverCreateSchema.parse({
  full_name: "Test Driver",
  cdl_number: "TEST-001",
});
assert.equal(created.cdl_state, "CA");
assert.equal(created.cdl_class, "A");

const partial = rosterDriverUpdateSchema.parse({ full_name: "Updated Driver" });
assert.deepEqual(partial, { full_name: "Updated Driver" });
assert.equal("cdl_state" in partial, false);
assert.equal("cdl_class" in partial, false);

assert.equal(rosterDriverUpdateSchema.safeParse({}).success, false);

console.log(
  JSON.stringify(
    {
      passed: true,
      createDefaults: { cdl_state: created.cdl_state, cdl_class: created.cdl_class },
      patchPreservesOmittedFields: true,
    },
    null,
    2
  )
);
