import { getPARRetrievalProvider } from "../lib/par";

async function main() {
  delete process.env.LEXISNEXIS_API_KEY;
  delete process.env.LEXISNEXIS_PAR_ENDPOINT;
  const provider = getPARRetrievalProvider();
  const status = provider.status();
  const result = await provider.retrieve({ carrierDotNumber: "0000001", crashDate: "2026-06-01", state: "CA" });
  console.log(JSON.stringify({ status, result }));
  if (status.state !== "not_configured" || result.state !== "pending") {
    throw new Error("PAR provider did not stop honestly at the configuration boundary");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
