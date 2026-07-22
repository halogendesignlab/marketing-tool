"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Nav from "@/components/Nav";
import { getClients } from "@/lib/api";

interface Client {
  id: number;
  client_id: string;
  brand_name: string;
  industry: string;
  location_city: string;
  location_state: string;
  is_active: boolean;
  created_at: string;
}

export default function AdminClientsPage() {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.replace("/dashboard");
  }, [user, loading, isAdmin, router]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    getClients()
      .then(setClients)
      .finally(() => setFetching(false));
  }, [user, isAdmin]);

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Clients</h1>
          <Link
            href="/admin/clients/new"
            className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
          >
            Add client
          </Link>
        </div>

        {fetching && <p className="text-sm text-gray-400">Loading…</p>}

        {!fetching && clients.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400 text-sm mb-4">No clients yet.</p>
            <Link
              href="/admin/clients/new"
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800"
            >
              Add first client
            </Link>
          </div>
        )}

        {clients.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{c.brand_name}</span>
                    {!c.is_active && (
                      <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {c.industry} · {c.location_city}, {c.location_state}
                  </p>
                </div>
                <Link
                  href={`/admin/clients/${c.id}`}
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  Edit →
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
