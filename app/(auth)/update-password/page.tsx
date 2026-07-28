"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(`Unable to update password: ${updateError.message}`);
      setSaving(false);
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });
    if (signOutError) {
      setError(
        `Password updated, but the recovery session could not be cleared: ${signOutError.message}`
      );
      setSaving(false);
      return;
    }

    window.location.replace("/login?password_reset=success");
  }

  return (
    <main className="min-h-screen bg-[#FEFCF8] px-4 py-16">
      <div className="mx-auto max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs uppercase tracking-widest text-gray-500">
            Golden Era SafeScore
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#1E1C1A]">
            Choose a new password
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-[#F0E8DA] bg-[#FBF7F0] p-8 shadow-sm"
        >
          <div>
            <label
              htmlFor="new-password"
              className="mb-1 block text-sm font-medium text-[#1E1C1A]"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1 block text-sm font-medium text-[#1E1C1A]"
            >
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-lg border border-[#F0E8DA] bg-[#FEFCF8] px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C67A1E]"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-[#B83B32]/20 bg-[#FAECEB] px-3 py-2 text-sm text-[#B83B32]"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[#C67A1E] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#B86E18] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Updating password…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
