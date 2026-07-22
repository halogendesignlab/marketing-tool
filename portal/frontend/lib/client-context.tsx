"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./auth-context";
import { getClients } from "./api";

export interface SelectedClient {
  id: number;
  name: string;
  client_id: string;
  industry?: string;
  location?: { city: string; state: string };
}

interface ClientContextType {
  selectedClient: SelectedClient | null;
  clients: SelectedClient[];
  loadingClients: boolean;
  selectClient: (client: SelectedClient) => void;
  clearClient: () => void;
}

const ClientContext = createContext<ClientContextType | null>(null);

/** Map the raw API ClientResponse shape → SelectedClient */
function mapClient(c: any): SelectedClient {
  return {
    id: c.id,
    name: c.brand_name ?? c.name ?? "",
    client_id: c.client_id,
    industry: c.industry || undefined,
    location:
      c.location_city
        ? { city: c.location_city, state: c.location_state }
        : c.location || undefined,
  };
}

export function ClientProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clients, setClients] = useState<SelectedClient[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!user) {
      setSelectedClient(null);
      setClients([]);
      setHydrated(true);
      return;
    }

    // Use getClients() for everyone — returns all accessible clients for the user.
    // Admins get all clients; client-role users get only their assigned ones.
    setLoadingClients(true);
    getClients()
      .then((list: any[]) => {
        const mapped = list.map(mapClient);
        setClients(mapped);

        if (mapped.length === 1 && !isAdmin) {
          // Single-client user: auto-select immediately, no picker needed
          setSelectedClient(mapped[0]);
        } else {
          // Admin or multi-client user: restore from localStorage if available
          const storedId = localStorage.getItem("selectedClientId");
          if (storedId) {
            const found = mapped.find((c) => c.id === parseInt(storedId));
            if (found) setSelectedClient(found);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoadingClients(false);
        setHydrated(true);
      });
  }, [user, isAdmin]);

  const selectClient = (client: SelectedClient) => {
    setSelectedClient(client);
    localStorage.setItem("selectedClientId", client.id.toString());
  };

  const clearClient = () => {
    setSelectedClient(null);
    localStorage.removeItem("selectedClientId");
  };

  if (!hydrated) return null;

  return (
    <ClientContext.Provider
      value={{ selectedClient, clients, loadingClients, selectClient, clearClient }}
    >
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClient must be used within ClientProvider");
  return ctx;
}
