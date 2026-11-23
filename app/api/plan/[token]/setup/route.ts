import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";

export const dynamic = "force-dynamic";

// QF-225: "no_login" replaces "need_help" (kept so older answers still read).
const FMCSA_METHODS = ["will_approve", "no_login", "need_help", "approved"] as const;

/**
 * QF-221: the short answers on the carrier's "what we still need" list that are not documents:
 * FMCSA Portal access, who handles safety day to day, and anything they want us to know.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const service = serviceClient();
    const now = new Date().toISOString();

    if (body.section === "fmcsa") {
      const method = FMCSA_METHODS.find((m) => m === body.method);
      if (!method) return NextResponse.json({ error: "Choose one option." }, { status: 400 });
      const { error } = await service.from("clients").update({ fmcsa_portal_access_method: method, fmcsa_portal_access_at: now }).eq("id", client.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const text = method === "will_approve" ? "Carrier has an FMCSA Portal login and will approve our access request"
        : method === "approved" ? "Carrier says they approved our FMCSA Portal access request"
        : "Carrier does not have an FMCSA Portal login yet (asked to make one)";
      await logPlanEvent(client.id, "carrier_fmcsa_access_answer", text, { method });
      return NextResponse.json({ ok: true });
    }

    if (body.section === "safety_contact") {
      const name = cleanString(body.name, 120);
      const phone = cleanString(body.phone, 40);
      const email = cleanString(body.email, 160).toLowerCase();
      if (!name || !phone) return NextResponse.json({ error: "Enter a name and a phone number." }, { status: 400 });
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "That email does not look right." }, { status: 400 });
      const { error } = await service.from("clients").update({
        safety_contact_name: name, safety_contact_phone: phone, safety_contact_email: email || null, safety_contact_confirmed_at: now,
      }).eq("id", client.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logPlanEvent(client.id, "carrier_safety_contact_saved", `Carrier named ${name} as the day-to-day safety contact`, { name });
      return NextResponse.json({ ok: true });
    }

    if (body.section === "notes") {
      const text = cleanString(body.text, 4000);
      const { error } = await service.from("clients").update({ carrier_notes: text || null, carrier_notes_at: text ? now : null }).eq("id", client.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (text) await logPlanEvent(client.id, "carrier_notes_saved", "Carrier wrote a note about their record", { length: text.length });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  });
}
