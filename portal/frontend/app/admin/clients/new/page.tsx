"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import ClientForm from "@/components/ClientForm";

export default function NewClientPage() {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.replace("/dashboard");
  }, [user, loading, isAdmin, router]);

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="font-sans font-semibold text-fg-1 text-xl mb-6">New client</h1>
        <ClientForm />
      </main>
    </div>
  );
}
