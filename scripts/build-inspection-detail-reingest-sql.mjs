import process from "node:process";

console.error(
  [
    "This generator is retired because its delete/reinsert SQL destroys violation IDs and enrichment.",
    "Use the authenticated /api/analysis/ingest-detail upload path instead; it performs source-aware merges.",
  ].join(" ")
);
process.exit(1);
