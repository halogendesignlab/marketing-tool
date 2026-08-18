"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { generateDraft, getMediaItems, getMediaItemCount } from "@/lib/api";
import toast from "react-hot-toast";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ContentItem {
  id: number;
  content_type: string;
  platform: string | null;
  status: string;
  title: string | null;
  body: string;
  image_url: string | null;
  scheduled_for: string | null;
  published_at?: string | null;
  auto_publish_at?: string | null;
  created_at: string;
  meta?: { platforms?: string[]; captions?: Record<string, string>; blog_images?: string[] } | null;
  rejection_reason?: string | null;
}

export interface MediaItem {
  id: number;
  filename: string;
  url: string;
  meta?: { project?: string; category?: string } | null;
}

export const TYPE_LABELS: Record<string, string> = {
  social_caption: "Social",
  blog_post: "Blog",
  gbp_post: "GBP",
};

export const imgSrc = (url: string) => (url.startsWith("http") ? url : `${API_BASE}${url}`);

export const platformsOf = (item: ContentItem): string[] =>
  item.meta?.platforms ?? (item.platform ? [item.platform] : []);

/** Strips HTML so blog bodies can be shown as plain-text excerpts. */
export function excerpt(html: string, max = 180): string {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Media browser ─────────────────────────────────────────────────────────────

const MEDIA_PAGE = 48;

/** Paginated, searchable grid over a client's entire media library.
 *
 * Shared by the generate wizard and the image picker. They used to each roll
 * their own grid, which is how the wizard ended up capped at a single page
 * while the picker paginated — one component means they cannot drift again.
 */
export function MediaBrowser({ clientId, isSelected, onPick, maxHeight = "max-h-[46vh]" }: {
  clientId: number | null;
  isSelected: (m: MediaItem) => boolean;
  onPick: (m: MediaItem) => void;
  maxHeight?: string;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(() => (query ? { search: query } : {}), [query]);

  const load = useCallback(
    (off: number) => {
      setLoading(true);
      getMediaItems(undefined, clientId ?? undefined, MEDIA_PAGE, off, filters)
        .then((results: MediaItem[]) =>
          setItems((prev) => (off === 0 ? results : [...prev, ...results])),
        )
        .finally(() => setLoading(false));
    },
    [clientId, filters],
  );

  useEffect(() => {
    setItems([]);
    load(0);
    getMediaItemCount(undefined, clientId ?? undefined, filters)
      .then(setTotal)
      .catch(() => setTotal(null));
  }, [load, clientId, filters]);

  const hasMore = total !== null && items.length < total;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-3 mb-2 shrink-0">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by project, category, or filename…"
          className="input py-1.5 text-sm flex-1"
        />
        {total !== null && (
          <span className="text-xs text-fg-3 shrink-0 tabular-nums">
            {items.length} of {total}
          </span>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto pr-1 ${maxHeight}`}>
        {loading && items.length === 0 && (
          <p className="text-sm text-fg-3 text-center py-8">Loading photos…</p>
        )}
        {!loading && items.length === 0 && (
          <p className="text-sm text-fg-3 text-center py-8">
            {query ? `No photos match “${query}”.` : "No photos in media library yet."}
          </p>
        )}
        <div className="grid grid-cols-4 gap-2">
          {items.map((m) => {
            const selected = isSelected(m);
            return (
              <button
                key={m.id}
                onClick={() => onPick(m)}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                  selected ? "border-tint ring-2 ring-tint/25" : "border-ink-600 hover:border-tint"
                }`}
                title={m.meta?.project || m.filename}
              >
                <img src={imgSrc(m.url)} alt={m.filename} className="w-full h-full object-cover" loading="lazy" />
                {selected && (
                  <div className="absolute inset-0 bg-tint/20 flex items-center justify-center">
                    <span className="bg-tint rounded-full w-6 h-6 flex items-center justify-center text-white text-xs font-bold shadow">✓</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {hasMore && (
          <div className="flex justify-center mt-3">
            <button onClick={() => load(items.length)} disabled={loading} className="btn-ghost disabled:opacity-50">
              {loading ? "Loading…" : `Load ${Math.min(MEDIA_PAGE, total - items.length)} more`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Generate wizard (admin only) ──────────────────────────────────────────────

const POST_TYPES = [
  { key: "social_caption", label: "Social Caption", desc: "Generate captions for Instagram, Facebook, LinkedIn, or GBP from a photo" },
  { key: "blog_post", label: "Blog Post", desc: "AI-written 400–600 word blog draft for your website" },
  { key: "gbp_post", label: "GBP Post", desc: "150–300 word Google Business Profile post" },
];

const PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "gbp", label: "GBP" },
];

export function GenerateWizard({ onClose, onCreated, selectedClientId }: {
  onClose: () => void;
  onCreated: (item: ContentItem) => void;
  selectedClientId: number | null;
}) {
  const [step, setStep] = useState<"type" | "config" | "generating">("type");
  const [postType, setPostType] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["instagram"]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [topic, setTopic] = useState("");

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const handleGenerate = async () => {
    if (postType === "social_caption" && !selectedMedia) { toast.error("Select a photo first"); return; }
    if (postType === "social_caption" && platforms.length === 0) { toast.error("Select at least one platform"); return; }
    setStep("generating");
    try {
      const result = await generateDraft({
        content_type: postType,
        platforms: postType === "social_caption" ? platforms : undefined,
        media_item_id: postType === "social_caption" ? selectedMedia?.id : undefined,
        topic: topic || undefined,
        client_id: selectedClientId ?? undefined,
      });
      toast.success("Draft created");
      onCreated(result);
      onClose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Generation failed";
      toast.error(msg);
      setStep("config");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4">
      <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-600">
          <div className="flex items-center gap-3">
            {step !== "type" && <button onClick={() => setStep("type")} className="text-fg-3 hover:text-fg-1 text-sm transition-colors duration-150">←</button>}
            <h2 className="font-display font-semibold text-fg-1">
              {step === "type" && "Generate post"}
              {step === "config" && POST_TYPES.find((t) => t.key === postType)?.label}
              {step === "generating" && "Generating…"}
            </h2>
          </div>
          <button onClick={onClose} className="text-fg-3 hover:text-fg-1 text-lg leading-none transition-colors duration-150">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {step === "type" && (
            <div className="grid gap-3">
              {POST_TYPES.map((t) => (
                <button key={t.key} onClick={() => { setPostType(t.key); setStep("config"); }}
                  className="flex items-start gap-4 p-4 rounded-xl border border-ink-600 hover:border-tint hover:bg-tint-soft bg-white text-left transition-colors duration-150">
                  <div>
                    <p className="font-medium text-fg-1">{t.label}</p>
                    <p className="text-sm text-fg-3 mt-0.5">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {step === "config" && postType === "social_caption" && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-fg-1 mb-1">Platforms</p>
                <p className="text-xs text-fg-3 mb-2">Select one or more — the same caption and image will be posted to all.</p>
                <div className="flex gap-2 flex-wrap">
                  {PLATFORMS.map((p) => {
                    const active = platforms.includes(p.key);
                    return (
                      <button key={p.key} onClick={() => togglePlatform(p.key)}
                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors duration-150 ${active ? "bg-tint text-white border-tint" : "bg-white border-ink-600 text-fg-2 hover:border-tint"}`}>
                        {active && <span className="mr-1.5">✓</span>}{p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-fg-1 mb-2">Select a photo</p>
                <MediaBrowser
                  clientId={selectedClientId}
                  isSelected={(m) => selectedMedia?.id === m.id}
                  onPick={setSelectedMedia}
                  maxHeight="max-h-72"
                />
                {selectedMedia && <p className="text-xs text-fg-3 mt-2 truncate">Selected: {selectedMedia.meta?.project ? `${selectedMedia.meta.project} — ` : ""}{selectedMedia.filename}</p>}
              </div>
            </div>
          )}
          {step === "config" && (postType === "blog_post" || postType === "gbp_post") && (
            <div>
              <label className="text-sm font-medium text-fg-1 block mb-1.5">
                Topic <span className="font-normal text-fg-3">(optional)</span>
              </label>
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)}
                placeholder={postType === "blog_post" ? "e.g. Tips for choosing a custom home builder in Boise" : "e.g. New parade home now open for tours"}
                rows={3} className="input resize-none" />
              <p className="text-xs text-fg-3 mt-1">Leave blank to let AI choose a relevant topic.</p>
            </div>
          )}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 border-2 border-tint border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-fg-3">Claude is writing your draft…</p>
            </div>
          )}
        </div>
        {step === "config" && (
          <div className="px-6 py-4 border-t border-ink-600 flex justify-end gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={handleGenerate}
              disabled={postType === "social_caption" && (!selectedMedia || platforms.length === 0)}
              className="btn-primary disabled:opacity-40">
              Generate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Image picker modal ────────────────────────────────────────────────────────

export function ImagePickerModal({ clientId, currentUrl, onSelect, onClose }: {
  clientId: number | null;
  currentUrl: string | null;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4">
      <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-600 shrink-0">
          <h2 className="font-display font-semibold text-fg-1">Choose image</h2>
          <button onClick={onClose} className="text-fg-3 hover:text-fg-1 text-lg leading-none transition-colors duration-150">✕</button>
        </div>
        <div className="flex-1 min-h-0 p-4">
          <MediaBrowser
            clientId={clientId}
            isSelected={(m) => currentUrl === m.url || currentUrl === imgSrc(m.url)}
            onPick={(m) => { onSelect(m.url); onClose(); }}
            maxHeight="max-h-[56vh]"
          />
        </div>
        <div className="px-6 py-3 border-t border-ink-600 shrink-0 flex justify-between items-center">
          <button onClick={() => { onSelect(""); onClose(); }}
            className="text-sm text-fg-3 hover:text-signal-bad transition-colors duration-150">
            Remove image
          </button>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}
