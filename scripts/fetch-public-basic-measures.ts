import { fetchPublicBasicMeasures } from "../lib/fmcsa/public-basic-measures";

// Read-only: no Supabase client, credentials, persistence or notifications.
fetchPublicBasicMeasures(process.argv[2] ?? "").then(
  (result) => console.log(JSON.stringify(result, null, 2)),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
);
