"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";

const adminNavItems = [
  { href: "/dashboard", label: "dashboard" },
  { href: "/approvals", label: "drafts" },
  { href: "/media", label: "media" },
  { href: "/reports", label: "reports" },
];

const clientNavItems = [
  { href: "/approvals", label: "approvals" },
  { href: "/reports", label: "reports" },
];

const adminItems = [
  { href: "/admin/clients", label: "clients" },
  { href: "/admin/users", label: "users" },
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
    <nav className="bg-ink-800 border-b border-ink-600 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="font-sans font-bold text-fg-1 text-sm tracking-widest">HALOGEN</span>

        {/* Client context indicator */}
        {selectedClient && (
          <>
            <span className="text-fg-3 text-sm">/</span>
            {isAdmin || clients.length > 1 ? (
              <button
                onClick={handleSwitchClient}
                className="text-sm text-fg-2 hover:text-fg-1 font-sans font-medium transition-colors duration-150 flex items-center gap-1 group"
                title="Switch client"
              >
                {selectedClient.name}
                <svg
                  className="w-3 h-3 text-fg-3 group-hover:text-fg-2 transition-colors duration-150"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              </button>
            ) : (
              <span className="text-sm text-fg-2 font-sans font-medium">{selectedClient.name}</span>
            )}
            <span className="w-px h-4 bg-ink-600 mx-2" />
          </>
        )}

        {/* Nav links */}
        <div className="flex gap-1">
          {(isAdmin ? adminNavItems : clientNavItems).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded-md font-sans text-sm transition-colors duration-150 ${
                pathname.startsWith(item.href)
                  ? "bg-ink-600 text-fg-1"
                  : "text-fg-2 hover:text-fg-1"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {isAdmin && (
            <>
              <span className="w-px bg-ink-600 mx-1" />
              {adminItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md font-sans text-sm transition-colors duration-150 ${
                    pathname.startsWith(item.href)
                      ? "bg-ink-600 text-fg-1"
                      : "text-fg-2 hover:text-fg-1"
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
          <span className="text-xs bg-tint text-ink-900 px-2 py-0.5 rounded font-sans font-semibold">Admin</span>
        )}
        <Link
          href="/profile"
          className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150"
          title="Account settings"
        >
          {user?.name || user?.email}
        </Link>
        <button
          onClick={logout}
          className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150"
        >
          sign out
        </button>
      </div>
    </nav>
  );
}
