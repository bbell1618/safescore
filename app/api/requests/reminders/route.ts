import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runDueClientRequestReminders } from "@/lib/request-queue/reminders";

export async function POST() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = await createServiceClient();
  const { data: staff } = await service.from("users").select("role").eq("id", user.id).single();
  if (!staff || !["geia_admin", "geia_staff"].includes(staff.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await runDueClientRequestReminders(service, {
      source: "staff_route",
    });
    return NextResponse.json(result, { status: result.failed > 0 ? 500 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Client request reminder processing failed",
      },
      { status: 500 }
    );
  }
}
