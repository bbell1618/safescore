import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatComplianceBasis,
  formatComplianceIssueStatus,
} from "../lib/analysis/compliance-presentation";

assert.equal(
  formatComplianceBasis(71, 68),
  "Counts all on-file violations \u2014 audit exposure is not limited to the 24-month scoring window. 71 violations on file \u00B7 68 in scoring window \u00B7 3 aged out but audit-relevant."
);

const nationwideAreaCards = [
  ["Parts and Accessories", 37, 37, formatComplianceIssueStatus(37, 37)],
  ["Driver Qualifications", 1, 1, formatComplianceIssueStatus(1, 1)],
  ["Operational Requirements", 8, 8, formatComplianceIssueStatus(8, 8)],
  ["Hours of Service", 20, 17, formatComplianceIssueStatus(20, 17)],
  ["Vehicle Inspection, Repair, and Maintenance", 5, 5, formatComplianceIssueStatus(5, 5)],
] as const;

assert.deepEqual(nationwideAreaCards, [
  ["Parts and Accessories", 37, 37, "Needs review - 37 issues on file"],
  ["Driver Qualifications", 1, 1, "Needs review - 1 issue on file"],
  ["Operational Requirements", 8, 8, "Needs review - 8 issues on file"],
  [
    "Hours of Service",
    20,
    17,
    "Needs review - 20 issues on file \u00B7 17 in scoring window, 3 aged out but audit-relevant",
  ],
  [
    "Vehicle Inspection, Repair, and Maintenance",
    5,
    5,
    "Needs review - 5 issues on file",
  ],
]);
assert.equal(
  nationwideAreaCards.reduce((sum, [, onFile]) => sum + onFile, 0),
  71
);
assert.equal(
  nationwideAreaCards.reduce((sum, [, , inWindow]) => sum + inWindow, 0),
  68
);

const compliancePage = readFileSync(
  resolve(process.cwd(), "app/(console)/console/clients/[id]/compliance/page.tsx"),
  "utf8"
);
const phase3Verification = readFileSync(
  resolve(process.cwd(), "scripts/verify-phase3-compliance.ts"),
  "utf8"
);

const obsoleteIssueLabel = new RegExp(["live", "issue", "s?"].join("\\s*"), "i");
assert.doesNotMatch(compliancePage, obsoleteIssueLabel);
assert.doesNotMatch(phase3Verification, obsoleteIssueLabel);
assert.match(compliancePage, /formatComplianceBasis\(violations\.length, inWindowViolations\.length\)/);
assert.match(compliancePage, /formatComplianceIssueStatus\(area\.count, area\.inWindowCount\)/);
assert.match(compliancePage, /No issues on file/);

console.log(
  JSON.stringify(
    {
      passed: true,
      basis: formatComplianceBasis(71, 68),
      nationwideAreaCards,
      hazardousMaterials: "No issues on file",
    },
    null,
    2
  )
);
