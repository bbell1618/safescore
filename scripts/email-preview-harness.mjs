import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// No application environment, credentials, SMTP, fetch, or Supabase is available.
// Execute the actual template bodies with their private sender replaced by a capture.
export async function collectEmailPreviews() {
  const captures = [];
  const compile = path => ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const copyModule = { exports: {} };
  vm.runInNewContext(compile("lib/email/copy.ts"), { module: copyModule, exports: copyModule.exports });
  const templateModule = { exports: {} };
  const denied = () => { throw new Error("Network/transport is forbidden in email previews"); };
  const context = {
    module: templateModule, exports: templateModule.exports,
    process: { env: { EMAIL_DRY_RUN: "true" } },
    console: { log: denied, info: denied, error: denied },
    require: name => {
      if (name === "nodemailer") return { createTransport: denied };
      if (name === "./copy") return copyModule.exports;
      throw new Error(`Unexpected preview import: ${name}`);
    },
    captureSend: async message => { captures.push(message); return { success: true, dryRun: true }; },
  };
  vm.runInNewContext(compile("lib/email/client.ts") + "\nsendEmail = captureSend;", context);
  const base = {
    to: "brandonbell@goldenerainsurance.com", companyName: "Nationwide Carrier Inc",
    dotNumber: "2533650", portalUrl: "https://safescore.vercel.app/portal",
  };
  const requestTitle = "Send the court's final result for this ticket";
  const fixtures = [
    ["activation", "sendSafeScoreLiveEmail", { tierLabel: "Total Safety" }],
    ["federal-account-pin", "sendFmcsaPinRequestEmail", {}],
    ["driver-roster", "sendDriverRosterRequestEmail", { rosterUrl: "https://safescore.vercel.app/portal/documents" }],
    ["new-violation", "sendNewViolationAlert", { violationCode: "396.3(a)(1)", description: "Vehicle maintenance record missing", inspectionDate: "September 23, 2026", basicCategory: "vehicle_maintenance", severityWeight: 2 }],
    ["crash-review", "sendCaseStatusChange", { caseType: "CPDP", oldStatus: "filed", newStatus: "determination_made" }],
    ["record-correction", "sendCaseStatusChange", { caseType: "DataQ", oldStatus: "filed", newStatus: "pending_state" }],
    ["report-delivery", "sendReportReady", { reportTitle: "Monthly safety update", reportDate: "September 23, 2026" }],
    ["welcome", "sendWelcomeEmail", { userFullName: "Brandon" }],
    ["invite", "sendInviteEmail", { contactName: "Brandon", magicLinkUrl: "https://safescore.vercel.app/login" }],
    ["password-recovery", "sendPasswordRecoveryEmail", { clientId: "preview-only", resetUrl: "https://safescore.vercel.app/update-password" }],
    ["request-reminder", "sendRequestQueueReminder", { requestTitle, reminderNumber: 1, reminderLimit: 3 }],
    ["court-document", "sendEvidenceRequestCreated", { requestTitle, whyCopy: "This could remove 12 points if the court dismissed or reduced the ticket." }],
    ["court-question", "sendEvidenceIntakeQuestion", { question: "Did the court dismiss or reduce this ticket?" }],
  ];
  assert.deepEqual(
    Object.keys(templateModule.exports).filter(name => name.startsWith("send") && name !== "sendOperationsNotification").sort(),
    [...new Set(fixtures.map(([, name]) => name))].sort(),
    "Every client-facing application email must have a preview"
  );
  const previews = [];
  for (const [name, fn, input] of fixtures) {
    const before = captures.length;
    await templateModule.exports[fn]({ ...base, ...input });
    assert.equal(captures.length, before + 1, `${fn} must render one email without transport`);
    previews.push({ name, function: fn, ...captures.at(-1) });
  }
  return previews;
}
