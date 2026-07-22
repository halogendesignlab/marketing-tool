import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import { useClient } from "./client-context";

/**
 * Guards any page that requires both auth and a selected client.
 * - Unauthenticated users → /login
 * - Admins without a selected client → /select-client
 * - Non-admin users with multiple clients and no selection → /select-client
 * - Non-admin users with exactly one client (auto-selected) → ready immediately
 *
 * Returns true when it's safe to render the page.
 */
export function useRequireClient(): boolean {
  const { user, loading } = useAuth();
  const { selectedClient, clients, loadingClients } = useClient();
  const router = useRouter();

  const needsPicker =
    user?.role === "admin" || (user?.client_ids ?? []).length > 1;

  useEffect(() => {
    if (loading || loadingClients) return;
    if (!user) {
      router.replace("/login");
    } else if (!selectedClient && needsPicker) {
      router.replace("/select-client");
    }
  }, [user, loading, selectedClient, loadingClients, needsPicker, router]);

  if (loading || loadingClients || !user) return false;
  // Single-client users are always ready once loading is done (client auto-selected)
  if (!needsPicker) return true;
  return !!selectedClient;
}
