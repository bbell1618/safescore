import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseAllBasicsExport } from "../lib/fmcsa/all-basics-export";
import { parseInspectionDetailXml } from "../lib/fmcsa/inspection-detail-xml";

async function main() {
  const fixtureRoot = resolve(process.cwd(), "scripts", "fixtures", "fmcsa");
  const [csv, xml] = await Promise.all([
    readFile(resolve(fixtureRoot, "all-basics.csv"), "utf8"),
    readFile(resolve(fixtureRoot, "inspection-detail.xml"), "utf8"),
  ]);
  const allBasics = parseAllBasicsExport(csv);
  const inspections = parseInspectionDetailXml(xml, {
    "3958AELD": { basicCategory: "hos_compliance", severityWeight: 5 },
  });

  const firstInspection = inspections[0];
  assert.ok(firstInspection, "Inspection-detail fixture did not produce an inspection");
  const firstViolation = firstInspection.violations[0];
  assert.ok(firstViolation, "Inspection-detail fixture did not produce a violation");
  assert.equal(firstViolation.citationNumber, "SYN-CIT-1");
  assert.equal(firstViolation.citationResult, "Pending");
  assert.equal(firstInspection.mcmisInspectionId, "990000001");
  assert.equal(firstInspection.startTime, "08:15");
  assert.equal(firstInspection.endTime, "09:05");
  assert.equal(firstInspection.locationText, "Synthetic inspection facility");

  console.log(
    JSON.stringify(
      {
        allBasics: {
          snapshotDate: allBasics.snapshotDate,
          count: Object.keys(allBasics.basics).length,
          alerted: Object.entries(allBasics.basics)
            .filter(([, value]) => value.alert)
            .map(([key]) => key),
          crashIndicator: allBasics.basics.crash_indicator,
          hmDetail: allBasics.basics.hazmat_compliance.detail,
        },
        compass: {
          inspections: inspections.length,
          violations: inspections.reduce((sum, item) => sum + item.violations.length, 0),
          vehicles: inspections.reduce((sum, item) => sum + item.vehicles.length, 0),
          first: inspections[0],
        },
      },
      null,
      2
    )
  );
}

void main();
