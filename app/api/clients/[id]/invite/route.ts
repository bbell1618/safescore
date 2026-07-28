import { sendInviteEmail } from "@/lib/email/client";
import {
  isValidInviteEmail,
  normalizeInviteEmail,
  resolveInviteEmailStatus,
} from "@/lib/portal/invites";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type StaffContext =
  | {
      serviceClient: Awaited<ReturnType<typeof createServiceClient>>;
      response?: never;
    }
  | {
      response: NextResponse;
      serviceClient?: never;
    };

async function requireStaff(): Promise<StaffContext> {
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError) {
    return {
      response: NextResponse.json(
        { error: `Unable to verify session: ${authError.message}` },
        { status: 401 }
      ),
    };
  }
  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const serviceClient = await createServiceClient();
  const { data: userRecord, error: roleError } = await serviceClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (roleError) {
    return {
      response: NextResponse.json(
        { error: `Unable to verify staff role: ${roleError.message}` },
        { status: 500 }
      ),
    };
  }
  if (
    userRecord?.role !== "geia_admin" &&
    userRecord?.role !== "geia_staff"
  ) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { serviceClient };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const staff = await requireStaff();
    if (staff.response) return staff.response;

    const { serviceClient } = staff;
    const [
      { data: client, error: clientError },
      { data: userRows, error: usersError },
      { data: inviteRows, error: invitesError },
    ] = await Promise.all([
      serviceClient.from("clients").select("id").eq("id", id).maybeSingle(),
      serviceClient
        .from("users")
        .select("id, email")
        .eq("client_id", id)
        .eq("role", "client_user")
        .order("email", { ascending: true }),
      serviceClient
        .from("client_invites")
        .select("id, email, created_at, expires_at")
        .eq("client_id", id)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: true }),
    ]);

    if (clientError) {
      return NextResponse.json(
        { error: `Unable to load client: ${clientError.message}` },
        { status: 500 }
      );
    }
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (usersError) {
      return NextResponse.json(
        { error: `Unable to load portal users: ${usersError.message}` },
        { status: 500 }
      );
    }
    if (invitesError) {
      return NextResponse.json(
        { error: `Unable to load pending invites: ${invitesError.message}` },
        { status: 500 }
      );
    }

    const portalUsers = await Promise.all(
      (userRows ?? []).map(async (userRow) => {
        const {
          data: { user },
          error,
        } = await serviceClient.auth.admin.getUserById(userRow.id);

        if (error) {
          throw new Error(
            `Unable to load last sign-in for ${userRow.email}: ${error.message}`
          );
        }

        return {
          id: userRow.id,
          email: userRow.email,
          lastSignInAt: user?.last_sign_in_at ?? null,
        };
      })
    );

    return NextResponse.json({
      portalUsers,
      pendingInvites: (inviteRows ?? []).map((invite) => ({
        id: invite.id,
        email: invite.email,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const staff = await requireStaff();
    if (staff.response) return staff.response;

    const { serviceClient } = staff;
    const body = (await request.json()) as { email?: unknown };
    const email = normalizeInviteEmail(body.email);

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }
    if (!isValidInviteEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 }
      );
    }

    const { data: client, error: clientError } = await serviceClient
      .from("clients")
      .select("id, name, primary_contact")
      .eq("id", id)
      .single();

    if (clientError) {
      return NextResponse.json(
        { error: `Unable to load client: ${clientError.message}` },
        { status: 500 }
      );
    }
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { data: linkedUsers, error: linkedUserError } =
      await serviceClient
        .from("users")
        .select("id, role, client_id")
        .ilike("email", email)
        .limit(1);
    if (linkedUserError) {
      return NextResponse.json(
        {
          error: `Unable to check existing portal access: ${linkedUserError.message}`,
        },
        { status: 500 }
      );
    }
    if ((linkedUsers ?? []).length > 0) {
      return NextResponse.json(
        {
          error:
            "This email is already linked to a SafeScore account. Use Reset password for an existing portal user.",
          code: "EMAIL_ALREADY_LINKED",
        },
        { status: 409 }
      );
    }

    const { data: invite, error: inviteError } = await serviceClient
      .from("client_invites")
      .insert({
        client_id: id,
        email,
      })
      .select("id, token, created_at, expires_at")
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: inviteError?.message ?? "Failed to create invite" },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();
    const { error: invalidateError } = await serviceClient
      .from("client_invites")
      .update({ expires_at: now })
      .eq("client_id", id)
      .eq("email", email)
      .neq("id", invite.id)
      .is("used_at", null)
      .gt("expires_at", now);

    if (invalidateError) {
      const { error: rollbackError } = await serviceClient
        .from("client_invites")
        .update({ expires_at: now })
        .eq("id", invite.id);
      return NextResponse.json(
        {
          error:
            `The replacement invite was created, but prior invites could not be expired: ${invalidateError.message}.` +
            (rollbackError
              ? ` The replacement invite also could not be revoked: ${rollbackError.message}`
              : " The replacement invite was revoked."),
        },
        { status: 500 }
      );
    }

    const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const baseUrl = (configuredBaseUrl || new URL(request.url).origin).replace(
      /\/+$/,
      ""
    );
    const setupUrl = `${baseUrl}/setup?token=${invite.token}`;
    const emailDryRun =
      process.env.EMAIL_DRY_RUN?.trim().toLowerCase() !== "false";

    const emailResult = await sendInviteEmail({
      to: email,
      companyName: client.name,
      contactName: client.primary_contact ?? undefined,
      magicLinkUrl: setupUrl,
    });
    const emailStatus = resolveInviteEmailStatus({
      dryRun: emailDryRun,
      deliverySucceeded: emailResult.success,
    });

    return NextResponse.json({
      success: true,
      emailSent: emailStatus === "sent",
      emailStatus,
      setupUrl,
      invite: {
        id: invite.id,
        email,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
      },
      message:
        emailStatus === "sent"
          ? `Invite sent to ${email}`
          : emailStatus === "dry_run"
            ? "Invite created in email dry-run mode. Share the setup link manually."
            : "Invite created, but email delivery failed. Share the setup link manually.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const staff = await requireStaff();
    if (staff.response) return staff.response;

    const body = (await request.json()) as { inviteId?: unknown };
    const inviteId =
      typeof body.inviteId === "string" ? body.inviteId.trim() : "";
    if (!inviteId) {
      return NextResponse.json(
        { error: "Invite ID is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { data: revoked, error: revokeError } = await staff.serviceClient
      .from("client_invites")
      .update({ expires_at: now })
      .eq("id", inviteId)
      .eq("client_id", id)
      .is("used_at", null)
      .gt("expires_at", now)
      .select("id")
      .maybeSingle();

    if (revokeError) {
      return NextResponse.json(
        { error: `Unable to revoke invite: ${revokeError.message}` },
        { status: 500 }
      );
    }
    if (!revoked) {
      return NextResponse.json(
        { error: "Pending invite not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, revokedInviteId: revoked.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
