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
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">New Client</h1>
        <ClientForm />
      </main>
    </div>
  );
}
