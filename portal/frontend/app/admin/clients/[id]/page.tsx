"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import ClientForm, { ClientDetail } from "@/components/ClientForm";
import { getClientDetail, triggerDriveSync } from "@/lib/api";
import toast from "react-hot-toast";

export default function EditClientPage() {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.replace("/dashboard");
  }, [user, loading, isAdmin, router]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    getClientDetail(id)
      .then(setClient)
      .finally(() => setFetching(false));
  }, [user, isAdmin, id]);

  const handleDriveSync = async () => {
    setSyncing(true);
    try {
      const result = await triggerDriveSync(id);
      if (result.imported > 0) {
        toast.success(`Synced ${result.imported} new photo${result.imported !== 1 ? "s" : ""} from Drive`);
      } else {
        toast.success("Drive sync complete — no new photos");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Drive sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-3xl mx-auto px-6 py-8">
        {fetching && <p className="text-sm text-fg-3 font-sans">Loading…</p>}
        {!fetching && !client && <p className="text-sm text-signal-bad font-sans">Client not found.</p>}
        {client && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="font-sans font-semibold text-fg-1 text-xl">{client.brand_name}</h1>
              {client.drive_folder_id && (
                <button
                  onClick={handleDriveSync}
                  disabled={syncing}
                  className="btn-ghost disabled:opacity-50"
                >
                  {syncing ? "Syncing…" : "Sync from Drive"}
                </button>
              )}
            </div>
            <ClientForm initial={client} />
          </>
        )}
      </main>
    </div>
  );
}
