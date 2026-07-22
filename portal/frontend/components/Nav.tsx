"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";

const adminNavItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/approvals", label: "Drafts" },
  { href: "/media", label: "Media" },
  { href: "/reports", label: "Reports" },
];

const clientNavItems = [
  { href: "/approvals", label: "Approvals" },
  { href: "/reports", label: "Reports" },
];

const adminItems = [
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/users", label: "Users" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isAdmin } = useAuth();
  const { selectedClient, clients, clearClient } = useClient();

  function handleSwitchClient() {
    clearClient();
    router.push("/select-client");
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900 text-sm">Halogen</span>

        {/* Client context indicator */}
        {selectedClient && (
          <>
            <span className="text-gray-300 text-sm">/</span>
            {isAdmin || clients.length > 1 ? (
              <button
                onClick={handleSwitchClient}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors flex items-center gap-1 group"
                title="Switch client"
              >
                {selectedClient.name}
                <svg
                  className="w-3 h-3 text-gray-400 group-hover:text-gray-600 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              </button>
            ) : (
              <span className="text-sm text-gray-600 font-medium">{selectedClient.name}</span>
            )}
            <span className="w-px h-4 bg-gray-200 mx-2" />
          </>
        )}

        {/* Nav links */}
        <div className="flex gap-1">
          {(isAdmin ? adminNavItems : clientNavItems).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                pathname.startsWith(item.href)
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {isAdmin && (
            <>
              <span className="w-px bg-gray-200 mx-1" />
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    pathname.startsWith(item.href)
                      ? "bg-gray-100 text-gray-900 font-medium"
                      : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isAdmin && (
          <span className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded-full">Admin</span>
        )}
        <Link
          href="/profile"
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          title="Account settings"
        >
          {user?.name || user?.email}
        </Link>
        <button
          onClick={logout}
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
