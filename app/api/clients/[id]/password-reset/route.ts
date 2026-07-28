import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appOrigin(request: Request): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: clientId } = await params;
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError) {
    return NextResponse.json(
      { error: `Unable to verify session: ${authError.message}` },
      { status: 401 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = await createServiceClient();
  const { data: staff, error: staffError } = await service
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (staffError) {
    return NextResponse.json(
      { error: `Unable to verify staff role: ${staffError.message}` },
      { status: 500 }
    );
  }
  if (staff.role !== "geia_admin" && staff.role !== "geia_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let email: string;
  try {
    const body = await request.json();
    email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 400 }
    );
  }

  const emailDryRun =
    (process.env.EMAIL_DRY_RUN ?? "").trim().toLowerCase() !== "false";
  if (!emailDryRun) {
    return NextResponse.json(
      {
        error:
          "Staff-copyable recovery links are available only while email dry-run is enabled.",
      },
      { status: 409 }
    );
  }

  const { data: portalUser, error: portalUserError } = await service
    .from("users")
    .select("id, email")
    .eq("client_id", clientId)
    .eq("role", "client_user")
    .ilike("email", email)
    .maybeSingle();
  if (portalUserError) {
    return NextResponse.json(
      {
        error: `Unable to verify the linked portal user: ${portalUserError.message}`,
      },
      { status: 500 }
    );
  }
  if (!portalUser) {
    return NextResponse.json(
      { error: "Linked portal user not found" },
      { status: 404 }
    );
  }

  const { data: recovery, error: recoveryError } =
    await service.auth.admin.generateLink({
      type: "recovery",
      email: portalUser.email,
    });
  if (recoveryError) {
    return NextResponse.json(
      { error: recoveryError.message },
      { status: 500 }
    );
  }
  const tokenHash = recovery.properties?.hashed_token;
  if (!tokenHash) {
    return NextResponse.json(
      { error: "Supabase did not return a password recovery token" },
      { status: 500 }
    );
  }

  const origin = appOrigin(request);
  const resetUrl =
    `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}` +
    `&type=recovery&next=${encodeURIComponent("/update-password")}`;
  const auditResult = await service.from("activity_log").insert({
    client_id: clientId,
    user_id: user.id,
    action_type: "password_reset_link_generated",
    entity_type: "users",
    entity_id: portalUser.id,
    description: `Staff generated a dry-run password recovery link for ${portalUser.email}`,
    metadata: {
      email: portalUser.email,
      dry_run: true,
      email_sent: false,
    },
  });
  if (auditResult.error) {
    return NextResponse.json(
      {
        error: `Recovery link was generated, but its audit log failed: ${auditResult.error.message}`,
      },
      { status: 500 }
    );
  }

  console.info("[EMAIL_DRY_RUN] Staff password recovery link generated", {
    clientId,
    email: portalUser.email,
    resetUrl,
  });

  return NextResponse.json({
    success: true,
    dryRun: true,
    emailSent: false,
    email: portalUser.email,
    resetUrl,
    message:
      "Recovery link generated in dry-run mode. Copy it and share it securely with the account holder.",
  });
}
