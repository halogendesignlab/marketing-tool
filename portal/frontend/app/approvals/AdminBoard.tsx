"use client";

import { useState, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import { regenerateCaption, regeneratePost, updateContent } from "@/lib/api";
import {
  ContentItem, ImagePickerModal, TYPE_LABELS,
  imgSrc, platformsOf, excerpt, formatDateTime,
} from "./shared";

export interface BoardHandlers {
  onApprove: (id: number, body?: string, imageUrl?: string) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onSendToClient: (id: number) => Promise<void> | void;
  onRecall: (id: number) => Promise<void> | void;
  onItemChange: (id: number, patch: Partial<ContentItem>) => void;
}

type ColumnKey = "queue" | "with_client" | "scheduled";

const COLUMNS: { key: ColumnKey; title: string; hint: string; statuses: string[] }[] = [
  // `failed` sits here too. A post that errored on publish needs an admin, and
  // any status without a column is dropped by columnOf — which is how failures
  // used to vanish from the board entirely.
  { key: "queue",       title: "Your queue",  hint: "Review, edit, then send",     statuses: ["pending_approval", "rejected", "failed"] },
  { key: "with_client", title: "With client", hint: "Waiting on their decision",   statuses: ["client_review"] },
  { key: "scheduled",   title: "Scheduled",   hint: "Approved and queued to post", statuses: ["approved", "scheduled"] },
];

/** Which columns accept a drop from which — admin only owns queue ↔ with_client. */
const DROP_TARGETS: Record<ColumnKey, ColumnKey[]> = {
  queue: ["with_client"],
  with_client: ["queue"],
  scheduled: [],
};

function columnOf(status: string): ColumnKey | null {
  return COLUMNS.find((c) => c.statuses.includes(status))?.key ?? null;
}

// ── Card ──────────────────────────────────────────────────────────────────────

function Card({ item, selected, selectable, onToggleSelect, onOpen, onDragStart }: {
  item: ContentItem;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const src = item.image_url ? imgSrc(item.image_url) : null;
  const wasRejected = item.status === "rejected";
  const didFail = item.status === "failed";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={`group bg-white rounded-xl border shadow-card hover:shadow-lift cursor-pointer transition-all duration-150 overflow-hidden ${
        selected ? "border-tint ring-2 ring-tint/20" : "border-ink-600 hover:border-tint/50"
      }`}
    >
      {wasRejected && (
        <div className="px-3 py-1.5 bg-signal-bad/8 border-b border-signal-bad/20">
          <p className="text-xs text-signal-bad font-medium">
            Changes requested{item.rejection_reason ? `: ${item.rejection_reason}` : ""}
          </p>
        </div>
      )}
      {didFail && (
        <div className="px-3 py-1.5 bg-signal-warn/8 border-b border-signal-warn/20">
          <p className="text-xs text-signal-warn font-medium">
            Didn’t publish{item.error_message ? `: ${item.error_message}` : ""}
          </p>
        </div>
      )}
      <div className="flex gap-3 p-3">
        {selectable && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            aria-label={selected ? "Deselect" : "Select"}
            className={`shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center text-[10px] transition-colors duration-150 ${
              selected ? "bg-tint border-tint text-white" : "border-ink-600 bg-white text-transparent group-hover:border-fg-3"
            }`}
          >
            ✓
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-[11px] font-medium bg-ink-500 text-fg-2 px-1.5 py-0.5 rounded">
              {TYPE_LABELS[item.content_type] ?? item.content_type}
            </span>
            {platformsOf(item).map((p) => (
              <span key={p} className="text-[11px] font-medium text-fg-3 capitalize">{p}</span>
            ))}
          </div>
          {item.title && <p className="font-medium text-fg-1 text-sm mb-1 line-clamp-1">{item.title}</p>}
          <p className="text-xs text-fg-3 leading-relaxed line-clamp-2">
            {item.content_type === "blog_post" ? excerpt(item.body, 120) : item.body}
          </p>
          {item.scheduled_for && (
            <p className="text-[11px] text-tint mt-1.5 numeric">{formatDateTime(item.scheduled_for)}</p>
          )}
          {item.auto_publish_at && <Countdown iso={item.auto_publish_at} compact />}
        </div>
        {src && (
          <img src={src} alt="" className="shrink-0 w-14 h-14 object-cover rounded-lg border border-ink-600" />
        )}
      </div>
    </div>
  );
}

/** Days/hours remaining before an item publishes on its own. */
export function Countdown({ iso, compact = false }: { iso: string; compact?: boolean }) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return <p className="text-[11px] text-signal-warn mt-1.5">Publishing now</p>;

  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const label = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.max(hours, 1)} hour${hours === 1 ? "" : "s"}`;
  const tone = hours <= 24 ? "text-signal-bad" : hours <= 72 ? "text-signal-warn" : "text-fg-3";

  return (
    <p className={`${compact ? "text-[11px] mt-1.5" : "text-sm"} ${tone}`}>
      Auto-publishes in {label}
    </p>
  );
}

// ── Detail overlay ────────────────────────────────────────────────────────────

function DetailOverlay({ item, clientId, handlers, onClose }: {
  item: ContentItem;
  clientId: number | null;
  handlers: BoardHandlers;
  onClose: () => void;
}) {
  const [body, setBody] = useState(item.body);
  const [imageUrl, setImageUrl] = useState<string | null>(item.image_url);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const dirty = body !== item.body || imageUrl !== item.image_url;
  const isBlog = item.content_type === "blog_post";
  const src = imageUrl ? imgSrc(imageUrl) : null;

  const regenerate = async () => {
    setBusy("regenerate");
    try {
      const updated = isBlog ? await regeneratePost(item.id) : await regenerateCaption(item.id);
      setBody(updated.body);
      handlers.onItemChange(item.id, { body: updated.body });
      toast.success("Regenerated");
    } catch { toast.error("Failed to regenerate"); }
    finally { setBusy(null); }
  };

  /** Persist edits on their own. Returns silently when there is nothing to save. */
  const persist = async () => {
    if (!dirty) return;
    const updated = await updateContent(item.id, { body, image_url: imageUrl ?? "" });
    handlers.onItemChange(item.id, updated);
  };

  const save = async () => {
    setBusy("save");
    try { await persist(); toast.success("Saved"); }
    catch { toast.error("Failed to save"); }
    finally { setBusy(null); }
  };

  // Edits must land before a transition, or sending to the client would ship stale copy.
  const run = async (key: string, fn: () => Promise<void> | void) => {
    setBusy(key);
    try { await persist(); await fn(); onClose(); }
    catch { toast.error("Something went wrong"); }
    finally { setBusy(null); }
  };

  return (
    <>
      {showPicker && (
        <ImagePickerModal clientId={clientId} currentUrl={imageUrl}
          onSelect={(url) => setImageUrl(url || null)} onClose={() => setShowPicker(false)} />
      )}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-ink-600 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium bg-ink-500 text-fg-2 px-2 py-0.5 rounded">
                {TYPE_LABELS[item.content_type] ?? item.content_type}
              </span>
              {platformsOf(item).map((p) => (
                <span key={p} className="text-xs text-fg-3 capitalize">{p}</span>
              ))}
            </div>
            <button onClick={onClose} className="text-fg-3 hover:text-fg-1 text-lg leading-none transition-colors duration-150">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {item.status === "rejected" && item.rejection_reason && (
              <div className="rounded-lg border border-signal-bad/25 bg-signal-bad/5 px-3 py-2.5">
                <p className="text-sm text-signal-bad">
                  <span className="font-medium">Client note: </span>{item.rejection_reason}
                </p>
              </div>
            )}
            {item.status === "failed" && (
              <div className="rounded-lg border border-signal-warn/25 bg-signal-warn/5 px-3 py-2.5">
                <p className="text-sm text-signal-warn">
                  <span className="font-medium">Didn’t publish: </span>
                  {item.error_message || "no error was recorded"}
                </p>
                <p className="text-xs text-signal-warn/80 mt-1">
                  Approving puts it back in the publish queue to try again.
                </p>
              </div>
            )}
            {item.title && <h2 className="font-display font-semibold text-fg-1 text-lg">{item.title}</h2>}
            {src && (
              <div className="relative">
                <img src={src} alt="" className="w-full max-h-72 object-contain bg-ink-500 rounded-xl border border-ink-600" />
                <button onClick={() => setShowPicker(true)}
                  className="absolute bottom-3 right-3 bg-white/95 border border-ink-600 text-fg-2 text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-sm hover:text-fg-1">
                  Change image
                </button>
              </div>
            )}
            {!src && (
              <button onClick={() => setShowPicker(true)}
                className="w-full py-8 rounded-xl border border-dashed border-ink-600 text-sm text-fg-3 hover:border-tint hover:text-tint transition-colors duration-150">
                + Add image
              </button>
            )}
            {isBlog ? (
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => setBody(e.currentTarget.innerHTML)}
                className="prose prose-sm max-w-none rounded-lg border border-ink-600 p-4 focus:outline-none focus:border-tint focus:ring-2 focus:ring-tint/15"
                dangerouslySetInnerHTML={{ __html: item.body }}
              />
            ) : (
              <textarea value={body} onChange={(e) => setBody(e.target.value)}
                className="input min-h-[180px] resize-y leading-relaxed" />
            )}
          </div>

          <div className="flex items-center gap-2 px-6 py-4 border-t border-ink-600 shrink-0 flex-wrap">
            {columnOf(item.status) === "queue" && (
              <>
                <button onClick={() => run("send", () => handlers.onSendToClient(item.id))}
                  disabled={!!busy} className="btn-primary disabled:opacity-50">
                  {busy === "send" ? "Sending…" : "Send to client"}
                </button>
                <button onClick={() => run("approve", () => handlers.onApprove(item.id, body, imageUrl ?? undefined))}
                  disabled={!!busy} className="btn-ghost disabled:opacity-50">
                  {item.status === "failed" ? "Retry publish" : "Approve & post"}
                </button>
              </>
            )}
            {item.status === "client_review" && (
              <button onClick={() => run("recall", () => handlers.onRecall(item.id))}
                disabled={!!busy} className="btn-ghost disabled:opacity-50">
                {busy === "recall" ? "Recalling…" : "Recall"}
              </button>
            )}
            <button onClick={regenerate} disabled={!!busy} className="btn-ghost disabled:opacity-50">
              {busy === "regenerate" ? "…" : "Regenerate"}
            </button>
            <button onClick={save} disabled={!!busy || !dirty} className="btn-ghost disabled:opacity-40">
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button onClick={() => run("delete", () => handlers.onDelete(item.id))}
              disabled={!!busy} className="ml-auto text-sm text-signal-bad hover:opacity-80 transition-opacity duration-150">
              Discard
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

export default function AdminBoard({ items, clientId, handlers, fetching }: {
  items: ContentItem[];
  clientId: number | null;
  handlers: BoardHandlers;
  fetching: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openItem, setOpenItem] = useState<ContentItem | null>(null);
  const [dragOver, setDragOver] = useState<ColumnKey | null>(null);
  const [dragFrom, setDragFrom] = useState<ColumnKey | null>(null);
  const [sendingBulk, setSendingBulk] = useState(false);
  // Ids travelling with the current drag — a ref so the drop handler reads the
  // committed value rather than a stale render's state.
  const draggingIds = useRef<number[]>([]);

  const buckets = useMemo(() => {
    const map: Record<ColumnKey, ContentItem[]> = { queue: [], with_client: [], scheduled: [] };
    for (const item of items) {
      const col = columnOf(item.status);
      if (col) map[col].push(item);
    }
    return map;
  }, [items]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sendSelected = async () => {
    setSendingBulk(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => handlers.onSendToClient(id)));
      setSelected(new Set());
      toast.success(`Sent ${ids.length} to client`);
    } finally { setSendingBulk(false); }
  };

  const handleDrop = async (target: ColumnKey) => {
    setDragOver(null);
    const from = dragFrom;
    setDragFrom(null);
    if (!from || !DROP_TARGETS[from].includes(target)) return;

    const ids = draggingIds.current;
    draggingIds.current = [];
    if (ids.length === 0) return;

    if (target === "with_client") {
      await Promise.all(ids.map((id) => handlers.onSendToClient(id)));
      setSelected(new Set());
    } else if (target === "queue") {
      await Promise.all(ids.map((id) => handlers.onRecall(id)));
    }
  };

  const startDrag = (item: ContentItem, col: ColumnKey) => (e: React.DragEvent) => {
    const group = selected.has(item.id) && col === "queue" ? Array.from(selected) : [item.id];
    draggingIds.current = group;
    setDragFrom(col);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(item.id));
  };

  return (
    <>
      {openItem && (
        <DetailOverlay
          item={items.find((i) => i.id === openItem.id) ?? openItem}
          clientId={clientId}
          handlers={handlers}
          onClose={() => setOpenItem(null)}
        />
      )}

      {fetching && <p className="text-sm text-fg-3 mb-3">Loading…</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {COLUMNS.map((col) => {
          const colItems = buckets[col.key];
          const canDrop = !!dragFrom && DROP_TARGETS[dragFrom].includes(col.key);
          const isQueue = col.key === "queue";
          return (
            <div
              key={col.key}
              onDragOver={(e) => { if (canDrop) { e.preventDefault(); setDragOver(col.key); } }}
              onDragLeave={() => setDragOver((prev) => (prev === col.key ? null : prev))}
              onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
              className={`rounded-2xl border p-3 transition-colors duration-150 ${
                dragOver === col.key && canDrop
                  ? "border-tint bg-tint-soft"
                  : canDrop
                  ? "border-dashed border-tint/40 bg-white"
                  : "border-ink-600 bg-white"
              }`}
            >
              <div className="flex items-baseline justify-between px-1 mb-1">
                <h2 className="font-display font-semibold text-fg-1 text-sm">{col.title}</h2>
                <span className="text-xs text-fg-3 numeric">{colItems.length}</span>
              </div>
              <p className="text-xs text-fg-3 px-1 mb-3">{col.hint}</p>

              {isQueue && selected.size > 0 && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-tint-soft border border-tint/30">
                  <span className="text-xs text-fg-1 font-medium">{selected.size} selected</span>
                  <button onClick={sendSelected} disabled={sendingBulk}
                    className="ml-auto text-xs font-medium text-tint hover:text-tint-hot disabled:opacity-50">
                    {sendingBulk ? "Sending…" : "Send to client"}
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-fg-3 hover:text-fg-1">
                    Clear
                  </button>
                </div>
              )}

              <div className="space-y-2.5 min-h-[80px]">
                {colItems.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    selectable={isQueue}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onOpen={() => setOpenItem(item)}
                    onDragStart={startDrag(item, col.key)}
                  />
                ))}
                {colItems.length === 0 && !fetching && (
                  <p className="text-xs text-fg-3 text-center py-8">
                    {isQueue ? "Nothing waiting on you." : col.key === "with_client" ? "Nothing with the client." : "Nothing queued to post."}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </>
  );
}
