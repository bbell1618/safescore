import nodemailer from "nodemailer";

const FROM_ADDRESS = "safescore@goldenerainsurance.com";
const FROM_NAME = "Golden Era SafeScore";

function getTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: FROM_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
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
    body { font-family: 'Inter', system-ui, sans-serif; background: #F4F4F4; color: #1A1A1A; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #E5E5E5; }
    .header { background: #1A1A1A; padding: 24px 32px; }
    .header-logo { font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2px; }
    .header-title { font-size: 18px; font-weight: 700; color: #ffffff; }
    .header-accent { display: inline-block; width: 24px; height: 3px; background: #DC362E; margin-top: 8px; border-radius: 2px; }
    .body { padding: 32px; }
    .footer { padding: 20px 32px; border-top: 1px solid #E5E5E5; }
    .footer p { font-size: 11px; color: #6B6B6B; }
    h2 { font-size: 20px; font-weight: 700; color: #1A1A1A; margin-bottom: 8px; }
    p { font-size: 14px; color: #1A1A1A; line-height: 1.6; margin-bottom: 16px; }
    .label { font-size: 11px; color: #6B6B6B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .value { font-size: 14px; font-weight: 500; color: #1A1A1A; }
    .detail-row { padding: 12px 0; border-bottom: 1px solid #E5E5E5; }
    .detail-row:last-child { border-bottom: none; }
    .badge-red { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #F9E0DF; color: #DC362E; font-size: 12px; font-weight: 600; }
    .badge-gold { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #F5EDDB; color: #8E7340; font-size: 12px; font-weight: 600; }
    .cta { display: inline-block; margin-top: 8px; padding: 12px 24px; background: #DC362E; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
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
      <p style="margin-top:4px;">You are receiving this because you are enrolled in the SafeScore monitoring program.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Template functions ─────────────────────────────────────────────────────

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

// ── Send functions ─────────────────────────────────────────────────────────

export async function sendNewViolationAlert(data: NewViolationEmailData): Promise<void> {
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
    <p>Log in to your SafeScore portal to review this violation and assess challengeability.</p>
    <a href="${data.portalUrl}" class="cta">View in portal</a>
  `);

  await getTransporter().sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: data.to,
    subject: `New violation added — DOT ${data.dotNumber}`,
    html,
  });
}

export async function sendCaseStatusChange(data: CaseStatusEmailData): Promise<void> {
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

  await getTransporter().sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: data.to,
    subject: `${data.caseType} case update — ${data.companyName}`,
    html,
  });
}

export async function sendReportReady(data: ReportReadyEmailData): Promise<void> {
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

  await getTransporter().sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: data.to,
    subject: `Your SafeScore report is ready — ${data.reportTitle}`,
    html,
  });
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
  const greeting = data.userFullName ? `Hi ${data.userFullName},` : "Welcome to SafeScore,";

  const html = emailWrapper(`
    <h2>${greeting}</h2>
    <p>Your SafeScore account for <strong>${data.companyName}</strong> (DOT ${data.dotNumber}) is now active. Your GEIA safety team is monitoring your DOT safety profile and will notify you of any issues.</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div class="detail-row"><div class="label">Company</div><div class="value">${data.companyName}</div></div>
      <div class="detail-row"><div class="label">DOT number</div><div class="value">${data.dotNumber}</div></div>
    </div>
    <p>Your full BASIC score analysis will be available in your portal within 24 hours.</p>
    <a href="${data.portalUrl}" class="cta">Access your portal</a>
  `);

  await getTransporter().sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: data.to,
    subject: `Welcome to SafeScore — ${data.companyName}`,
    html,
  });
}
