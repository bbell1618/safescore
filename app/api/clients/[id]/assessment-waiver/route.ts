import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffOnboardingUser, OnboardingRouteFailure } from "@/lib/onboarding/server";
import { getAssessmentBilling } from "@/lib/billing/assessment";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service, userId } = await requireStaffOnboardingUser();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid client ID" }, { status: 400 });
    const parsed = z.object({ geiaInsured: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "geiaInsured must be a boolean" }, { status: 400 });
    const { data: client, error: clientError } = await service.from("clients").select("id").eq("id", id).maybeSingle();
    if (clientError) throw new Error(`Unable to load client: ${clientError.message}`);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const existing = await getAssessmentBilling(service, id);
    const patch = { geia_insured: parsed.data.geiaInsured, ...(parsed.data.geiaInsured ? { waived_by: userId, waived_at: new Date().toISOString() } : {}) };
    const result = existing
      ? await service.from("assessment_billing").update(patch).eq("client_id", id)
      : await service.from("assessment_billing").insert({ client_id: id, ...patch });
    if (result.error) throw new Error(`Unable to save Assessment waiver: ${result.error.message}`);
    return NextResponse.json({ billing: await getAssessmentBilling(service, id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof OnboardingRouteFailure ? error.status : 500 });
  }
}
