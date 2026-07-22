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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Minimal top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <span className="font-semibold text-gray-900 text-sm">Halogen</span>
        <button
          onClick={logout}
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          Sign out
        </button>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">Select a client</h1>
          <p className="text-sm text-gray-500 mb-8">
            Choose which client you want to work in. You can switch at any time.
          </p>

          {clients.length === 0 ? (
            <div className="text-sm text-gray-400">No clients found.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSelect(client)}
                  className="text-left bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-400 hover:shadow-sm transition-all group"
                >
                  <div className="font-medium text-gray-900 group-hover:text-gray-900 mb-1">
                    {client.name}
                  </div>
                  {client.industry && (
                    <div className="text-xs text-gray-400 mb-0.5">{client.industry}</div>
                  )}
                  {client.location && (
                    <div className="text-xs text-gray-400">
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
