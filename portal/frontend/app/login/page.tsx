"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import toast from "react-hot-toast";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const me = await login(email, password);
      router.push(me?.role === "client" ? "/approvals" : "/dashboard");
    } catch {
      toast.error("Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-900 flex items-center justify-center px-4 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, #E9EFEB 0%, rgba(247,248,250,0) 70%)",
        }}
      />
      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-tint text-white font-display font-bold text-lg shadow-lift mb-5">
            H
          </div>
          <h1 className="font-display text-[32px] leading-tight font-semibold text-fg-1 tracking-tight">
            Welcome back
          </h1>
          <p className="text-fg-2 text-sm mt-2">Sign in to the Halogen marketing portal</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-ink-600 rounded-2xl p-8 space-y-5 shadow-pop"
        >
          <div>
            <label className="block text-fg-1 text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-fg-1 text-sm font-medium mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
