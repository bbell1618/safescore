import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { getTermsApproval } from "@/lib/legal/approval-server";
import { TERMS_HASH } from "@/lib/legal/terms";
import { TERMS_NOT_READY_MESSAGE } from "@/lib/legal/wording";

export const dynamic = "force-dynamic";

const FILING_SCOPE =
  "DataQs Requests for Data Review and Crash Preventability Determination (CPDP) requests filed by GEIA on the carrier behalf";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = cleanString(body.name, 120);
    const title = cleanString(body.title, 80);
    if (name.length < 3) return NextResponse.json({ error: "Type your full name." }, { status: 400 });
    if (!title) return NextResponse.json({ error: "Type your title (for example Owner)." }, { status: 400 });
    if (body.agreeService !== true || body.agreeFiling !== true) {
      return NextResponse.json({ error: "Check both boxes to sign." }, { status: 400 });
    }
    // A real carrier is never asked to rely on wording the owner has not approved.
    if (!client.is_practice && !(await getTermsApproval())) {
      return NextResponse.json({ error: TERMS_NOT_READY_MESSAGE }, { status: 409 });
    }
    const now = new Date().toISOString();
    const signer = `${name}, ${title}`;
    const { error } = await serviceClient()
      .from("clients")
      .update({
        service_agreement_accepted: true,
        service_agreement_date: now,
        filing_authorized: true,
        filing_authorized_at: now,
        filing_authorized_by: signer,
        filing_authorization_scope: FILING_SCOPE,
        fmcsa_authorized: true,
        fmcsa_auth_date: now,
        primary_contact: client.primary_contact ?? name,
        primary_contact_title: client.primary_contact_title ?? title,
      })
      .eq("id", client.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logPlanEvent(client.id, "plan_authorization_signed", `${signer} signed the service agreement and filing authorization`, {
      signer,
      termsHash: TERMS_HASH,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, signedBy: signer, signedAt: now });
  });
}
