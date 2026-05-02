"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getPendingApprovals, getReviews, getAssets } from "@/lib/api";

interface Stats {
  pendingApprovals: number;
  pendingAssets: number;
  unrepliedReviews: number;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getPendingApprovals(),
      getAssets({ status: "pending" }),
      getReviews({ responded: false }),
    ]).then(([approvals, assets, reviews]) => {
      setStats({
        pendingApprovals: approvals.length,
        pendingAssets: assets.length,
        unrepliedReviews: reviews.length,
      });
    });
  }, [user]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Dashboard</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Pending approvals"
            value={stats?.pendingApprovals ?? "—"}
            href="/approvals"
            urgent={(stats?.pendingApprovals ?? 0) > 0}
          />
          <StatCard
            label="Assets to review"
            value={stats?.pendingAssets ?? "—"}
            href="/assets"
            urgent={(stats?.pendingAssets ?? 0) > 0}
          />
          <StatCard
            label="Reviews awaiting response"
            value={stats?.unrepliedReviews ?? "—"}
            href="/reviews"
            urgent={(stats?.unrepliedReviews ?? 0) > 0}
          />
        </div>

        {/* Quick links */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Quick actions</h2>
          <div className="flex gap-3 flex-wrap">
            <ActionButton href="/approvals" label="Review pending content" />
            <ActionButton href="/assets" label="Review image assets" />
            <ActionButton href="/reviews" label="Approve review responses" />
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  urgent,
}: {
  label: string;
  value: number | string;
  href: string;
  urgent?: boolean;
}) {
  return (
    <a
      href={href}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 transition-colors block"
    >
      <div className={`text-3xl font-semibold mb-1 ${urgent ? "text-gray-900" : "text-gray-400"}`}>
        {value}
      </div>
      <div className="text-sm text-gray-500">{label}</div>
    </a>
  );
}

function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
    >
      {label}
    </a>
  );
}
