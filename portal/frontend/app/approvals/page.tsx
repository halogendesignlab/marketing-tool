"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import Nav from "@/components/Nav";
import { useClient } from "@/lib/client-context";
import { useRequireClient } from "@/lib/use-require-client";
import {
  getPendingApprovals,
  approveContent,
  rejectContent,
  deleteContent,
  regenerateCaption,
  generateDraft,
  getMediaItems,
  sendToClient,
  recallFromClient,
} from "@/lib/api";
import toast from "react-hot-toast";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ContentItem {
  id: number;
  content_type: string;
  platform: string | null;
  status: string;
  title: string | null;
  body: string;
  image_url: string | null;
  scheduled_for: string | null;
  created_at: string;
  meta?: { platforms?: string[]; captions?: Record<string, string>; blog_images?: string[] } | null;
  rejection_reason?: string | null;
}

interface MediaItem {
  id: number;
  filename: string;
  url: string;
  meta?: { project?: string; category?: string } | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-ink-500 text-fg-2 border-ink-600",
  facebook: "bg-ink-500 text-fg-2 border-ink-600",
  linkedin: "bg-ink-500 text-fg-2 border-ink-600",
  gbp: "bg-ink-500 text-fg-2 border-ink-600",
};

const TYPE_LABELS: Record<string, string> = {
  social_caption: "Social",
  blog_post: "Blog",
  gbp_post: "GBP",
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending_approval: { label: "Pending approval", cls: "bg-ink-500 text-signal-warn border-ink-600" },
  client_review:    { label: "Awaiting client",  cls: "bg-ink-500 text-plasma border-ink-600" },
  approved:         { label: "Approved",          cls: "bg-ink-500 text-signal-good border-ink-600" },
  scheduled:        { label: "Scheduled",         cls: "bg-ink-500 text-tint border-ink-600" },
  published:        { label: "Posted",            cls: "bg-ink-500 text-signal-good border-ink-600" },
  rejected:         { label: "Rejected",          cls: "bg-ink-500 text-signal-bad border-ink-600" },
};

// Status filter tabs shown to admins
const STATUS_TABS = [
  { key: "",                label: "All" },
  { key: "pending_approval", label: "Pending" },
  { key: "client_review",    label: "Awaiting client" },
  { key: "scheduled",        label: "Scheduled" },
  { key: "published",        label: "Posted" },
  { key: "rejected",         label: "Rejected" },
];

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

function GenerateWizard({ onClose, onCreated, selectedClientId }: {
  onClose: () => void;
  onCreated: (item: ContentItem) => void;
  selectedClientId: number | null;
}) {
  const [step, setStep] = useState<"type" | "config" | "generating">("type");
  const [postType, setPostType] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["instagram"]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [topic, setTopic] = useState("");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  useEffect(() => {
    if (postType === "social_caption") {
      setLoadingMedia(true);
      getMediaItems(undefined, selectedClientId ?? undefined, 48, 0)
        .then(setMediaItems)
        .finally(() => setLoadingMedia(false));
    }
  }, [postType, selectedClientId]);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
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

  const imgSrc = (url: string) => url.startsWith("http") ? url : `${API_BASE}${url}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-ink-800 border border-ink-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-600">
          <div className="flex items-center gap-3">
            {step !== "type" && <button onClick={() => setStep("type")} className="text-fg-3 hover:text-fg-1 font-sans text-sm transition-colors duration-150">←</button>}
            <h2 className="font-sans font-semibold text-fg-1">
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
                  className="flex items-start gap-4 p-4 rounded-xl border border-ink-600 hover:border-tint bg-ink-700 text-left transition-colors duration-150 group">
                  <div>
                    <p className="font-sans font-medium text-fg-1">{t.label}</p>
                    <p className="text-sm text-fg-3 mt-0.5 font-sans">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {step === "config" && postType === "social_caption" && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-sans font-medium text-fg-2 mb-1">Platforms</p>
                <p className="text-xs text-fg-3 font-sans mb-2">Select one or more — the same caption and image will be posted to all.</p>
                <div className="flex gap-2 flex-wrap">
                  {PLATFORMS.map((p) => {
                    const active = platforms.includes(p.key);
                    return (
                      <button key={p.key} onClick={() => togglePlatform(p.key)}
                        className={`px-3 py-1.5 rounded-md border font-sans text-sm font-medium transition-colors duration-150 ${active ? "bg-tint text-ink-900 border-tint" : "border-ink-600 text-fg-2 hover:border-tint"}`}>
                        {active && <span className="mr-1.5">✓</span>}{p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-sm font-sans font-medium text-fg-2 mb-2">Select a photo</p>
                {loadingMedia ? <p className="text-sm text-fg-3 font-sans">Loading photos…</p>
                  : mediaItems.length === 0 ? <p className="text-sm text-fg-3 font-sans">No photos in media library yet.</p>
                  : (
                    <div className="grid grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
                      {mediaItems.map((m) => (
                        <button key={m.id} onClick={() => setSelectedMedia(m)}
                          className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${selectedMedia?.id === m.id ? "border-tint ring-2 ring-tint ring-offset-1 ring-offset-ink-800" : "border-transparent hover:border-ink-600"}`}
                          title={m.meta?.project || m.filename}>
                          <img src={imgSrc(m.url)} alt={m.filename} className="w-full h-full object-cover" loading="lazy" />
                          {selectedMedia?.id === m.id && (
                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                              <span className="bg-tint rounded-full w-6 h-6 flex items-center justify-center text-ink-900 text-xs font-bold shadow">✓</span>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                {selectedMedia && <p className="text-xs text-fg-3 font-sans mt-2 truncate">Selected: {selectedMedia.meta?.project ? `${selectedMedia.meta.project} — ` : ""}{selectedMedia.filename}</p>}
              </div>
            </div>
          )}
          {step === "config" && (postType === "blog_post" || postType === "gbp_post") && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-sans font-medium text-fg-2 block mb-1.5">
                  Topic <span className="font-normal text-fg-3">(optional)</span>
                </label>
                <textarea value={topic} onChange={(e) => setTopic(e.target.value)}
                  placeholder={postType === "blog_post" ? "e.g. Tips for choosing a custom home builder in Boise" : "e.g. New parade home now open for tours"}
                  rows={3} className="input resize-none" />
                <p className="text-xs text-fg-3 font-sans mt-1">Leave blank to let AI choose a relevant topic.</p>
              </div>
            </div>
          )}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 border-2 border-tint border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-fg-3 font-sans">Claude is writing your draft…</p>
            </div>
          )}
        </div>
        {step === "config" && (
          <div className="px-6 py-4 border-t border-ink-600 flex justify-end gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={handleGenerate}
              disabled={(postType === "social_caption" && !selectedMedia) || (postType === "social_caption" && platforms.length === 0)}
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

function ImagePickerModal({ clientId, currentUrl, onSelect, onClose }: {
  clientId: number | null;
  currentUrl: string | null;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE = 48;

  const load = useCallback((off: number) => {
    setLoading(true);
    getMediaItems(undefined, clientId ?? undefined, PAGE, off)
      .then((results) => {
        setItems((prev) => off === 0 ? results : [...prev, ...results]);
        setHasMore(results.length === PAGE);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(0); }, [load]);

  const imgSrc = (url: string) => url.startsWith("http") ? url : `${API_BASE}${url}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-ink-800 border border-ink-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-600 shrink-0">
          <h2 className="font-sans font-semibold text-fg-1">Choose image</h2>
          <button onClick={onClose} className="text-fg-3 hover:text-fg-1 text-lg leading-none transition-colors duration-150">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && items.length === 0 && (
            <p className="text-sm text-fg-3 font-sans text-center py-8">Loading photos…</p>
          )}
          {!loading && items.length === 0 && (
            <p className="text-sm text-fg-3 font-sans text-center py-8">No photos in media library yet.</p>
          )}
          <div className="grid grid-cols-4 gap-2">
            {items.map((m) => {
              const src = imgSrc(m.url);
              const isSelected = currentUrl === m.url || currentUrl === src;
              return (
                <button
                  key={m.id}
                  onClick={() => { onSelect(m.url); onClose(); }}
                  className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all ${isSelected ? "border-tint ring-2 ring-tint ring-offset-1 ring-offset-ink-800" : "border-transparent hover:border-ink-600"}`}
                  title={m.meta?.project || m.filename}
                >
                  <img src={src} alt={m.filename} className="w-full h-full object-cover" loading="lazy" />
                  {isSelected && (
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                      <span className="bg-tint rounded-full w-6 h-6 flex items-center justify-center text-ink-900 text-xs font-bold shadow">✓</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => { const next = offset + PAGE; setOffset(next); load(next); }}
                disabled={loading}
                className="btn-ghost disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-ink-600 shrink-0 flex justify-between items-center">
          <button
            onClick={() => { onSelect(""); onClose(); }}
            className="text-sm text-fg-3 hover:text-fg-2 font-sans transition-colors duration-150"
          >
            Remove image
          </button>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Draft card ────────────────────────────────────────────────────────────────

function DraftCard({ item, isAdmin, clientId, onApprove, onApproveScheduled, onReject, onDelete, onSendToClient, onRecall, onBodyChange }: {
  item: ContentItem;
  isAdmin: boolean;
  clientId: number | null;
  onApprove: (id: number, body?: string, imageUrl?: string) => void;
  onApproveScheduled: (id: number, scheduledFor: string, body?: string, imageUrl?: string) => void;
  onReject: (id: number, reason?: string) => void;
  onDelete: (id: number) => void;
  onSendToClient: (id: number) => void;
  onRecall: (id: number) => void;
  onBodyChange: (id: number, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(item.body);
  const [editImageUrl, setEditImageUrl] = useState<string | null>(item.image_url);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showFullPost, setShowFullPost] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [sending, setSending] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  const displayImageUrl = editing ? editImageUrl : item.image_url;
  const imgSrc = displayImageUrl
    ? displayImageUrl.startsWith("http") ? displayImageUrl : `${API_BASE}${displayImageUrl}`
    : null;

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const updated = await regenerateCaption(item.id);
      setEditBody(updated.body);
      onBodyChange(item.id, updated.body);
      toast.success("Caption regenerated");
    } catch { toast.error("Failed to regenerate"); }
    finally { setRegenerating(false); }
  };

  const handleSendToClient = async () => {
    setSending(true);
    try { await onSendToClient(item.id); }
    finally { setSending(false); }
  };

  const handleConfirmSchedule = () => {
    if (!scheduleDate) { toast.error("Pick a date and time"); return; }
    onApproveScheduled(item.id, new Date(scheduleDate).toISOString(), editing ? editBody : undefined, editImageUrl ?? undefined);
    setShowSchedule(false);
  };

  const currentBody = editing ? editBody : item.body;

  return (
    <>
      {/* Image picker modal */}
      {showImagePicker && (
        <ImagePickerModal
          clientId={clientId}
          currentUrl={editImageUrl}
          onSelect={(url) => setEditImageUrl(url || null)}
          onClose={() => setShowImagePicker(false)}
        />
      )}

      {/* Full post modal */}
      {showFullPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-ink-800 border border-ink-600 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-8 py-5 border-b border-ink-600 shrink-0">
              <h2 className="font-sans font-semibold text-fg-1 text-base">{item.title || "Blog Post"}</h2>
              <button onClick={() => setShowFullPost(false)} className="text-fg-3 hover:text-fg-1 text-xl leading-none transition-colors duration-150">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: item.body }} />
            <div className="flex items-center gap-3 px-8 py-4 border-t border-ink-600 shrink-0">
              <button onClick={() => { onApprove(item.id, currentBody, editImageUrl ?? undefined); setShowFullPost(false); }}
                className="btn-primary">
                {isAdmin ? "Approve" : "Post now"}
              </button>
              {isAdmin ? (
                <button onClick={() => { onDelete(item.id); setShowFullPost(false); }}
                  className="ml-auto text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">
                  Discard
                </button>
              ) : (
                <button onClick={() => { setShowFullPost(false); setShowRejectModal(true); }}
                  className="ml-auto text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">
                  Reject
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Schedule modal (client only) */}
      {showSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-ink-800 border border-ink-600 rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="font-sans font-semibold text-fg-1 mb-4">Schedule post</h2>
            <label className="block text-xs font-sans font-medium text-fg-2 mb-1.5">Date &amp; time</label>
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="input mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSchedule(false)} className="btn-ghost">Cancel</button>
              <button onClick={handleConfirmSchedule} className="btn-primary">
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject with comment modal (client) */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-ink-800 border border-ink-600 rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="font-sans font-semibold text-fg-1 mb-2">Reject this post</h2>
            <p className="text-sm text-fg-3 font-sans mb-4">Let us know what needs to change and we&apos;ll revise it.</p>
            <label className="block text-xs font-sans font-medium text-fg-2 mb-1.5">
              Comments <span className="font-normal text-fg-3">(optional)</span>
            </label>
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="e.g. The caption is too long, please shorten it"
              rows={4}
              className="input resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRejectModal(false); setRejectComment(""); }}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onReject(item.id, rejectComment || undefined);
                  setShowRejectModal(false);
                  setRejectComment("");
                }}
                className="px-4 py-2 bg-signal-bad text-ink-900 font-sans font-semibold text-sm rounded-md hover:opacity-90 transition-opacity duration-150"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-ink-700 rounded-xl border border-ink-600 overflow-hidden">
        <div className="flex gap-4 p-5">
          {imgSrc && (
            <div className="shrink-0">
              <img src={imgSrc} alt="post image" className="w-24 h-24 object-cover rounded-md border border-ink-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-sans font-medium bg-ink-500 text-fg-2 px-2 py-0.5 rounded-md border border-ink-600">
                {TYPE_LABELS[item.content_type] ?? item.content_type}
              </span>
              {(item.meta?.platforms ?? (item.platform ? [item.platform] : [])).map((p) => (
                <span key={p} className={`text-xs font-sans font-medium px-2 py-0.5 rounded-md border capitalize ${PLATFORM_COLORS[p] ?? "bg-ink-500 text-fg-2 border-ink-600"}`}>{p}</span>
              ))}
              {isAdmin && STATUS_CONFIG[item.status] && (
                <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-md border ${STATUS_CONFIG[item.status].cls}`}>
                  {STATUS_CONFIG[item.status].label}
                </span>
              )}
              {item.scheduled_for && item.status === "scheduled" && (
                <span className="text-xs text-fg-3 font-sans">
                  {new Date(item.scheduled_for).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </div>
            {item.title && <p className="font-sans font-medium text-fg-1 text-sm mb-1.5 truncate">{item.title}</p>}
            {editing ? (
              <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)}
                className="input min-h-[140px] resize-y" />
            ) : item.content_type === "blog_post" ? (
              <div className="text-sm text-fg-2 leading-relaxed line-clamp-6 prose prose-invert prose-sm max-w-none prose-headings:font-sans prose-headings:font-semibold prose-headings:text-fg-1 prose-p:my-1"
                dangerouslySetInnerHTML={{ __html: item.body }} />
            ) : (
              <p className="text-sm text-fg-2 leading-relaxed line-clamp-4 whitespace-pre-wrap">{item.body}</p>
            )}
          </div>
        </div>

        {/* ── Rejection reason callout (admin view) ── */}
        {isAdmin && item.status === "rejected" && item.rejection_reason && (
          <div className="mx-5 mb-1 mt-0">
            <div className="flex gap-2 text-sm text-signal-bad bg-ink-500 border border-ink-600 rounded-md px-3 py-2.5">
              <div><span className="font-sans font-medium">Client note: </span>{item.rejection_reason}</div>
            </div>
          </div>
        )}

        {/* ── Admin actions: pending_approval ── */}
        {isAdmin && item.status === "pending_approval" && (
          <div className="flex items-center gap-2 px-5 py-3 bg-ink-800 border-t border-ink-600 flex-wrap">
            <button onClick={() => onApprove(item.id, editing ? editBody : undefined, editImageUrl ?? undefined)}
              className="btn-primary">
              Approve &amp; post
            </button>
            <button onClick={handleSendToClient} disabled={sending}
              className="btn-ghost disabled:opacity-50">
              {sending ? "Sending…" : "Send to client"}
            </button>
            {editing ? (
              <button onClick={() => setEditing(false)} className="btn-ghost">Done editing</button>
            ) : (
              <button onClick={() => { setEditing(true); setEditBody(item.body); setEditImageUrl(item.image_url); }} className="btn-ghost">Edit</button>
            )}
            {editing && (
              <button onClick={() => setShowImagePicker(true)} className="btn-ghost">
                {editImageUrl ? "Change image" : "Add image"}
              </button>
            )}
            {item.image_url && !editing && (
              <button onClick={handleRegenerate} disabled={regenerating} className="btn-ghost disabled:opacity-50">
                {regenerating ? "…" : "Regenerate"}
              </button>
            )}
            {item.content_type === "blog_post" && (
              <button onClick={() => setShowFullPost(true)} className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150">Read post →</button>
            )}
            <button onClick={() => onDelete(item.id)} className="ml-auto text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">Discard</button>
          </div>
        )}

        {/* ── Admin actions: awaiting client ── */}
        {isAdmin && item.status === "client_review" && (
          <div className="flex items-center gap-2 px-5 py-3 bg-ink-800 border-t border-ink-600">
            {item.content_type === "blog_post" && (
              <button onClick={() => setShowFullPost(true)} className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150">Read post →</button>
            )}
            <button onClick={() => onRecall(item.id)} className="ml-auto btn-ghost">
              Recall
            </button>
            <button onClick={() => onDelete(item.id)} className="text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">Discard</button>
          </div>
        )}

        {/* ── Admin: rejected — full action bar to revise or delete ── */}
        {isAdmin && item.status === "rejected" && (
          <div className="flex items-center gap-2 px-5 py-3 bg-ink-800 border-t border-ink-600 flex-wrap">
            <button onClick={() => onApprove(item.id, editing ? editBody : undefined, editImageUrl ?? undefined)}
              className="btn-primary">
              Approve &amp; post
            </button>
            <button onClick={handleSendToClient} disabled={sending}
              className="btn-ghost disabled:opacity-50">
              {sending ? "Sending…" : "Re-send to client"}
            </button>
            {editing ? (
              <button onClick={() => setEditing(false)} className="btn-ghost">Done editing</button>
            ) : (
              <button onClick={() => { setEditing(true); setEditBody(item.body); setEditImageUrl(item.image_url); }} className="btn-ghost">Edit</button>
            )}
            {editing && (
              <button onClick={() => setShowImagePicker(true)} className="btn-ghost">
                {editImageUrl ? "Change image" : "Add image"}
              </button>
            )}
            {item.image_url && !editing && (
              <button onClick={handleRegenerate} disabled={regenerating} className="btn-ghost disabled:opacity-50">
                {regenerating ? "…" : "Regenerate"}
              </button>
            )}
            {item.content_type === "blog_post" && (
              <button onClick={() => setShowFullPost(true)} className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150">Read post →</button>
            )}
            <button onClick={() => onDelete(item.id)} className="ml-auto text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">Discard</button>
          </div>
        )}

        {/* ── Admin: read-only footer for other terminal statuses (with Discard) ── */}
        {isAdmin && ["published", "scheduled", "approved"].includes(item.status) && (
          <div className="flex items-center gap-2 px-5 py-3 bg-ink-800 border-t border-ink-600">
            {item.content_type === "blog_post" && (
              <button onClick={() => setShowFullPost(true)} className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150">Read post →</button>
            )}
            <button onClick={() => onDelete(item.id)} className="ml-auto text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">Discard</button>
          </div>
        )}

        {/* ── Client actions ── */}
        {!isAdmin && (
          <div className="flex items-center gap-2 px-5 py-3 bg-ink-800 border-t border-ink-600 flex-wrap">
            <button onClick={() => onApprove(item.id, editing ? editBody : undefined, editImageUrl ?? undefined)}
              className="btn-primary">
              Post now
            </button>
            <button onClick={() => setShowSchedule(true)}
              className="btn-ghost">
              Schedule
            </button>
            {editing ? (
              <button onClick={() => setEditing(false)} className="btn-ghost">Done editing</button>
            ) : (
              <button onClick={() => { setEditing(true); setEditBody(item.body); setEditImageUrl(item.image_url); }} className="btn-ghost">Edit</button>
            )}
            {editing && (
              <button onClick={() => setShowImagePicker(true)} className="btn-ghost">
                {editImageUrl ? "Change image" : "Add image"}
              </button>
            )}
            {item.content_type === "blog_post" && (
              <button onClick={() => setShowFullPost(true)} className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150">Read post →</button>
            )}
            <button onClick={() => setShowRejectModal(true)} className="ml-auto text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150">Reject</button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { isAdmin } = useAuth();
  const { selectedClient } = useClient();
  const ready = useRequireClient();
  const selectedClientId = selectedClient?.id ?? null;
  const [items, setItems] = useState<ContentItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const loadDrafts = useCallback(() => {
    setFetching(true);
    getPendingApprovals(selectedClientId ?? undefined, isAdmin ? (statusFilter || undefined) : undefined)
      .then(setItems)
      .finally(() => setFetching(false));
  }, [selectedClientId, statusFilter, isAdmin]);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const handleApprove = async (id: number, body?: string, imageUrl?: string) => {
    try {
      const updated = await approveContent(id, body, imageUrl);
      if (isAdmin) {
        setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...updated } : i));
      } else {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
      toast.success("Approved — queued for publishing");
    } catch { toast.error("Failed to approve"); }
  };

  const handleApproveScheduled = async (id: number, scheduledFor: string, body?: string, imageUrl?: string) => {
    try {
      const updated = await approveContent(id, body, imageUrl, scheduledFor);
      if (isAdmin) {
        setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...updated } : i));
      } else {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
      toast.success("Scheduled for publishing");
    } catch { toast.error("Failed to schedule"); }
  };

  const handleReject = async (id: number, reason?: string) => {
    try {
      await rejectContent(id, reason);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Rejected");
    } catch { toast.error("Failed"); }
  };

  const handleSendToClient = async (id: number) => {
    try {
      await sendToClient(id);
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: "client_review" } : i));
      toast.success("Sent to client for approval");
    } catch { toast.error("Failed to send to client"); }
  };

  const handleRecall = async (id: number) => {
    try {
      await recallFromClient(id);
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: "pending_approval" } : i));
      toast.success("Recalled — back in your queue");
    } catch { toast.error("Failed to recall"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteContent(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { toast.error("Failed to delete"); }
  };

  const handleBodyChange = (id: number, body: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, body } : i)));
  };

  const handleCreated = (item: ContentItem) => {
    setItems((prev) => [item, ...prev]);
  };

  if (!ready) return null;

  const emptyMessage = isAdmin
    ? { title: "No drafts", sub: 'Click "Generate Post" to create your first draft.' }
    : { title: "Nothing to review", sub: "You're all caught up. Check back when new content is ready for your approval." };

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-sans font-semibold text-fg-1 text-xl">
            {isAdmin ? "Drafts" : "Approvals"}
          </h1>
          {isAdmin && (
            <button onClick={() => setShowWizard(true)}
              className="btn-primary flex items-center gap-2">
              <span className="text-base leading-none">+</span> Generate post
            </button>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-1 mb-6 border-b border-ink-600 overflow-x-auto">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-2 font-sans text-sm font-medium whitespace-nowrap border-b-2 transition-colors duration-150 -mb-px ${
                  statusFilter === tab.key
                    ? "border-tint text-fg-1"
                    : "border-transparent text-fg-3 hover:text-fg-2"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {fetching && <p className="text-sm text-fg-3 font-sans">Loading…</p>}

        {!fetching && items.length === 0 && (
          <div className="bg-ink-700 rounded-xl border border-ink-600 p-12 text-center">
            <p className="font-sans font-medium text-fg-1 mb-1">{emptyMessage.title}</p>
            <p className="text-sm text-fg-3 font-sans mb-4">{emptyMessage.sub}</p>
            {isAdmin && (
              <button onClick={() => setShowWizard(true)} className="btn-primary">
                Generate post
              </button>
            )}
          </div>
        )}

        <div className="space-y-4">
          {items.map((item) => (
            <DraftCard
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              clientId={selectedClientId}
              onApprove={handleApprove}
              onApproveScheduled={handleApproveScheduled}
              onReject={handleReject}
              onDelete={handleDelete}
              onSendToClient={handleSendToClient}
              onRecall={handleRecall}
              onBodyChange={handleBodyChange}
            />
          ))}
        </div>
      </main>

      {showWizard && (
        <GenerateWizard
          onClose={() => setShowWizard(false)}
          onCreated={handleCreated}
          selectedClientId={selectedClientId}
        />
      )}
    </div>
  );
}
