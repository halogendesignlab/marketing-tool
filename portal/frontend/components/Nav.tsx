"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";

const adminNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: "M4 5h6v6H4zM14 5h6v4h-6zM14 13h6v6h-6zM4 15h6v4H4z" },
  { href: "/approvals", label: "Drafts", icon: "M5 4h9l5 5v11H5zM14 4v5h5" },
  { href: "/media", label: "Media", icon: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5h.01" },
  { href: "/files", label: "Files", icon: "M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" },
  { href: "/reports", label: "Reports", icon: "M5 20V10M12 20V4M19 20v-7" },
];

const clientNavItems = [
  { href: "/approvals", label: "Your content", icon: "M5 4h9l5 5v11H5zM14 4v5h5" },
  { href: "/files", label: "Files", icon: "M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" },
  { href: "/reports", label: "Reports", icon: "M5 20V10M12 20V4M19 20v-7" },
];

const adminItems = [
  { href: "/admin/clients", label: "Clients", icon: "M4 20v-1a4 4 0 014-4h2a4 4 0 014 4v1M9 7a3 3 0 106 0 3 3 0 10-6 0M17 20v-1a4 4 0 00-3-3.9" },
  { href: "/admin/users", label: "Users", icon: "M4 20v-2a4 4 0 014-4h4a4 4 0 014 4v2M10 6a3 3 0 106 0 3 3 0 10-6 0" },
];

function NavLink({ href, label, icon, active, onNavigate }: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium text-sm transition-colors duration-150 ${
        active
          ? "bg-ink-500 text-fg-1 ring-1 ring-ink-600"
          : "text-fg-2 hover:text-fg-1 hover:bg-ink-500"
      }`}
    >
      <svg className={`w-4 h-4 shrink-0 ${active ? "text-tint" : "text-fg-3"}`} fill="none"
        viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}
        strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
      {label}
    </Link>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isAdmin } = useAuth();
  const { selectedClient, clients, clearClient } = useClient();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation so it never covers the new page.
  useEffect(() => { setOpen(false); }, [pathname]);

  function handleSwitchClient() {
    clearClient();
    router.push("/select-client");
  }

  const items = isAdmin ? adminNavItems : clientNavItems;
  const close = () => setOpen(false);

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4">
        <Link href="/" className="font-display font-bold text-fg-1 text-sm tracking-[0.18em]">
          HALOGEN
        </Link>
        {selectedClient && (
          <div className="mt-3">
            {isAdmin || clients.length > 1 ? (
              <button
                onClick={handleSwitchClient}
                title="Switch client"
                className="group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-ink-600 bg-white text-left hover:border-tint transition-colors duration-150"
              >
                <span className="w-6 h-6 shrink-0 rounded-md bg-tint text-white text-xs font-semibold flex items-center justify-center">
                  {selectedClient.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 text-sm font-medium text-fg-1 truncate">
                  {selectedClient.name}
                </span>
                <svg className="w-3 h-3 shrink-0 text-fg-3 group-hover:text-fg-2 transition-colors duration-150"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              </button>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-ink-600 bg-white">
                <span className="w-6 h-6 shrink-0 rounded-md bg-tint text-white text-xs font-semibold flex items-center justify-center">
                  {selectedClient.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 text-sm font-medium text-fg-1 truncate">
                  {selectedClient.name}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 space-y-0.5">
        {items.map((item) => (
          <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} onNavigate={close} />
        ))}
        {isAdmin && (
          <>
            <p className="px-3 pt-5 pb-1.5 text-[11px] font-semibold text-fg-3 uppercase tracking-wider">
              Admin
            </p>
            {adminItems.map((item) => (
              <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} onNavigate={close} />
            ))}
          </>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-ink-600">
        <Link
          href="/profile"
          onClick={close}
          title="Account settings"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-ink-500 transition-colors duration-150"
        >
          <span className="w-7 h-7 shrink-0 rounded-full bg-ink-500 ring-1 ring-ink-600 text-fg-2 text-xs font-semibold flex items-center justify-center">
            {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-fg-1 truncate">{user?.name || user?.email}</span>
            {isAdmin && <span className="block text-[11px] text-tint font-medium">Admin</span>}
          </span>
        </Link>
        <button
          onClick={logout}
          className="w-full text-left px-3 py-1.5 mt-0.5 rounded-lg text-sm text-fg-3 hover:text-fg-1 hover:bg-ink-500 transition-colors duration-150"
        >
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail — id is the hook globals.css uses to inset page content. */}
      <aside
        id="app-sidebar"
        className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col bg-white border-r border-ink-600"
      >
        {sidebar}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-white/90 backdrop-blur-md border-b border-ink-600">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-fg-2 hover:text-fg-1 p-1 -ml-1">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="font-display font-bold text-fg-1 text-sm tracking-[0.18em]">HALOGEN</span>
        {selectedClient && (
          <span className="text-sm text-fg-3 truncate">/ {selectedClient.name}</span>
        )}
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-fg-1/25 backdrop-blur-sm" onClick={close} />
          <div className="absolute inset-y-0 left-0 w-64 bg-white border-r border-ink-600 shadow-pop">
            {sidebar}
          </div>
        </div>
      )}
    </>
  );
}
