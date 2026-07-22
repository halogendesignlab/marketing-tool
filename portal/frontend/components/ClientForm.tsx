"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { createClient, updateClient, inviteUser, removeUser, getKeywordFileInfo, uploadKeywordFile, getClients } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientDetail {
  id: number;
  client_id: string;
  brand_name: string;
  industry: string;
  tone: string;
  location_city: string;
  location_state: string;
  location_lat: number;
  location_lng: number;
  is_active: boolean;
  publer_workspace_id: string;
  publer_instagram_id: string;
  publer_facebook_id: string;
  publer_linkedin_id: string;
  publer_gbp_id: string;
  gbp_location_id: string;
  gbp_account_id: string;
  gbp_credentials_file: string;
  local_falcon_api_key: string;
  local_falcon_place_id: string;
  social_posts_per_month: number;
  blog_posts_per_month: number;
  gbp_posts_per_month: number;
  gbp_image_uploads_per_week: number;
  report_day_of_month: number;
  serp_check_day_of_month: number;
  review_check_interval_hours: number;
  directory_check_day_of_month: number;
  directories_to_monitor: string[];
  drive_folder_id: string;
  client_email: string;
  admin_email: string;
  media_source_client_id?: number | null;
  users: { id: number; email: string; name: string; role: string }[];
}

const ALL_DIRECTORIES = ["google", "yelp", "bbb", "yellowpages", "bing", "foursquare", "tripadvisor"];

const DEFAULT_FORM = {
  client_id: "",
  brand_name: "",
  industry: "",
  tone: "",
  location_city: "",
  location_state: "",
  location_lat: "",
  location_lng: "",
  publer_workspace_id: "",
  publer_instagram_id: "",
  publer_facebook_id: "",
  publer_linkedin_id: "",
  publer_gbp_id: "",
  gbp_location_id: "",
  gbp_account_id: "",
  gbp_credentials_file: "",
  local_falcon_api_key: "",
  local_falcon_place_id: "",
  social_posts_per_month: "12",
  blog_posts_per_month: "1",
  gbp_posts_per_month: "4",
  gbp_image_uploads_per_week: "1",
  report_day_of_month: "1",
  serp_check_day_of_month: "1",
  review_check_interval_hours: "24",
  directory_check_day_of_month: "15",
  directories_to_monitor: ["google", "yelp", "bbb", "yellowpages", "bing"] as string[],
  drive_folder_id: "",
  client_email: "",
  admin_email: "",
  is_active: true,
  media_source_client_id: "" as string,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-ink-700 rounded-xl border border-ink-600 p-6">
      <h2 className="font-sans text-xs font-semibold text-fg-3 uppercase tracking-widest mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block font-sans text-sm font-medium text-fg-2 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-fg-3 font-sans mt-1">{hint}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClientForm({ initial }: { initial?: ClientDetail }) {
  const router = useRouter();
  const isEdit = !!initial;

  const [form, setForm] = useState(() => {
    if (!initial) return DEFAULT_FORM;
    return {
      client_id: initial.client_id,
      brand_name: initial.brand_name,
      industry: initial.industry,
      tone: initial.tone,
      location_city: initial.location_city,
      location_state: initial.location_state,
      location_lat: String(initial.location_lat),
      location_lng: String(initial.location_lng),
      publer_workspace_id: initial.publer_workspace_id,
      publer_instagram_id: initial.publer_instagram_id,
      publer_facebook_id: initial.publer_facebook_id,
      publer_linkedin_id: initial.publer_linkedin_id,
      publer_gbp_id: initial.publer_gbp_id,
      gbp_location_id: initial.gbp_location_id,
      gbp_account_id: initial.gbp_account_id,
      gbp_credentials_file: initial.gbp_credentials_file,
      local_falcon_api_key: initial.local_falcon_api_key ?? "",
      local_falcon_place_id: initial.local_falcon_place_id ?? "",
      social_posts_per_month: String(initial.social_posts_per_month),
      blog_posts_per_month: String(initial.blog_posts_per_month),
      gbp_posts_per_month: String(initial.gbp_posts_per_month),
      gbp_image_uploads_per_week: String(initial.gbp_image_uploads_per_week),
      report_day_of_month: String(initial.report_day_of_month),
      serp_check_day_of_month: String(initial.serp_check_day_of_month),
      review_check_interval_hours: String(initial.review_check_interval_hours),
      directory_check_day_of_month: String(initial.directory_check_day_of_month),
      directories_to_monitor: initial.directories_to_monitor,
      drive_folder_id: initial.drive_folder_id,
      client_email: initial.client_email,
      admin_email: initial.admin_email,
      is_active: initial.is_active,
      media_source_client_id: initial.media_source_client_id != null ? String(initial.media_source_client_id) : "",
    };
  });

  const [users, setUsers] = useState(initial?.users ?? []);
  const [saving, setSaving] = useState(false);
  const [allClients, setAllClients] = useState<{ id: number; brand_name: string }[]>([]);

  useEffect(() => {
    getClients().then((list: { id: number; brand_name: string }[]) => setAllClients(list)).catch(() => {});
  }, []);

  // Keyword file state (edit mode only)
  const [kwInfo, setKwInfo] = useState<{ exists: boolean; row_count?: number; preview?: string[]; updated_at?: string } | null>(null);
  const [kwUploading, setKwUploading] = useState(false);
  const kwInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEdit || !initial) return;
    getKeywordFileInfo(initial.id).then(setKwInfo).catch(() => {});
  }, [isEdit, initial]);

  // Invite user state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("client");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviting, setInviting] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const toggleDir = (dir: string) => {
    setForm((f) => ({
      ...f,
      directories_to_monitor: f.directories_to_monitor.includes(dir)
        ? f.directories_to_monitor.filter((d) => d !== dir)
        : [...f.directories_to_monitor, dir],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        brand_name: form.brand_name,
        industry: form.industry,
        tone: form.tone,
        location_city: form.location_city,
        location_state: form.location_state,
        location_lat: parseFloat(form.location_lat) || 0,
        location_lng: parseFloat(form.location_lng) || 0,
        publer_workspace_id: form.publer_workspace_id,
        publer_instagram_id: form.publer_instagram_id,
        publer_facebook_id: form.publer_facebook_id,
        publer_linkedin_id: form.publer_linkedin_id,
        publer_gbp_id: form.publer_gbp_id,
        gbp_location_id: form.gbp_location_id,
        gbp_account_id: form.gbp_account_id,
        gbp_credentials_file: form.gbp_credentials_file,
        local_falcon_api_key: form.local_falcon_api_key.trim() || undefined,
        local_falcon_place_id: form.local_falcon_place_id.trim() || undefined,
        social_posts_per_month: parseInt(form.social_posts_per_month) || 12,
        blog_posts_per_month: parseInt(form.blog_posts_per_month) || 1,
        gbp_posts_per_month: parseInt(form.gbp_posts_per_month) || 4,
        gbp_image_uploads_per_week: parseInt(form.gbp_image_uploads_per_week) || 1,
        report_day_of_month: parseInt(form.report_day_of_month) || 1,
        serp_check_day_of_month: parseInt(form.serp_check_day_of_month) || 1,
        review_check_interval_hours: parseInt(form.review_check_interval_hours) || 24,
        directory_check_day_of_month: parseInt(form.directory_check_day_of_month) || 15,
        directories_to_monitor: form.directories_to_monitor,
        drive_folder_id: form.drive_folder_id,
        client_email: form.client_email,
        admin_email: form.admin_email,
        media_source_client_id: form.media_source_client_id ? parseInt(form.media_source_client_id) : null,
        ...(isEdit ? { is_active: form.is_active } : {}),
      };

      if (isEdit) {
        await updateClient(initial!.id, payload);
        toast.success("Client saved");
      } else {
        const created = await createClient(payload);
        toast.success("Client created");
        router.push(`/admin/clients/${created.id}`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to save client");
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteName || !invitePassword) {
      toast.error("Fill in all invite fields");
      return;
    }
    setInviting(true);
    try {
      const user = await inviteUser(initial!.id, {
        email: inviteEmail,
        name: inviteName,
        role: inviteRole,
        password: invitePassword,
      });
      setUsers((u) => [...u, user]);
      setInviteEmail("");
      setInviteName("");
      setInvitePassword("");
      setInviteRole("client");
      toast.success("User added");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to add user");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveUser = async (userId: number) => {
    try {
      await removeUser(initial!.id, userId);
      setUsers((u) => u.filter((x) => x.id !== userId));
      toast.success("User removed");
    } catch {
      toast.error("Failed to remove user");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Basic Info */}
      <Section title="Basic info">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand name">
            <input className="input" value={form.brand_name} onChange={set("brand_name")} required />
          </Field>
          <Field label="Client ID" hint="Lowercase slug, e.g. acme_plumbing. Cannot be changed after creation.">
            <input
              className="input"
              value={form.client_id}
              onChange={set("client_id")}
              disabled={isEdit}
              required
              pattern="[a-z0-9_\-]+"
              title="Lowercase letters, numbers, underscores, hyphens only"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Industry">
            <input className="input" value={form.industry} onChange={set("industry")} required />
          </Field>
          <Field label="Tone" hint="Describe the brand voice, e.g. 'professional and friendly'">
            <input className="input" value={form.tone} onChange={set("tone")} required />
          </Field>
        </div>
        {isEdit && (
          <Field label="Status">
            <select className="input" value={form.is_active ? "active" : "inactive"} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === "active" }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        )}
      </Section>

      {/* Location */}
      <Section title="Location">
        <div className="grid grid-cols-2 gap-4">
          <Field label="City">
            <input className="input" value={form.location_city} onChange={set("location_city")} required />
          </Field>
          <Field label="State">
            <input className="input" value={form.location_state} onChange={set("location_state")} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude" hint="Used for geo-grid SERP tracking">
            <input className="input" type="number" step="any" value={form.location_lat} onChange={set("location_lat")} required />
          </Field>
          <Field label="Longitude">
            <input className="input" type="number" step="any" value={form.location_lng} onChange={set("location_lng")} required />
          </Field>
        </div>
      </Section>

      {/* Publer */}
      <Section title="Publer">
        <Field label="Workspace ID">
          <input className="input" value={form.publer_workspace_id} onChange={set("publer_workspace_id")} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Instagram profile ID">
            <input className="input" value={form.publer_instagram_id} onChange={set("publer_instagram_id")} />
          </Field>
          <Field label="Facebook profile ID">
            <input className="input" value={form.publer_facebook_id} onChange={set("publer_facebook_id")} />
          </Field>
          <Field label="LinkedIn profile ID">
            <input className="input" value={form.publer_linkedin_id} onChange={set("publer_linkedin_id")} />
          </Field>
          <Field label="GBP profile ID">
            <input className="input" value={form.publer_gbp_id} onChange={set("publer_gbp_id")} />
          </Field>
        </div>
      </Section>

      {/* Google Business Profile */}
      <Section title="Google Business Profile">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location ID">
            <input className="input" value={form.gbp_location_id} onChange={set("gbp_location_id")} />
          </Field>
          <Field label="Account ID">
            <input className="input" value={form.gbp_account_id} onChange={set("gbp_account_id")} />
          </Field>
        </div>
        <Field label="Credentials file path" hint="Absolute path to the Google service account JSON file on the server">
          <input className="input" value={form.gbp_credentials_file} onChange={set("gbp_credentials_file")} />
        </Field>
      </Section>

      {/* Keywords */}
      <Section title="Keywords">
        {isEdit && (
          <div>
            <p className="text-sm font-sans font-medium text-fg-2 mb-1">Keyword research file</p>
            <p className="text-xs text-fg-3 font-sans mb-3">
              Upload a CSV with a <code className="bg-ink-500 text-fg-2 px-1 rounded font-mono">keyword</code> column. Used as a source for blog and content topics.
            </p>

            {kwInfo?.exists ? (
              <div className="flex items-start justify-between bg-ink-500 border border-ink-600 rounded-md p-3 mb-3">
                <div>
                  <p className="text-sm font-sans font-medium text-fg-1">
                    {kwInfo.row_count} keywords
                    <span className="text-xs text-fg-3 font-normal ml-2">
                      Updated {kwInfo.updated_at ? new Date(kwInfo.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </span>
                  </p>
                  {kwInfo.preview && kwInfo.preview.length > 0 && (
                    <p className="text-xs text-fg-3 font-mono mt-1 leading-relaxed">
                      {kwInfo.preview.join(", ")}{(kwInfo.row_count ?? 0) > kwInfo.preview.length ? `, +${(kwInfo.row_count ?? 0) - kwInfo.preview.length} more` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => kwInputRef.current?.click()}
                  disabled={kwUploading}
                  className="ml-4 text-xs text-fg-3 hover:text-fg-1 font-sans underline underline-offset-2 whitespace-nowrap disabled:opacity-50 transition-colors duration-150"
                >
                  {kwUploading ? "Uploading…" : "Replace file"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => kwInputRef.current?.click()}
                disabled={kwUploading}
                className="flex items-center gap-2 px-4 py-2 border border-dashed border-ink-600 rounded-md font-sans text-sm text-fg-3 hover:border-tint hover:text-fg-2 transition-colors duration-150 disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {kwUploading ? "Uploading…" : "Upload keyword CSV"}
              </button>
            )}

            <input
              ref={kwInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !initial) return;
                setKwUploading(true);
                try {
                  const result = await uploadKeywordFile(initial.id, file);
                  setKwInfo({ exists: true, row_count: result.row_count, preview: result.preview, updated_at: new Date().toISOString() });
                  toast.success(`Uploaded ${result.row_count} keywords`);
                } catch (err: unknown) {
                  const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                  toast.error(msg || "Upload failed");
                } finally {
                  setKwUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </div>
        )}
      </Section>

      {/* Local Falcon */}
      <Section title="Local Falcon (SERP grids)">
        <Field
          label="API key"
          hint="Found in your Local Falcon account under Settings → API."
        >
          <input
            className="input"
            value={form.local_falcon_api_key}
            onChange={set("local_falcon_api_key")}
            placeholder="lf_xxxxxxxxxxxx"
          />
        </Field>
        <Field
          label="Google Place ID"
          hint="The Place ID of this business in Local Falcon (e.g. ChIJxxxxxxx). Find it in Local Falcon → your location → Settings."
        >
          <input
            className="input"
            value={form.local_falcon_place_id}
            onChange={set("local_falcon_place_id")}
            placeholder="ChIJ…"
          />
        </Field>
      </Section>

      {/* Schedule */}
      <Section title="Schedule">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Social posts / month">
            <input className="input" type="number" min="0" value={form.social_posts_per_month} onChange={set("social_posts_per_month")} />
          </Field>
          <Field label="Blog posts / month">
            <input className="input" type="number" min="0" value={form.blog_posts_per_month} onChange={set("blog_posts_per_month")} />
          </Field>
          <Field label="GBP posts / month">
            <input className="input" type="number" min="0" value={form.gbp_posts_per_month} onChange={set("gbp_posts_per_month")} />
          </Field>
          <Field label="GBP image uploads / week">
            <input className="input" type="number" min="0" value={form.gbp_image_uploads_per_week} onChange={set("gbp_image_uploads_per_week")} />
          </Field>
          <Field label="Report day of month">
            <input className="input" type="number" min="1" max="28" value={form.report_day_of_month} onChange={set("report_day_of_month")} />
          </Field>
          <Field label="SERP check day of month">
            <input className="input" type="number" min="1" max="28" value={form.serp_check_day_of_month} onChange={set("serp_check_day_of_month")} />
          </Field>
          <Field label="Review check interval (hrs)">
            <input className="input" type="number" min="1" value={form.review_check_interval_hours} onChange={set("review_check_interval_hours")} />
          </Field>
          <Field label="Directory check day of month">
            <input className="input" type="number" min="1" max="28" value={form.directory_check_day_of_month} onChange={set("directory_check_day_of_month")} />
          </Field>
        </div>
      </Section>

      {/* Directories */}
      <Section title="Directories to monitor">
        <div className="flex flex-wrap gap-3">
          {ALL_DIRECTORIES.map((dir) => (
            <label key={dir} className="flex items-center gap-2 text-sm font-sans text-fg-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.directories_to_monitor.includes(dir)}
                onChange={() => toggleDir(dir)}
                className="rounded border-ink-600 bg-ink-700 text-tint focus:ring-tint focus:ring-offset-ink-700"
              />
              <span className="capitalize">{dir}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* Google Drive */}
      <Section title="Google Drive (media sync)">
        <Field
          label="Drive folder ID"
          hint="ID from the folder URL: drive.google.com/drive/folders/THIS_ID. Leave blank to skip Drive sync."
        >
          <input
            className="input"
            value={form.drive_folder_id}
            onChange={set("drive_folder_id")}
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
          />
        </Field>
        <Field
          label="Shared media library"
          hint="When set, this client's media library shows photos from the selected account instead of its own."
        >
          <select
            className="input"
            value={form.media_source_client_id}
            onChange={set("media_source_client_id")}
          >
            <option value="">— Own library —</option>
            {allClients
              .filter((c) => !initial || c.id !== initial.id)
              .map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.brand_name}
                </option>
              ))}
          </select>
        </Field>
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Client email" hint="Receives content-ready and report notifications">
            <input className="input" type="email" value={form.client_email} onChange={set("client_email")} />
          </Field>
          <Field label="Admin email" hint="Receives publish failures and internal alerts">
            <input className="input" type="email" value={form.admin_email} onChange={set("admin_email")} />
          </Field>
        </div>
      </Section>

      {/* Portal Users — only on edit */}
      {isEdit && (
        <Section title="Portal users">
          {users.length > 0 && (
            <div className="divide-y divide-ink-600 mb-4">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-sans text-fg-1">{u.name}</p>
                    <p className="text-xs text-fg-3 font-sans">{u.email} · {u.role}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveUser(u.id)}
                    className="text-xs text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-ink-600 pt-4">
            <p className="text-xs font-sans font-medium text-fg-3 mb-3">Add user</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input className="input" placeholder="Name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              <input className="input" placeholder="Email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <input className="input" placeholder="Temporary password" type="password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
              <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleInvite}
              disabled={inviting}
              className="btn-primary disabled:opacity-50"
            >
              {inviting ? "Adding…" : "Add user"}
            </button>
          </div>
        </Section>
      )}

      {/* Submit */}
      <div className="flex items-center justify-between pb-8">
        <button
          type="button"
          onClick={() => router.push("/admin/clients")}
          className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150"
        >
          ← Back to clients
        </button>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create client"}
        </button>
      </div>
    </form>
  );
}
