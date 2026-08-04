import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";

export class OnboardingRouteFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "OnboardingRouteFailure";
  }
}

export async function requirePortalOnboardingClient() {
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError) {
    throw new OnboardingRouteFailure(
      `Unable to verify session: ${authError.message}`,
      401,
      "SESSION_VERIFICATION_FAILED"
    );
  }
  if (!user) {
    throw new OnboardingRouteFailure("Unauthorized", 401, "UNAUTHORIZED");
  }

  const service = await createServiceClient();
  const { data: profile, error: profileError } = await service
    .from("users")
    .select("client_id, role")
    .eq("id", user.id)
    .single();
  if (profileError) {
    throw new OnboardingRouteFailure(
      `Unable to load portal account: ${profileError.message}`,
      500,
      "PORTAL_ACCOUNT_LOOKUP_FAILED"
    );
  }
  if (profile.role !== "client_user" || !profile.client_id) {
    throw new OnboardingRouteFailure("Forbidden", 403, "FORBIDDEN");
  }

  return { service, userId: user.id, clientId: profile.client_id as string };
}

export async function requireStaffOnboardingUser() {
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError) {
    throw new OnboardingRouteFailure(
      `Unable to verify session: ${authError.message}`,
      401,
      "SESSION_VERIFICATION_FAILED"
    );
  }
  if (!user) {
    throw new OnboardingRouteFailure("Unauthorized", 401, "UNAUTHORIZED");
  }

  const service = await createServiceClient();
  const { data: profile, error: profileError } = await service
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) {
    throw new OnboardingRouteFailure(
      `Unable to verify staff role: ${profileError.message}`,
      500,
      "STAFF_ROLE_LOOKUP_FAILED"
    );
  }
  if (profile.role !== "geia_admin" && profile.role !== "geia_staff") {
    throw new OnboardingRouteFailure("Forbidden", 403, "FORBIDDEN");
  }

  return { service, userId: user.id };
}

const TRANSITION_STATUS: Record<string, number> = {
  CLIENT_NOT_FOUND: 404,
  CLIENT_TIER_REQUIRED: 409,
  ONBOARDING_LOCKED: 409,
  SUBSCRIPTION_CHECKOUT_REQUIRED: 409,
  SERVICE_AGREEMENT_REQUIRED: 409,
  ASSESSMENT_REQUIRED: 409,
  AWAITING_ACTIVATION_REQUIRED: 409,
  TIER_MISMATCH: 409,
  INVALID_SUBSCRIPTION_TIER: 400,
  STRIPE_IDENTIFIERS_REQUIRED: 400,
  STRIPE_BILLING_PRESENT: 409,
  INVALID_MRR: 400,
  ONBOARDING_PROFILE_INCOMPLETE: 409,
};

export function transitionFailure(
  error: { message?: string | null } | null | undefined,
  fallback: string
): OnboardingRouteFailure {
  const raw = error?.message?.trim() || fallback;
  const separator = raw.indexOf(":");
  const possibleCode = (separator >= 0 ? raw.slice(0, separator) : "").trim();
  const code = TRANSITION_STATUS[possibleCode] ? possibleCode : "TRANSITION_FAILED";
  const message =
    code === "TRANSITION_FAILED"
      ? raw
      : raw.slice(separator + 1).trim() || fallback;
  return new OnboardingRouteFailure(
    message,
    TRANSITION_STATUS[code] ?? 500,
    code
  );
}
