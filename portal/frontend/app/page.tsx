"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";

export default function Home() {
  const { user, loading } = useAuth();
  const { selectedClient, loadingClients } = useClient();
  const router = useRouter();

  useEffect(() => {
    if (loading || loadingClients) return;
    if (!user) {
      router.replace("/login");
    } else if (!selectedClient && user.role === "admin") {
      router.replace("/select-client");
    } else {
      router.replace("/dashboard");
    }
  }, [user, loading, selectedClient, loadingClients, router]);

  return null;
}
