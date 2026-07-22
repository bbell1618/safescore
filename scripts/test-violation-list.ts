import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChallengeTier } from "../lib/analysis/challengeability-v2";
import {
  countViolationTiers,
  formatViolationWindowSummary,
  normalizeViolationCodeSearch,
  violationMatchesSearch,
} from "../lib/analysis/violation-list";

const fixtures = [
  {
    violation_code: "39345B2BVAC",
    violation_description: "Brake hose or tubing chafing and/or kinking",
    inspections: { report_number: "NEUU000588" },
  },
  {
    violation_code: "393.45B2BAIR",
    violation_description: "Brake connections with a leak under pressure",
    inspections: { report_number: "NEUU000588" },
  },
  {
    violation_code: "3922C",
    violation_description: "Failure to obey traffic control device",
    inspections: { report_number: "NBAA009479" },
  },
];

assert.equal(normalizeViolationCodeSearch(" 393.45 "), "39345");
assert.equal(normalizeViolationCodeSearch("393 45"), "39345");
assert.deepEqual(
  fixtures.filter((violation) => violationMatchesSearch(violation, "393.45")),
  fixtures.slice(0, 2)
);
assert.deepEqual(
  fixtures.filter((violation) => violationMatchesSearch(violation, "393 45")),
  fixtures.slice(0, 2)
);
assert.deepEqual(
  fixtures.filter((violation) => violationMatchesSearch(violation, "traffic control")),
  fixtures.slice(2)
);
assert.deepEqual(
  fixtures.filter((violation) => violationMatchesSearch(violation, "NEUU000588")),
  fixtures.slice(0, 2)
);
assert.equal(violationMatchesSearch(fixtures[0], ""), true);

const tiers: ChallengeTier[] = [
  "investigate",
  "investigate",
  "operational",
  "operational",
  "operational",
  "strong",
];
const tierCounts = countViolationTiers(tiers);
assert.deepEqual(tierCounts, {
  all: 6,
  strong: 1,
  moderate: 0,
  investigate: 2,
  not_challengeable: 0,
  operational: 3,
});

const unrelatedFilteredTiers = tiers.filter((_, index) => index < 2);
assert.notDeepEqual(countViolationTiers(unrelatedFilteredTiers), tierCounts);
assert.equal(tierCounts.operational, 3);
assert.equal(tierCounts.investigate, 2);

assert.equal(
  formatViolationWindowSummary(71, 68),
  "68 score in the 24-month window \u00B7 3 aged out (on file, no score impact)"
);
assert.equal(
  formatViolationWindowSummary(2, 3),
  "3 score in the 24-month window \u00B7 0 aged out (on file, no score impact)"
);

const overviewSource = readFileSync(
  resolve(process.cwd(), "app/(console)/console/clients/[id]/page.tsx"),
  "utf8"
);
assert.ok(
  overviewSource.includes("reconciliation.queryTrace.inWindowViolationCount")
);
assert.ok(!overviewSource.includes('.gt("time_weight", 0)'));
assert.ok(!overviewSource.includes("inWindowViolationCountQuery"));
assert.ok(overviewSource.includes("formatViolationWindowSummary("));

const violationsPageSource = readFileSync(
  resolve(process.cwd(), "app/(console)/console/clients/[id]/violations/page.tsx"),
  "utf8"
);
assert.ok(
  violationsPageSource.includes(
    "inspections(inspection_date, state, level, facility_name, report_number)"
  )
);

const analyzerSource = readFileSync(
  resolve(process.cwd(), "components/console/violation-analyzer.tsx"),
  "utf8"
);
const tierCountsIndex = analyzerSource.indexOf("const tierCounts = useMemo(");
const filteredRowsIndex = analyzerSource.indexOf("const filtered = useMemo(");
assert.ok(tierCountsIndex >= 0 && tierCountsIndex < filteredRowsIndex);
assert.ok(
  analyzerSource.includes(
    "countViolationTiers(scoredViolations.map(({ challengeScore }) => challengeScore.label))"
  )
);
assert.ok(analyzerSource.includes("violationMatchesSearch(violation, searchText)"));
assert.ok(analyzerSource.includes("tierCounts[value]"));

console.log(
  JSON.stringify(
    {
      passed: true,
      dottedCodeMatches: 2,
      reportNumberMatches: 2,
      tierCounts,
      overviewCopy: formatViolationWindowSummary(71, 68),
    },
    null,
    2
  )
);
