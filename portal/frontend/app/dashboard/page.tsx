"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRequireClient } from "@/lib/use-require-client";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import Link from "next/link";
import { getPendingApprovals, getReviews } from "@/lib/api";

interface Stats {
  pendingApprovals: number;
  unrepliedReviews: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const ready = useRequireClient();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getPendingApprovals(),
      getReviews({ responded: false }),
    ]).then(([approvals, reviews]) => {
      setStats({
        pendingApprovals: approvals.length,
        unrepliedReviews: reviews.length,
      });
    });
  }, [user]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="font-sans font-semibold text-fg-1 text-xl mb-6">Dashboard</h1>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <Link
            href="/approvals"
            className="bg-ink-700 rounded-xl border border-ink-600 p-5 hover:border-tint transition-colors duration-150 block"
          >
            <div className="font-sans text-xs text-fg-3 uppercase tracking-widest mb-2">Pending approvals</div>
            <div className={`text-3xl font-semibold mb-1 font-sans ${(stats?.pendingApprovals ?? 0) > 0 ? "text-fg-1" : "text-fg-3"}`}>
              {stats?.pendingApprovals ?? "—"}
            </div>
          </Link>

          <div className="bg-ink-700 rounded-xl border border-ink-600 p-5">
            <div className="font-sans text-xs text-fg-3 uppercase tracking-widest mb-2">Reviews without response</div>
            <div className={`text-3xl font-semibold mb-1 font-sans ${(stats?.unrepliedReviews ?? 0) > 0 ? "text-fg-1" : "text-fg-3"}`}>
              {stats?.unrepliedReviews ?? "—"}
            </div>
          </div>
        </div>

        <div className="bg-ink-700 rounded-xl border border-ink-600 p-6">
          <h2 className="font-sans font-semibold text-fg-1 text-sm mb-4">Quick actions</h2>
          <div className="flex gap-3 flex-wrap">
            <Link
              href="/approvals"
              className="btn-primary"
            >
              Review pending content
            </Link>
            <Link
              href="/reports"
              className="btn-ghost"
            >
              View reports
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
