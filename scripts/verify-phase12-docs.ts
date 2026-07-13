import fs from "node:fs";

const demo = fs.readFileSync("DEMO.md", "utf8");
const checklist = fs.readFileSync("LAUNCH_CHECKLIST.md", "utf8");
const demoMarkers = ["Quick Assess", "client file", "Action queue", "client portal", "Generate the report", "money story", "$199/month", "$599/month", "$999/month + $29/driver/month"];
const checklistMarkers = [
  "GMAIL_APP_PASSWORD", "EMAIL_DRY_RUN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONITOR", "STRIPE_PRICE_REMEDIATE", "STRIPE_PRICE_TOTAL_SAFETY",
  "STRIPE_PRICE_DRIVER_ADDON", "LEXISNEXIS_API_KEY", "LEXISNEXIS_PAR_ENDPOINT",
  "safescore.goldenerainsurance.com", "All BASICs", "inspection detail", "FMCSA_DATAHUB_APP_TOKEN",
  "SUPABASE_URL", "SUPABASE_KEY",
];
const missingDemo = demoMarkers.filter((marker) => !demo.includes(marker));
const missingChecklist = checklistMarkers.filter((marker) => !checklist.includes(marker));
console.log(JSON.stringify({ demoBytes: Buffer.byteLength(demo), checklistBytes: Buffer.byteLength(checklist), missingDemo, missingChecklist }));
if (missingDemo.length || missingChecklist.length) process.exit(1);
