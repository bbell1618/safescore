"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  Mail,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type PortalUser = {
  id: string;
  email: string;
  lastSignInAt: string | null;
};

type PendingInvite = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
};

type PortalAccessData = {
  portalUsers: PortalUser[];
  pendingInvites: PendingInvite[];
};

type InviteResult = {
  emailSent: boolean;
  emailStatus: "sent" | "dry_run" | "failed";
  setupUrl: string;
  message: string;
};

type PasswordResetResult = {
  email: string;
  emailSent: boolean;
  resetUrl: string;
  message: string;
};

type ErrorBody = {
  error?: string;
};

function formatTimestamp(value: string | null, emptyLabel = "Never") {
  if (!value) return emptyLabel;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ErrorBody;
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function PortalAccessCard({
  clientId,
  defaultEmail,
}: {
  clientId: string;
  defaultEmail?: string | null;
}) {
  const [access, setAccess] = useState<PortalAccessData | null>(null);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [passwordReset, setPasswordReset] =
    useState<PasswordResetResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetCopied, setResetCopied] = useState(false);

  const loadAccess = useCallback(async () => {
    const response = await fetch(`/api/clients/${clientId}/invite`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        await readError(response, "Unable to load portal access")
      );
    }

    const body = (await response.json()) as PortalAccessData;
    setAccess(body);
  }, [clientId]);

  useEffect(() => {
    let active = true;

    void loadAccess()
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load portal access"
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadAccess]);

  async function invitePortalUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch(`/api/clients/${clientId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Unable to create invite"));
      }

      const body = (await response.json()) as InviteResult;
      setResult(body);
      await loadAccess();
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : "Unable to create invite"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setRevokingId(inviteId);
    setError(null);

    try {
      const response = await fetch(`/api/clients/${clientId}/invite`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Unable to revoke invite"));
      }

      await loadAccess();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Unable to revoke invite"
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function generatePasswordReset(user: PortalUser) {
    setResettingUserId(user.id);
    setError(null);
    setPasswordReset(null);
    setResetCopied(false);

    try {
      const response = await fetch(
        `/api/clients/${clientId}/password-reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email }),
        }
      );
      if (!response.ok) {
        throw new Error(
          await readError(response, "Unable to generate recovery link")
        );
      }
      setPasswordReset((await response.json()) as PasswordResetResult);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Unable to generate recovery link"
      );
    } finally {
      setResettingUserId(null);
    }
  }

  async function copySetupLink() {
    if (!result?.setupUrl) return;

    try {
      await navigator.clipboard.writeText(result.setupUrl);
      setCopied(true);
    } catch (copyError) {
      setError(
        copyError instanceof Error
          ? `Unable to copy setup link: ${copyError.message}`
          : "Unable to copy setup link"
      );
    }
  }

  async function copyResetLink() {
    if (!passwordReset?.resetUrl) return;
    try {
      await navigator.clipboard.writeText(passwordReset.resetUrl);
      setResetCopied(true);
    } catch (copyError) {
      setError(
        copyError instanceof Error
          ? `Unable to copy recovery link: ${copyError.message}`
          : "Unable to copy recovery link"
      );
    }
  }

  return (
    <section className="bg-[#FBF7F0] rounded-xl border border-[#F0E8DA] p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg border border-[#F0E8DA] bg-white p-2 text-[#C67A1E]">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-[#1E1C1A] text-sm">
            Portal access
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Manage linked portal users and time-limited setup invitations.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[#B83B32]/20 bg-[#FAECEB] px-3 py-2 text-sm text-[#B83B32]"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Linked users
              </h3>
              <span className="text-xs text-gray-400">
                {access?.portalUsers.length ?? 0}
              </span>
            </div>

            {loading ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Loading portal users...
              </p>
            ) : access?.portalUsers.length ? (
              <ul className="mt-2 divide-y divide-[#F0E8DA] rounded-lg border border-[#F0E8DA] bg-white/60">
                {access.portalUsers.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-start gap-3 px-3 py-3"
                  >
                    <UserRound
                      className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium text-[#1E1C1A]">
                        {user.email}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Last sign-in: {formatTimestamp(user.lastSignInAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={resettingUserId === user.id}
                      onClick={() => void generatePasswordReset(user)}
                      className="shrink-0 text-xs font-medium text-[#C67A1E] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {resettingUserId === user.id
                        ? "Generating..."
                        : "Reset password"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-lg border border-dashed border-[#F0E8DA] px-3 py-3 text-sm text-gray-500">
                No portal users are linked to this client.
              </p>
            )}
            {passwordReset ? (
              <div
                aria-live="polite"
                className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <p className="text-sm font-medium text-amber-900">
                  Recovery link for {passwordReset.email}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  {passwordReset.message}
                </p>
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs text-gray-600">
                    {passwordReset.resetUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyResetLink()}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-[#C67A1E] hover:underline"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {resetCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Pending invites
              </h3>
              <span className="text-xs text-gray-400">
                {access?.pendingInvites.length ?? 0}
              </span>
            </div>

            {!loading && access?.pendingInvites.length ? (
              <ul className="mt-2 divide-y divide-[#F0E8DA] rounded-lg border border-[#F0E8DA] bg-white/60">
                {access.pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-3 px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium text-[#1E1C1A]">
                        {invite.email}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Expires {formatTimestamp(invite.expiresAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={revokingId === invite.id}
                      onClick={() => void revokeInvite(invite.id)}
                      className="shrink-0 text-xs font-medium text-[#B83B32] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {revokingId === invite.id ? "Revoking..." : "Revoke"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : !loading ? (
              <p className="mt-2 rounded-lg border border-dashed border-[#F0E8DA] px-3 py-3 text-sm text-gray-500">
                No unexpired pending invites.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[#F0E8DA] bg-white/60 p-4">
          <h3 className="text-sm font-semibold text-[#1E1C1A]">
            Invite a portal user
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Setup links expire after seven days. The link remains copyable when
            email is in dry-run mode or delivery fails.
          </p>

          <form onSubmit={invitePortalUser} className="mt-4">
            <label
              htmlFor="portal-invite-email"
              className="text-xs font-medium text-gray-600"
            >
              Email address
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Mail
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
                <input
                  id="portal-invite-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="contact@carrier.com"
                  className="w-full rounded-lg border border-[#F0E8DA] bg-white py-2 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="rounded-lg bg-[#C67A1E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#B86E18] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create invite"}
              </button>
            </div>
          </form>

          {result ? (
            <div
              aria-live="polite"
              className="mt-4 rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] p-3"
            >
              <div className="flex items-start gap-2">
                {result.emailStatus === "sent" ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-green-600"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="text-sm font-medium text-[#1E1C1A]">
                    {result.emailStatus === "sent"
                      ? "Email sent"
                      : result.emailStatus === "dry_run"
                        ? "Email not sent — dry-run mode"
                        : "Email delivery failed"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {result.message}
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium text-gray-500">Setup link</p>
                <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-[#F0E8DA] bg-white px-3 py-2.5">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs text-gray-600">
                    {result.setupUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copySetupLink()}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-[#C67A1E] hover:underline"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
