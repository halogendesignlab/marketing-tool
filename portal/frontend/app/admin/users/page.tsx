"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getUsers, updateUser, inviteUser, getClients } from "@/lib/api";

interface UserRecord {
  id: number;
  email: string;
  name: string;
  role: "admin" | "client";
  client_id: number | null;
  client_name: string | null;
  client_ids: number[];
  client_names: string[];
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

interface Client {
  id: number;
  brand_name: string;
}

interface EditState {
  name: string;
  email: string;
  role: "admin" | "client";
  password: string;
  is_active: boolean;
  client_ids: number[];
}

interface InviteState {
  name: string;
  email: string;
  role: "admin" | "client";
  password: string;
  client_id: number | "";
}

export default function AdminUsersPage() {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [fetching, setFetching] = useState(true);

  // Edit modal
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [inviteState, setInviteState] = useState<InviteState>({
    name: "",
    email: "",
    role: "client",
    password: "",
    client_id: "",
  });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.replace("/dashboard");
  }, [user, loading, isAdmin, router]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    Promise.all([getUsers(), getClients()])
      .then(([u, c]) => {
        setUsers(u);
        setClients(c);
      })
      .finally(() => setFetching(false));
  }, [user, isAdmin]);

  function openEdit(u: UserRecord) {
    setEditTarget(u);
    setEditState({
      name: u.name,
      email: u.email,
      role: u.role,
      password: "",
      is_active: u.is_active,
      client_ids: u.client_ids ?? [],
    });
    setEditError("");
  }

  function toggleClientInEdit(clientId: number) {
    if (!editState) return;
    const already = editState.client_ids.includes(clientId);
    setEditState({
      ...editState,
      client_ids: already
        ? editState.client_ids.filter((id) => id !== clientId)
        : [...editState.client_ids, clientId],
    });
  }

  async function saveEdit() {
    if (!editTarget || !editState) return;
    setEditSaving(true);
    setEditError("");
    try {
      const payload: Record<string, unknown> = {
        name: editState.name,
        email: editState.email,
        role: editState.role,
        is_active: editState.is_active,
        client_ids: editState.role === "admin" ? [] : editState.client_ids,
      };
      if (editState.password) payload.password = editState.password;
      const updated = await updateUser(editTarget.id, payload);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditTarget(null);
      setEditState(null);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to save";
      setEditError(msg);
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(u: UserRecord) {
    try {
      const updated = await updateUser(u.id, { is_active: !u.is_active });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      // silent
    }
  }

  async function saveInvite() {
    setInviteSaving(true);
    setInviteError("");
    try {
      if (inviteState.role === "client" && !inviteState.client_id) {
        setInviteError("Client users must be assigned to a client");
        setInviteSaving(false);
        return;
      }
      const clientId = inviteState.client_id as number;
      const created = await inviteUser(clientId, {
        name: inviteState.name,
        email: inviteState.email,
        role: inviteState.role,
        password: inviteState.password,
      });
      const clientName = clients.find((c) => c.id === clientId)?.brand_name ?? null;
      setUsers((prev) => [
        ...prev,
        {
          ...created,
          client_name: clientName,
          client_ids: clientId ? [clientId] : [],
          client_names: clientName ? [clientName] : [],
          is_active: true,
          last_login: null,
        },
      ]);
      setShowInvite(false);
      setInviteState({ name: "", email: "", role: "client", password: "", client_id: "" });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to create user";
      setInviteError(msg);
    } finally {
      setInviteSaving(false);
    }
  }

  if (loading || !user || !isAdmin) return null;

  const activeUsers = users.filter((u) => u.is_active);
  const inactiveUsers = users.filter((u) => !u.is_active);

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Users</h1>
          <button
            onClick={() => { setShowInvite(true); setInviteError(""); }}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
          >
            Add user
          </button>
        </div>

        {fetching && <p className="text-sm text-gray-400">Loading…</p>}

        {!fetching && (
          <div className="space-y-6">
            <UserTable users={activeUsers} onEdit={openEdit} onToggle={toggleActive} />
            {inactiveUsers.length > 0 && (
              <div>
                <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                  Deactivated ({inactiveUsers.length})
                </h2>
                <UserTable users={inactiveUsers} onEdit={openEdit} onToggle={toggleActive} dimmed />
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Edit modal ─────────────────────────────────────────────────── */}
      {editTarget && editState && (
        <Modal title={`Edit ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          <div className="space-y-4">
            <Field label="Name">
              <input
                className="input"
                value={editState.name}
                onChange={(e) => setEditState({ ...editState, name: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={editState.email}
                onChange={(e) => setEditState({ ...editState, email: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={editState.role}
                onChange={(e) =>
                  setEditState({ ...editState, role: e.target.value as "admin" | "client" })
                }
              >
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </Field>

            {/* Client assignment — only shown for client-role users */}
            {editState.role === "client" && clients.length > 0 && (
              <Field label="Assigned clients">
                <div className="flex flex-wrap gap-2 mt-1">
                  {clients.map((c) => {
                    const selected = editState.client_ids.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleClientInEdit(c.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selected
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {c.brand_name}
                      </button>
                    );
                  })}
                </div>
                {editState.client_ids.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No clients assigned — user won&apos;t see any data.</p>
                )}
              </Field>
            )}

            <Field label="New password" hint="leave blank to keep unchanged">
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={editState.password}
                onChange={(e) => setEditState({ ...editState, password: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editState.is_active}
                onChange={(e) => setEditState({ ...editState, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-gray-900"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Invite modal ───────────────────────────────────────────────── */}
      {showInvite && (
        <Modal title="Add user" onClose={() => setShowInvite(false)}>
          <div className="space-y-4">
            <Field label="Name">
              <input
                className="input"
                value={inviteState.name}
                onChange={(e) => setInviteState({ ...inviteState, name: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={inviteState.email}
                onChange={(e) => setInviteState({ ...inviteState, email: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={inviteState.role}
                onChange={(e) =>
                  setInviteState({ ...inviteState, role: e.target.value as "admin" | "client" })
                }
              >
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            {inviteState.role === "client" && (
              <Field label="Client">
                <select
                  className="input"
                  value={inviteState.client_id}
                  onChange={(e) =>
                    setInviteState({ ...inviteState, client_id: e.target.value ? Number(e.target.value) : "" })
                  }
                >
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.brand_name}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Password">
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={inviteState.password}
                onChange={(e) => setInviteState({ ...inviteState, password: e.target.value })}
              />
            </Field>
            {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveInvite}
                disabled={inviteSaving}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {inviteSaving ? "Creating…" : "Create user"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UserTable({
  users,
  onEdit,
  onToggle,
  dimmed = false,
}: {
  users: UserRecord[];
  onEdit: (u: UserRecord) => void;
  onToggle: (u: UserRecord) => void;
  dimmed?: boolean;
}) {
  if (users.length === 0) return null;

  return (
    <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${dimmed ? "opacity-60" : ""}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
            <th className="text-left px-5 py-3 font-medium">Name</th>
            <th className="text-left px-5 py-3 font-medium">Email</th>
            <th className="text-left px-5 py-3 font-medium">Role</th>
            <th className="text-left px-5 py-3 font-medium">Clients</th>
            <th className="text-left px-5 py-3 font-medium">Last login</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr
              key={u.id}
              className={`${i > 0 ? "border-t border-gray-50" : ""} hover:bg-gray-50/60 transition-colors`}
            >
              <td className="px-5 py-3 font-medium text-gray-900">{u.name}</td>
              <td className="px-5 py-3 text-gray-500">{u.email}</td>
              <td className="px-5 py-3">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.role === "admin"
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {u.role}
                </span>
              </td>
              <td className="px-5 py-3 text-gray-500">
                {u.role === "admin" ? (
                  <span className="text-gray-300 text-xs">All</span>
                ) : u.client_names && u.client_names.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {u.client_names.map((name, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-5 py-3 text-gray-400 text-xs">
                {u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}
              </td>
              <td className="px-5 py-3">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onEdit(u)}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onToggle(u)}
                    className={`text-xs transition-colors ${
                      u.is_active
                        ? "text-gray-300 hover:text-red-500"
                        : "text-green-500 hover:text-green-700"
                    }`}
                  >
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {hint && <span className="ml-1 font-normal text-gray-400">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
