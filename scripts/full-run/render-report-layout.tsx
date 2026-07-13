import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { SafetyReport } from "../../lib/pdf/safety-report";

async function main() {
  const output = resolve(process.cwd(), "tmp", "pdfs", "layout-check.pdf");
  await mkdir(resolve(output, ".."), { recursive: true });
  const document = React.createElement(SafetyReport, {
      client: { name: "Layout Check Carrier", dot_number: "0000001", mc_number: null },
      carrier: {
        legalName: "Layout Check Carrier",
        dotNumber: "0000001",
        phyCity: "Fremont",
        phyState: "CA",
        totalDrivers: 1,
        totalPowerUnits: 1,
        safetyRating: "Unrated",
        usdotStatus: "Active",
      },
      basics: [],
      burden: { perBasic: [], totalPoints: 0 },
      openCases: [
        { kind: "CPDP", label: "6123719", status: "filed" },
        { kind: "DataQ", label: "6103911", status: "filed" },
      ],
      violations: Array.from({ length: 72 }, (_, index) => ({
        date: "2026-07-13",
        description: `Synthetic layout check violation ${index + 1}`,
        severity_weight: 1,
        oos_violation: false,
        basic_category: "vehicle_maintenance",
      })),
      reportDate: "July 13, 2026",
      generatedBy: "layout-check",
    }) as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(document);
  await writeFile(output, pdf);
  console.log(output);
}

void main();
