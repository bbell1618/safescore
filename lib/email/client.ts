// ── Transport ──────────────────────────────────────────────────────────────
// SMTP transport. EMAIL_DRY_RUN defaults to true unless explicitly set to false.
// Required for a future live switch: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD.

import nodemailer from "nodemailer";

const DEFAULT_SENDER = "Golden Era SafeScore";
const DEFAULT_REPLY_TO = "info@goldenerainsurance.com";

async function sendEmail({
  to,
  subject,
  htmlBody,
  senderName,
  replyTo,
  cc,
  bcc,
  trigger,
  template,
}: {
  to: string;
  subject: string;
  htmlBody: string;
  senderName?: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  trigger: string;
  template: string;
}): Promise<{ success: boolean; messageId?: string; error?: string; dryRun?: boolean }> {
  const dryRun = process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false";
  if (dryRun) {
    console.log("EMAIL_DRY_RUN", JSON.stringify({ mode: "dry-run", trigger, recipient: to, subject, template }));
    return { success: true, dryRun: true };
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD;
  if (!host || !user || !pass) return { success: false, error: "SMTP is not configured" };

  try {
    const port = Number(process.env.SMTP_PORT ?? "587");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE?.trim().toLowerCase() === "true" || port === 465,
      auth: { user, pass },
    });
    const result = await transporter.sendMail({
      from: { name: senderName ?? DEFAULT_SENDER, address: process.env.SMTP_FROM ?? user },
      to,
      subject,
      html: htmlBody,
      replyTo: replyTo ?? process.env.EMAIL_REPLY_TO ?? DEFAULT_REPLY_TO,
      cc,
      bcc,
    });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("SMTP email error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ── Shared HTML wrapper ────────────────────────────────────────────────────

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', system-ui, sans-serif; background: #F4F4F4; color: #1E1C1A; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #F0E8DA; }
    .header { background: #1E1C1A; padding: 24px 32px; }
    .header-logo { font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2px; }
    .header-title { font-size: 18px; font-weight: 700; color: #ffffff; }
    .header-accent { display: inline-block; width: 24px; height: 3px; background: #C67A1E; margin-top: 8px; border-radius: 2px; }
    .body { padding: 32px; }
    .footer { padding: 20px 32px; border-top: 1px solid #F0E8DA; }
    .footer p { font-size: 11px; color: #6B6B6B; }
    h2 { font-size: 20px; font-weight: 700; color: #1E1C1A; margin-bottom: 8px; }
    p { font-size: 14px; color: #1E1C1A; line-height: 1.6; margin-bottom: 16px; }
    .label { font-size: 11px; color: #6B6B6B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .value { font-size: 14px; font-weight: 500; color: #1E1C1A; }
    .detail-row { padding: 12px 0; border-bottom: 1px solid #F0E8DA; }
    .detail-row:last-child { border-bottom: none; }
    .badge-red { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #F9E0DF; color: #C67A1E; font-size: 12px; font-weight: 600; }
    .badge-gold { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #F5EDDB; color: #8E7340; font-size: 12px; font-weight: 600; }
    .cta { display: inline-block; margin-top: 8px; padding: 12px 24px; background: #C67A1E; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Golden Era Insurance Agency</div>
      <div class="header-title">SafeScore</div>
      <div class="header-accent"></div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>Golden Era Insurance Agency | SafeScore | Confidential</p>
      <p style="margin-top:4px;">You are receiving this message about your SafeScore account.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Data interfaces ────────────────────────────────────────────────────────

export interface NewViolationEmailData {
  to: string;
  companyName: string;
  dotNumber: string;
  violationCode: string;
  description: string;
  inspectionDate: string;
  basicCategory: string;
  severityWeight: number;
  portalUrl: string;
}

export interface CaseStatusEmailData {
  to: string;
  companyName: string;
  caseType: "DataQ" | "CPDP";
  caseNumber?: string;
  oldStatus: string;
  newStatus: string;
  portalUrl: string;
}

export interface ReportReadyEmailData {
  to: string;
  companyName: string;
  reportTitle: string;
  reportDate: string;
  portalUrl: string;
}

export interface WelcomeEmailData {
  to: string;
  companyName: string;
  dotNumber: string;
  userFullName?: string;
  portalUrl: string;
}

export interface InviteEmailData {
  to: string;
  companyName: string;
  contactName?: string;
  magicLinkUrl: string;
}

export interface RequestQueueReminderData {
  to: string;
  companyName: string;
  requestTitle: string;
  reminderNumber: number;
  portalUrl: string;
}

// ── Send functions ─────────────────────────────────────────────────────────

export async function sendNewViolationAlert(
  data: NewViolationEmailData
): Promise<{ success: boolean }> {
  const html = emailWrapper(`
    <h2>New violation added</h2>
    <p>A new violation has been added to DOT ${data.dotNumber} — ${data.companyName}.</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div class="detail-row">
        <div class="label">Violation code</div>
        <div class="value" style="font-family:monospace;">${data.violationCode}</div>
      </div>
      <div class="detail-row">
        <div class="label">Description</div>
        <div class="value">${data.description}</div>
      </div>
      <div class="detail-row">
        <div class="label">Inspection date</div>
        <div class="value">${data.inspectionDate}</div>
      </div>
      <div class="detail-row">
        <div class="label">BASIC category</div>
        <div class="value">${data.basicCategory.replace(/_/g, " ")}</div>
      </div>
      <div class="detail-row">
        <div class="label">Severity weight</div>
        <div class="value"><span class="${data.severityWeight >= 8 ? "badge-red" : "badge-gold"}">${data.severityWeight}</span></div>
      </div>
    </div>
    <p>Log in to your SafeScore portal to review this violation and its impact on your safety profile.</p>
    <a href="${data.portalUrl}" class="cta">View in portal</a>
  `);

  const result = await sendEmail({
    to: data.to,
    subject: `New violation added — DOT ${data.dotNumber}`,
    htmlBody: html,
    trigger: "new_violation_detected",
    template: "new_violation_alert",
  });

  if (!result.success) {
    console.error("sendNewViolationAlert failed:", result.error);
  }

  return { success: result.success };
}

export async function sendCaseStatusChange(
  data: CaseStatusEmailData
): Promise<{ success: boolean }> {
  const html = emailWrapper(`
    <h2>${data.caseType} case status update</h2>
    <p>The status of a ${data.caseType} case for ${data.companyName} has changed.</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      ${data.caseNumber ? `<div class="detail-row"><div class="label">Case number</div><div class="value">${data.caseNumber}</div></div>` : ""}
      <div class="detail-row">
        <div class="label">Previous status</div>
        <div class="value">${data.oldStatus.replace(/_/g, " ")}</div>
      </div>
      <div class="detail-row">
        <div class="label">New status</div>
        <div class="value"><span class="badge-gold">${data.newStatus.replace(/_/g, " ")}</span></div>
      </div>
    </div>
    <a href="${data.portalUrl}" class="cta">View case</a>
  `);

  const result = await sendEmail({
    to: data.to,
    subject: `${data.caseType} case update — ${data.companyName}`,
    htmlBody: html,
    trigger: "case_status_change",
    template: "case_status_change",
  });

  if (!result.success) {
    console.error("sendCaseStatusChange failed:", result.error);
  }

  return { success: result.success };
}

export async function sendReportReady(
  data: ReportReadyEmailData
): Promise<{ success: boolean }> {
  const html = emailWrapper(`
    <h2>Your safety report is ready</h2>
    <p>A new report has been prepared for ${data.companyName}.</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div class="detail-row">
        <div class="label">Report</div>
        <div class="value">${data.reportTitle}</div>
      </div>
      <div class="detail-row">
        <div class="label">Date</div>
        <div class="value">${data.reportDate}</div>
      </div>
    </div>
    <p>Log in to your SafeScore portal to view and download your report.</p>
    <a href="${data.portalUrl}" class="cta">View report</a>
  `);

  const result = await sendEmail({
    to: data.to,
    subject: `Your SafeScore report is ready — ${data.reportTitle}`,
    htmlBody: html,
    trigger: "report_ready",
    template: "report_ready",
  });

  if (!result.success) {
    console.error("sendReportReady failed:", result.error);
  }

  return { success: result.success };
}

export async function sendWelcomeEmail(
  data: WelcomeEmailData
): Promise<{ success: boolean }> {
  const greeting = data.userFullName ? `Hi ${data.userFullName},` : "Welcome to SafeScore,";

  const html = emailWrapper(`
    <h2>${greeting}</h2>
    <p>Your SafeScore account for <strong>${data.companyName}</strong> (DOT ${data.dotNumber}) is now active.</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div class="detail-row"><div class="label">Company</div><div class="value">${data.companyName}</div></div>
      <div class="detail-row"><div class="label">DOT number</div><div class="value">${data.dotNumber}</div></div>
    </div>
    <p>Your portal will show the safety information included with your SafeScore service.</p>
    <a href="${data.portalUrl}" class="cta">Access your portal</a>
  `);

  const result = await sendEmail({
    to: data.to,
    subject: `Welcome to SafeScore — ${data.companyName}`,
    htmlBody: html,
    trigger: "account_welcome",
    template: "welcome",
  });

  if (!result.success) {
    console.error("sendWelcomeEmail failed:", result.error);
  }

  return { success: result.success };
}

export async function sendInviteEmail(
  data: InviteEmailData
): Promise<{ success: boolean }> {
  const greeting = data.contactName
    ? `Hi ${data.contactName},`
    : "You have been invited to SafeScore.";

  const html = emailWrapper(`
    <h2>${greeting}</h2>
    <p>Golden Era Insurance Agency has invited you to access the SafeScore safety portal for <strong>${data.companyName}</strong>.</p>
    <p>Click the button below to set up your account and view your safety dashboard.</p>
    <a href="${data.magicLinkUrl}" class="cta">Access your portal</a>
    <p style="margin-top:24px;font-size:12px;color:#6B6B6B;">This link expires in 7 days. If it expires, contact your GEIA representative to request a new one.</p>
  `);

  const result = await sendEmail({
    to: data.to,
    subject: `You're invited to SafeScore — ${data.companyName}`,
    htmlBody: html,
    trigger: "portal_invite",
    template: "portal_invite",
  });

  if (!result.success) {
    console.error("sendInviteEmail failed:", result.error);
  }

  return { success: result.success };
}

export async function sendRequestQueueReminder(
  data: RequestQueueReminderData
): Promise<{ success: boolean }> {
  const html = emailWrapper(`
    <h2>Document request reminder</h2>
    <p>${data.companyName} has an open SafeScore request.</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div class="detail-row"><div class="label">Request</div><div class="value">${data.requestTitle}</div></div>
      <div class="detail-row"><div class="label">Reminder</div><div class="value">${data.reminderNumber} of 3</div></div>
    </div>
    <a href="${data.portalUrl}" class="cta">Review request</a>
  `);
  const result = await sendEmail({
    to: data.to,
    subject: `SafeScore request reminder: ${data.requestTitle}`,
    htmlBody: html,
    trigger: "request_queue_reminder",
    template: "request_queue_reminder",
  });
  return { success: result.success };
}
