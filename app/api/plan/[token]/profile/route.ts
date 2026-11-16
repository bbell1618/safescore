import { NextResponse } from "next/server";
import { cleanString, logPlanEvent, withPlanClient } from "@/lib/autopilot/plan-actions";
import { serviceClient } from "@/lib/autopilot/queue";
import { PLAN_RADIUS, PLAN_VEHICLE_TYPES, US_STATES } from "@/lib/autopilot/plan-options";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * QF-215: the carrier's own answers on the plan page.
 *  - section "details": step 1 of sign-up. We prefill from the DOT record and the client file; they fix and confirm.
 *  - section "operation": homework after payment (distance, states, truck types).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return withPlanClient(params, async (client) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const service = serviceClient();

    if (body.section === "details") {
      const name = cleanString(body.contactName, 120);
      const title = cleanString(body.contactTitle, 80);
      const phone = cleanString(body.phone, 40);
      const email = cleanString(body.email, 160).toLowerCase();
      const drivers = Number(body.driverCount);
      const trucks = body.truckCount === "" || body.truckCount === null || body.truckCount === undefined ? null : Number(body.truckCount);
      if (name.length < 3) return NextResponse.json({ error: "Type the name of the person we should talk to." }, { status: 400 });
      if (phone.replace(/\D/g, "").length < 10) return NextResponse.json({ error: "Enter a phone number with area code." }, { status: 400 });
      if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
      if (!Number.isInteger(drivers) || drivers < 1 || drivers > 5000) return NextResponse.json({ error: "Enter how many drivers you have." }, { status: 400 });
      if (trucks !== null && (!Number.isInteger(trucks) || trucks < 1 || trucks > 5000)) return NextResponse.json({ error: "Enter how many trucks you have." }, { status: 400 });

      const patch: Record<string, unknown> = {
        primary_contact: name,
        primary_contact_title: title || client.primary_contact_title,
        phone,
        driver_count: drivers,
        details_confirmed_at: new Date().toISOString(),
        status: client.status === "prospect" ? "onboarding" : client.status,
      };
      if (trucks !== null) patch.fleet_size = trucks;
      // A practice copy keeps its practice address no matter what is typed here.
      const emailChanged = !client.is_practice && email !== (client.email ?? "").toLowerCase();
      if (emailChanged) { patch.email = email; patch.contact_source = "carrier"; }
      const { error } = await service.from("clients").update(patch).eq("id", client.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logPlanEvent(client.id, "plan_details_confirmed", `${name} confirmed the company details`, {
        driverCount: drivers, truckCount: trucks, emailChanged, previousEmail: emailChanged ? client.email : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.section === "operation") {
      const radius = PLAN_RADIUS.find((r) => r.value === body.operatingRadius)?.value;
      if (!radius) return NextResponse.json({ error: "Choose how far your trucks go." }, { status: 400 });
      const states = (Array.isArray(body.operatingStates) ? body.operatingStates : [])
        .map((s) => String(s).toUpperCase())
        .filter((s) => (US_STATES as readonly string[]).includes(s));
      if (states.length === 0) return NextResponse.json({ error: "Choose at least one state you drive in." }, { status: 400 });
      const vehicles = (Array.isArray(body.vehicleTypes) ? body.vehicleTypes : [])
        .map(String)
        .filter((v) => (PLAN_VEHICLE_TYPES as readonly string[]).includes(v));
      if (vehicles.length === 0) return NextResponse.json({ error: "Choose at least one truck type." }, { status: 400 });
      const { error } = await service.from("clients").update({ operating_radius: radius, operating_states: states, vehicle_types: vehicles }).eq("id", client.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logPlanEvent(client.id, "plan_operation_answered", "Carrier answered how they run", { radius, states: states.length, vehicles });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  });
}
