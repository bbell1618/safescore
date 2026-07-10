import { strict as assert } from "node:assert";
import { selectCanonicalInspectionScope } from "../lib/fmcsa/canonical-inspection-scope";

const publicOnly = selectCanonicalInspectionScope([
  { id: "public-1", mcmis_inspection_id: null },
  { id: "public-2", mcmis_inspection_id: null },
]);
assert.deepEqual(publicOnly, {
  inspectionIds: ["public-1", "public-2"],
  source: "public",
});

const mixed = selectCanonicalInspectionScope([
  { id: "public-1", mcmis_inspection_id: null },
  { id: "auth-1", mcmis_inspection_id: "MCMIS-1" },
  { id: "auth-2", mcmis_inspection_id: "MCMIS-2" },
]);
assert.deepEqual(mixed, {
  inspectionIds: ["auth-1", "auth-2"],
  source: "authenticated",
});

console.log(JSON.stringify({ publicOnly, mixed }, null, 2));
