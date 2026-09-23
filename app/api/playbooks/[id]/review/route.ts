import { NextResponse } from "next/server";
import { z } from "zod";
import { OnboardingRouteFailure, requireStaffOnboardingUser } from "@/lib/onboarding/server";
import { tierHasFeature } from "@/lib/tiers";

const schema = z.object({ action: z.enum(["review", "publish"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service, userId } = await requireStaffOnboardingUser();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid playbook ID" }, { status: 400 });
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Choose review or publish" }, { status: 400 });
    const row = await service.from("client_playbooks").select("id,client_id,review_status").eq("id", id).maybeSingle();
    if (row.error) throw new Error(`Unable to load playbook: ${row.error.message}`);
    if (!row.data) return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
    const client = await service.from("clients").select("tier").eq("id", row.data.client_id).maybeSingle();
    if (client.error) throw new Error(`Unable to verify playbook tier: ${client.error.message}`);
    if (!client.data || !tierHasFeature(client.data.tier, "playbook_coach")) return NextResponse.json({ error: "This plan does not include a coaching playbook" }, { status: 403 });
    const expected = body.data.action === "review" ? "draft" : "reviewed";
    if (row.data.review_status !== expected) return NextResponse.json({ error: `Only a ${expected} playbook can be ${body.data.action === "review" ? "reviewed" : "published"}` }, { status: 409 });
    const now = new Date().toISOString();
    const update = body.data.action === "review"
      ? { review_status: "reviewed" as const, reviewed_by: userId, reviewed_at: now }
      : { review_status: "published" as const, published_by: userId, published_at: now };
    const saved = await service.from("client_playbooks").update(update)
      .eq("id", id).eq("client_id", row.data.client_id).eq("review_status", expected)
      .select("id,review_status,reviewed_at,published_at").maybeSingle();
    if (saved.error) throw new Error(`Unable to save playbook ${body.data.action}: ${saved.error.message}`);
    if (!saved.data) return NextResponse.json({ error: "Playbook changed during this action. Reload before trying again." }, { status: 409 });
    return NextResponse.json(saved.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown playbook review failure" },
      { status: error instanceof OnboardingRouteFailure ? error.status : 500 }
    );
  }
}
