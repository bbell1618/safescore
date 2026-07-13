import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  category: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dedupeKey: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: userRecord } = await service
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (userRecord?.role !== "geia_admin" && userRecord?.role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { data: client } = await service.from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const now = new Date();
  const nextReminder = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from("client_requests")
    .upsert(
      {
        client_id: id,
        dedupe_key: `${id}:${parsed.data.dedupeKey}`,
        category: parsed.data.category,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: "open",
        responsibility: "client",
        source: "standing",
        next_reminder_at: nextReminder,
        closed_at: null,
        created_by: user.id,
        updated_at: now.toISOString(),
      },
      { onConflict: "dedupe_key" }
    )
    .select("id, status, next_reminder_at")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Request creation failed" }, { status: 500 });
  }

  return NextResponse.json({ request: data });
}
