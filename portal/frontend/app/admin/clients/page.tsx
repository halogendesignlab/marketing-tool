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
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-sans font-semibold text-fg-1 text-xl">Clients</h1>
          <Link
            href="/admin/clients/new"
            className="btn-primary"
          >
            Add client
          </Link>
        </div>

        {fetching && <p className="text-sm text-fg-3 font-sans">Loading…</p>}

        {!fetching && clients.length === 0 && (
          <div className="bg-ink-700 rounded-xl border border-ink-600 p-10 text-center">
            <p className="text-fg-3 font-sans text-sm mb-4">No clients yet.</p>
            <Link
              href="/admin/clients/new"
              className="btn-primary"
            >
              Add first client
            </Link>
          </div>
        )}

        {clients.length > 0 && (
          <div className="bg-ink-700 rounded-xl border border-ink-600 divide-y divide-ink-600">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-sans font-medium text-fg-1 text-sm">{c.brand_name}</span>
                    {!c.is_active && (
                      <span className="text-xs bg-ink-500 text-fg-3 font-sans px-2 py-0.5 rounded-md border border-ink-600">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-fg-3 font-sans mt-0.5">
                    {c.industry} · {c.location_city}, {c.location_state}
                  </p>
                </div>
                <Link
                  href={`/admin/clients/${c.id}`}
                  className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150"
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
