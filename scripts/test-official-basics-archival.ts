import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const monitoringPage = read(
  "app/(console)/console/clients/[id]/monitoring/page.tsx"
);

function tsxFiles(relativeDirectory: string): string[] {
  return readdirSync(resolve(process.cwd(), relativeDirectory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return tsxFiles(relativePath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [relativePath] : [];
  });
}

const currentSurfaceTokens = [
  "official_basics",
  "FMCSA official measures",
  "unsafe_driving_measure",
  "hos_compliance_measure",
  "driver_fitness_measure",
  "controlled_substance_measure",
  "vehicle_maint_measure",
  "hm_compliance_measure",
  "crash_indicator_measure",
];
const currentSurfaceMatches = [...tsxFiles("app"), ...tsxFiles("components")]
  .map((file) => ({
    file,
    tokens: currentSurfaceTokens.filter((token) => read(file).includes(token)),
  }))
  .filter(({ tokens }) => tokens.length > 0);

assert.deepEqual(
  currentSurfaceMatches,
  [],
  "No current app surface may present the archival BASIC measures"
);
assert.ok(
  !monitoringPage.includes("FMCSA official measures"),
  "The console must not present the archival FMCSA measures as current"
);
assert.ok(
  !monitoringPage.includes('.from("score_snapshots")'),
  "The console monitoring surface must not load the archival score snapshot"
);
assert.ok(
  !monitoringPage.includes("getBasics"),
  "The removed card must not make a live BASIC-measures request"
);

assert.ok(
  read("app/api/analysis/ingest-detail/route.ts").includes("official_basics: b"),
  "Authenticated ingest must continue preserving official_basics"
);
assert.ok(
  read(
    "supabase/migrations/20260710192742_authenticated_fmcsa_ingest_registry.sql"
  ).includes("official_basics jsonb"),
  "The archival official_basics column must remain in the schema"
);
assert.ok(
  read("lib/fmcsa/ingest-write-policy.ts").includes('"official_basics"'),
  "The ingest write policy must continue allowing the archival field"
);
assert.ok(
  read("lib/supabase/types.ts").includes(
    "official_basics: Record<string, unknown>"
  ),
  "Generated application types must retain official_basics"
);

console.log(
  "Official BASICs archival check passed: current console card removed; storage and ingest retained."
);
