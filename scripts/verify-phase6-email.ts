import { loadEnvConfig } from "@next/env";
import {
  sendInviteEmail,
  sendNewViolationAlert,
  sendCaseStatusChange,
  sendReportReady,
  sendRequestQueueReminder,
} from "../lib/email/client";

loadEnvConfig(process.cwd());
process.env.EMAIL_DRY_RUN = "true";

const to = "safescore-phase11-acme@example.com";
const portal = "https://safescore.vercel.app/portal";

async function main() {
  const results = await Promise.all([
    sendInviteEmail({ to, companyName: "TEST—Acme Freight Lines", contactName: "Phase 11 Test Client", magicLinkUrl: `${portal}/setup-test` }),
    sendNewViolationAlert({ to, companyName: "TEST—Acme Freight Lines", dotNumber: "0000001", violationCode: "395.8A-TEST", description: "Synthetic email gate violation", inspectionDate: "2026-07-01", basicCategory: "hos_compliance", severityWeight: 5, portalUrl: `${portal}/safety` }),
    sendCaseStatusChange({ to, companyName: "TEST—Acme Freight Lines", caseType: "DataQ", caseNumber: "TEST-P6", oldStatus: "draft", newStatus: "investigating", portalUrl: `${portal}/cases` }),
    sendReportReady({ to, companyName: "TEST—Acme Freight Lines", reportTitle: "Synthetic safety report", reportDate: "2026-07-13", portalUrl: `${portal}/reports` }),
    sendRequestQueueReminder({ to, companyName: "TEST—Acme Freight Lines", requestTitle: "Synthetic evidence request", reminderNumber: 1, portalUrl: `${portal}/requests` }),
  ]);
  if (results.some((result) => !result.success)) throw new Error("At least one dry-run trigger failed");
  console.log(JSON.stringify({ dryRun: true, realSends: 0, triggers: ["portal_invite", "new_violation_detected", "case_status_change", "report_ready", "request_queue_reminder"] }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
