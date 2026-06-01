import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getAdmin();

  // ── 1. Fetch case + client info ───────────────────────────────────────────
  const { data: c, error: caseError } = await supabase
    .from("dataq_cases")
    .select(
      "id, client_id, canonical_inspection_date, clients(name, email), violations(violation_code, violation_description), inspections(inspection_date)"
    )
    .eq("id", id)
    .single();

  if (caseError || !c) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const clientRaw = c.clients as unknown;
  const client = (Array.isArray(clientRaw) ? clientRaw[0] : clientRaw) as {
    name: string;
    email: string | null;
  } | null;
  const violationRaw = c.violations as unknown;
  const violation = (
    Array.isArray(violationRaw) ? violationRaw[0] : violationRaw
  ) as { violation_code: string; violation_description: string } | null;
  const inspectionRaw = c.inspections as unknown;
  const inspection = (
    Array.isArray(inspectionRaw) ? inspectionRaw[0] : inspectionRaw
  ) as { inspection_date: string } | null;

  if (!client) {
    return NextResponse.json({ error: "Client data missing" }, { status: 400 });
  }

  if (!client.email) {
    return NextResponse.json(
      { error: "Client has no email address on file" },
      { status: 400 }
    );
  }

  // ── 2. Upsert evidence request record ─────────────────────────────────────
  // If a record already exists for this case: regenerate token, reset expiry, clear used_at.
  // If no record: INSERT using DB defaults for token and expires_at.
  const { data: existing } = await supabase
    .from("dataq_evidence_request")
    .select("id")
    .eq("case_id", id)
    .maybeSingle();

  let token: string;

  if (existing) {
    // Regenerate: new token, reset expiry 30 days from now, clear used_at
    const newToken = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: refreshed, error: refreshError } = await supabase
      .from("dataq_evidence_request")
      .update({ token: newToken, expires_at: expiresAt, used_at: null })
      .eq("case_id", id)
      .select("token")
      .single();

    if (refreshError || !refreshed) {
      return NextResponse.json(
        { error: "Failed to regenerate evidence request token" },
        { status: 500 }
      );
    }

    token = refreshed.token as string;
  } else {
    // New record — use DB defaults for token and expires_at
    const { data: inserted, error: insertError } = await supabase
      .from("dataq_evidence_request")
      .insert({ case_id: id })
      .select("token")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: "Failed to create evidence request" },
        { status: 500 }
      );
    }

    token = inserted.token as string;
  }

  // ── 3. Build upload URL ────────────────────────────────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const uploadUrl = `${appUrl}/evidence/${token}`;

  // ── 4. Build email body ────────────────────────────────────────────────────
  const inspectionDate =
    (c.canonical_inspection_date as string | null) ??
    inspection?.inspection_date ??
    "the inspection date";

  const violationLabel = violation
    ? `${violation.violation_code} — ${violation.violation_description}`
    : "the cited violation";

  const htmlBody = `
    <h2>Documents needed for your DataQs challenge</h2>
    <p>We are preparing a DataQs challenge on your behalf for the following violation:</p>
    <div style="background:#F4F4F4;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Carrier</div>
        <div style="font-size:14px;font-weight:500;">${client.name}</div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Violation</div>
        <div style="font-size:14px;font-weight:500;">${violationLabel}</div>
      </div>
      <div>
        <div style="font-size:11px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Inspection date</div>
        <div style="font-size:14px;font-weight:500;">${inspectionDate}</div>
      </div>
    </div>
    <p>To proceed with the challenge, we need supporting documentation from you. Please use the secure upload link below to submit your documents. The link expires in 30 days.</p>
    <a href="${uploadUrl}" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#C67A1E;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Upload documents</a>
    <p style="margin-top:24px;font-size:12px;color:#6B6B6B;">If you have questions, reply to this email or contact your Golden Era representative. Do not share this link with others — it is specific to this case.</p>
  `;

  // ── 5. Fire n8n email webhook ─────────────────────────────────────────────
  const webhookUrl = process.env.N8N_EMAIL_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_EMAIL_WEBHOOK_SECRET;

  if (webhookUrl) {
    try {
      const emailRes = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(webhookSecret ? { "X-Webhook-Secret": webhookSecret } : {}),
        },
        body: JSON.stringify({
          to: client.email,
          subject: `Documents needed for your DataQs challenge — ${client.name}`,
          htmlBody,
          senderName: "Golden Era SafeScore",
          replyTo: "info@goldenerainsurance.com",
        }),
      });

      if (!emailRes.ok) {
        console.error(
          "Evidence request email webhook failed:",
          emailRes.status,
          await emailRes.text()
        );
      }
    } catch (err) {
      console.error("Evidence request email webhook error:", err);
    }
  } else {
    console.warn("N8N_EMAIL_WEBHOOK_URL not configured — evidence request email not sent");
  }

  // ── 6. Return result ──────────────────────────────────────────────────────
  return NextResponse.json({ ok: true, token, uploadUrl, copyLink: uploadUrl });
}
