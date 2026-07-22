"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import Nav from "@/components/Nav";
import { changePassword } from "@/lib/api";

export default function ProfilePage() {
  const { user, loading } = useAuth();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (loading || !user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (next !== confirm) {
      setError("New passwords don't match");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    setSaving(true);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Something went wrong";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-md mx-auto px-6 py-12">
        <h1 className="font-sans font-semibold text-fg-1 text-xl mb-1">Account</h1>
        <p className="text-sm text-fg-3 font-sans mb-8">{user.email}</p>

        <div className="bg-ink-700 rounded-xl border border-ink-600 p-6">
          <h2 className="font-sans font-medium text-fg-2 text-sm mb-5">Change password</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-sans font-medium text-fg-2 mb-1">
                Current password
              </label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-fg-2 mb-1">
                New password
              </label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-sans font-medium text-fg-2 mb-1">
                Confirm new password
              </label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-signal-bad font-sans">{error}</p>
            )}
            {success && (
              <p className="text-sm text-signal-good font-sans">Password updated successfully.</p>
            )}

            <div className="pt-1">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary w-full flex items-center justify-center disabled:opacity-50"
              >
                {saving ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
