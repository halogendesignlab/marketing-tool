"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useClient, SelectedClient } from "@/lib/client-context";

export default function SelectClientPage() {
  const { user, loading, logout } = useAuth();
  const { clients, loadingClients, selectClient, selectedClient } = useClient();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Single-client non-admins shouldn't land here — push them to dashboard
  useEffect(() => {
    const clientCount = user?.client_ids?.length ?? 0;
    if (user && user.role !== "admin" && clientCount <= 1) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  // If a client is already selected (e.g. back-nav), go straight to dashboard
  useEffect(() => {
    if (selectedClient) router.replace("/dashboard");
  }, [selectedClient, router]);

  if (loading || loadingClients || !user) return null;

  function handleSelect(client: SelectedClient) {
    selectClient(client);
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-ink-900 flex flex-col">
      {/* Minimal top bar */}
      <div className="bg-ink-800 border-b border-ink-600 px-6 py-3 flex items-center justify-between">
        <span className="font-sans font-bold text-fg-1 text-sm tracking-widest">HALOGEN</span>
        <button
          onClick={logout}
          className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150"
        >
          sign out
        </button>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <h1 className="font-sans font-semibold text-fg-1 text-2xl mb-1">Select a client</h1>
          <p className="text-sm text-fg-3 font-sans mb-8">
            Choose which client you want to work in. You can switch at any time.
          </p>

          {clients.length === 0 ? (
            <div className="text-sm text-fg-3 font-sans">No clients found.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSelect(client)}
                  className="text-left card hover:border-tint cursor-pointer transition-colors duration-150 group"
                >
                  <div className="font-sans font-medium text-fg-1 mb-1">
                    {client.name}
                  </div>
                  {client.industry && (
                    <div className="text-xs text-fg-3 font-sans mb-0.5">{client.industry}</div>
                  )}
                  {client.location && (
                    <div className="text-xs text-fg-3 font-sans">
                      {client.location.city}, {client.location.state}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
