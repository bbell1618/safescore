import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const clientId = process.argv[2];
const dotNumber = process.argv[3];

if (!clientId || !dotNumber) {
  throw new Error(
    "Usage: npx tsx scripts/run-production-import.ts <client-id> <dot-number>"
  );
}

async function main() {
  const { runAnalysisImport } = await import("../app/api/analysis/import/route");
  const response = await runAnalysisImport({ clientId, dotNumber });
  const result = await response.json();

  console.log(JSON.stringify({ status: response.status, result }, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
  }
}

void main();
