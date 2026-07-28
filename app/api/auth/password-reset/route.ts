import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function getAppOrigin(request: Request): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  return new URL(configuredUrl || request.url).origin;
}

export async function POST(request: Request) {
  let email: string;
  try {
    const body = await request.json();
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 400 }
    );
  }

  const origin = getAppOrigin(request);
  const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent("/update-password")}`;
  const emailDryRun =
    (process.env.EMAIL_DRY_RUN ?? "").trim().toLowerCase() !== "false";

  if (emailDryRun) {
    console.info("[EMAIL_DRY_RUN] Password recovery requested", {
      email,
    });

    return NextResponse.json({
      success: true,
      dryRun: true,
      emailSent: false,
      requiresStaffAssistance: true,
      message:
        "Email delivery is in dry-run mode. Contact the Golden Era SafeScore team for a secure recovery link.",
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    dryRun: false,
    emailSent: true,
    message: "If the account exists, a password reset email has been sent.",
  });
}
