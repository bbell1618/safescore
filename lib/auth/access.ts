export type OnboardingAccessState = {
  status: string | null | undefined;
  service_agreement_accepted?: boolean | null | undefined;
};

/**
 * Active, paused, and churned are post-onboarding lifecycle states. Agreement
 * acceptance also closes profile/credential writes before checkout.
 */
export function isClientOnboardingLocked(
  client: OnboardingAccessState
): boolean {
  return (
    isClientPostOnboardingLifecycle(client) ||
    client.service_agreement_accepted === true
  );
}

/**
 * Lifecycle-only lock for access and billing decisions. Agreement acceptance
 * precedes the first checkout, so it must not block checkout or activation.
 */
export function isClientPostOnboardingLifecycle(
  client: Pick<OnboardingAccessState, "status">
): boolean {
  return (
    client.status === "active" ||
    client.status === "paused" ||
    client.status === "churned"
  );
}

const AUTH_CALLBACK_NEXT_ROOTS = ["/console", "/portal"] as const;
const AUTH_CALLBACK_EXACT_PATHS = new Set(["/update-password"]);

export function resolveAuthCallbackNext(
  requestedPath: string | null | undefined,
  fallback = "/console"
): string {
  if (!requestedPath) return fallback;

  try {
    const base = new URL("https://safescore.invalid");
    const candidate = new URL(requestedPath, base);
    if (candidate.origin !== base.origin) return fallback;

    const allowed =
      AUTH_CALLBACK_EXACT_PATHS.has(candidate.pathname) ||
      AUTH_CALLBACK_NEXT_ROOTS.some(
        (root) =>
          candidate.pathname === root ||
          candidate.pathname.startsWith(`${root}/`)
      );
    return allowed
      ? `${candidate.pathname}${candidate.search}`
      : fallback;
  } catch {
    return fallback;
  }
}
