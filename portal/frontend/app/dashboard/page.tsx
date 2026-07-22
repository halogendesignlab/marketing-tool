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
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Dashboard</h1>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <Link
            href="/approvals"
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 transition-colors block"
          >
            <div className={`text-3xl font-semibold mb-1 ${(stats?.pendingApprovals ?? 0) > 0 ? "text-gray-900" : "text-gray-400"}`}>
              {stats?.pendingApprovals ?? "—"}
            </div>
            <div className="text-sm text-gray-500">Pending approvals</div>
          </Link>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`text-3xl font-semibold mb-1 ${(stats?.unrepliedReviews ?? 0) > 0 ? "text-gray-900" : "text-gray-400"}`}>
              {stats?.unrepliedReviews ?? "—"}
            </div>
            <div className="text-sm text-gray-500">Google reviews without response</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Quick actions</h2>
          <div className="flex gap-3 flex-wrap">
            <Link
              href="/approvals"
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
            >
              Review pending content
            </Link>
            <Link
              href="/reports"
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
            >
              View reports
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
