"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { getPublished } from "@/lib/api";
import { ContentItem, ImagePickerModal, imgSrc, platformsOf, excerpt, formatDateTime } from "./shared";

export interface FeedHandlers {
  onApprove: (id: number, body?: string, imageUrl?: string) => Promise<void> | void;
  onSchedule: (id: number, scheduledFor: string) => Promise<void> | void;
  onReject: (id: number, reason?: string) => Promise<void> | void;
  onUndo: (id: number) => Promise<void> | void;
  onEdit: (
    id: number,
    payload: { title?: string; body?: string; image_url?: string },
  ) => Promise<void> | void;
}

/** Approved or scheduled — decided by the client but not yet live. */
const isDecided = (status: string) => status === "approved" || status === "scheduled";

interface PublishedItem {
  id: number;
  content_type: string;
  platform: string | null;
  title: string | null;
  body: string;
  image_url: string | null;
  published_at: string | null;
  published_via: string;
  approved_by_name: string | null;
  meta?: { platforms?: string[] } | null;
}

type TypeKey = "blog" | "social";

const isBlog = (contentType: string) => contentType === "blog_post";
const typeOf = (contentType: string): TypeKey => (isBlog(contentType) ? "blog" : "social");

/** Hours until `iso`, or null if it has already passed. */
function hoursUntil(iso: string): number | null {
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? null : ms / 3_600_000;
}

function DeadlineBadge({ iso }: { iso: string }) {
  const hours = hoursUntil(iso);
  if (hours === null) {
    return <span className="text-xs font-medium text-signal-bad">Publishing now</span>;
  }

  const days = Math.floor(hours / 24);
  const label =
    days >= 1
      ? `${days} day${days === 1 ? "" : "s"} left`
      : `${Math.max(Math.floor(hours), 1)} hour${Math.floor(hours) === 1 ? "" : "s"} left`;

  const tone =
    hours <= 24 ? "bg-signal-bad/10 text-signal-bad border-signal-bad/25"
    : hours <= 72 ? "bg-signal-warn/10 text-signal-warn border-signal-warn/25"
    : "bg-ink-500 text-fg-2 border-ink-600";

  return <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${tone}`}>{label}</span>;
}

// ── Modals ────────────────────────────────────────────────────────────────────

function ScheduleModal({ onConfirm, onClose }: {
  onConfirm: (iso: string) => void;
  onClose: () => void;
}) {
  const [when, setWhen] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-semibold text-fg-1 mb-4">Schedule post</h2>
        <label className="block text-sm font-medium text-fg-1 mb-1.5">Date &amp; time</label>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
          min={new Date().toISOString().slice(0, 16)} className="input mb-4" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => { if (!when) { toast.error("Pick a date and time"); return; } onConfirm(new Date(when).toISOString()); }}
            className="btn-primary">Schedule</button>
        </div>
      </div>
    </div>
  );
}

function ChangesModal({ onConfirm, onClose }: {
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-semibold text-fg-1 mb-1.5">Request changes</h2>
        <p className="text-sm text-fg-3 mb-4">
          Tell us what to change and we&apos;ll revise it. Nothing publishes while it&apos;s with us.
        </p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Shorten the intro and swap the photo for an exterior shot"
          rows={4} className="input resize-none mb-4" autoFocus />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => onConfirm(note)} className="btn-primary">Send request</button>
        </div>
      </div>
    </div>
  );
}

function ReaderModal({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-8 py-5 border-b border-ink-600 shrink-0">
          <h2 className="font-display font-semibold text-fg-1">{title}</h2>
          <button onClick={onClose} className="text-fg-3 hover:text-fg-1 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────────

function EditPanel({ item, clientId, onSave, onCancel }: {
  item: ContentItem;
  clientId: number | null;
  onSave: (payload: { title?: string; body?: string; image_url?: string }) => Promise<void> | void;
  onCancel: () => void;
}) {
  const blog = isBlog(item.content_type);
  const [title, setTitle] = useState(item.title ?? "");
  const [body, setBody] = useState(item.body);
  const [imageUrl, setImageUrl] = useState(item.image_url ?? "");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Blog bodies are HTML, so they are edited in place rather than as raw markup.
  const htmlRef = useRef<HTMLDivElement>(null);

  const save = async () => {
    const nextBody = blog ? htmlRef.current?.innerHTML ?? item.body : body;
    if (!nextBody.trim()) { toast.error("Content can't be empty"); return; }
    setSaving(true);
    try {
      await onSave({
        ...(blog ? { title: title.trim() } : {}),
        body: nextBody,
        image_url: imageUrl,
      });
      onCancel();
    } catch { toast.error("Couldn't save your changes"); }
    finally { setSaving(false); }
  };

  return (
    <div className="px-5 sm:px-6 py-4">
      {picking && (
        <ImagePickerModal
          clientId={clientId}
          currentUrl={imageUrl || null}
          onSelect={(url) => setImageUrl(url)}
          onClose={() => setPicking(false)}
        />
      )}

      <label className="block text-sm font-medium text-fg-1 mb-1.5">Photo</label>
      <div className="flex items-center gap-3 mb-4">
        {imageUrl ? (
          <img src={imgSrc(imageUrl)} alt=""
            className="w-20 h-20 object-contain bg-ink-500 rounded-lg border border-ink-600 shrink-0" />
        ) : (
          <div className="w-20 h-20 rounded-lg border border-dashed border-ink-600 flex items-center justify-center text-xs text-fg-3 shrink-0">
            None
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => setPicking(true)} className="btn-ghost">
            {imageUrl ? "Change photo" : "Add photo"}
          </button>
          {imageUrl && (
            <button onClick={() => setImageUrl("")}
              className="text-sm font-medium text-fg-3 hover:text-signal-bad transition-colors duration-150">
              Remove
            </button>
          )}
        </div>
      </div>

      {blog && (
        <>
          <label className="block text-sm font-medium text-fg-1 mb-1.5">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input mb-4" />
        </>
      )}
      <label className="block text-sm font-medium text-fg-1 mb-1.5">
        {blog ? "Article" : "Caption"}
      </label>
      {blog ? (
        <div
          ref={htmlRef}
          contentEditable
          suppressContentEditableWarning
          className="input prose prose-sm max-w-none min-h-[16rem] max-h-[28rem] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-tint/40"
          dangerouslySetInnerHTML={{ __html: item.body }}
        />
      ) : (
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7}
          className="input resize-none" autoFocus />
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="btn-ghost" disabled={saving}>Cancel</button>
        <button onClick={save} className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ── Review card ───────────────────────────────────────────────────────────────

function FeedCard({ item, handlers, clientId }: {
  item: ContentItem;
  handlers: FeedHandlers;
  clientId: number | null;
}) {
  const [modal, setModal] = useState<"schedule" | "changes" | "read" | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const blog = isBlog(item.content_type);
  const src = item.image_url ? imgSrc(item.image_url) : null;
  const decided = isDecided(item.status);
  // Approving with a date leaves status as `approved`, so the date is what marks it scheduled.
  const scheduled = decided && (item.status === "scheduled" || Boolean(item.scheduled_for));

  const act = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try { await fn(); }
    catch { /* the page surfaces the error */ }
    finally { setBusy(false); }
  };

  return (
    <>
      {modal === "schedule" && (
        <ScheduleModal onClose={() => setModal(null)}
          onConfirm={(iso) => { setModal(null); act(() => handlers.onSchedule(item.id, iso)); }} />
      )}
      {modal === "changes" && (
        <ChangesModal onClose={() => setModal(null)}
          onConfirm={(note) => { setModal(null); act(() => handlers.onReject(item.id, note || undefined)); }} />
      )}
      {modal === "read" && (
        <ReaderModal title={item.title || "Blog post"} body={item.body} onClose={() => setModal(null)} />
      )}

      <article className={`bg-white rounded-2xl border shadow-card overflow-hidden transition-opacity duration-150 ${
        decided ? "border-spark/40" : "border-ink-600"
      } ${busy ? "opacity-50 pointer-events-none" : ""}`}>
        {decided ? (
          <div className="flex items-center gap-2 px-5 sm:px-6 pt-4">
            <span className="text-xs font-medium text-spark bg-spark/10 border border-spark/25 px-2 py-0.5 rounded-md">
              {scheduled ? "Scheduled" : "Approved"}
            </span>
            <span className="text-xs text-fg-3">
              {item.scheduled_for
                ? `Goes live ${formatDateTime(item.scheduled_for)}`
                : "Queued to publish"}
            </span>
          </div>
        ) : item.auto_publish_at ? (
          <div className="flex items-center gap-2 px-5 sm:px-6 pt-4">
            <DeadlineBadge iso={item.auto_publish_at} />
            <span className="text-xs text-fg-3">until this publishes on its own</span>
          </div>
        ) : null}

        {editing ? (
          <EditPanel
            item={item}
            clientId={clientId}
            onCancel={() => setEditing(false)}
            onSave={(payload) => handlers.onEdit(item.id, payload)}
          />
        ) : (
          <div className="px-5 sm:px-6 py-4">
            {blog ? (
              <div>
                {src && <img src={src} alt="" className="w-full h-52 object-contain bg-ink-500 rounded-xl border border-ink-600 mb-4" />}
                {item.title && <h3 className="font-display font-semibold text-fg-1 text-lg mb-2">{item.title}</h3>}
                <div className="prose prose-sm max-w-none text-fg-2 line-clamp-6"
                  dangerouslySetInnerHTML={{ __html: item.body }} />
                <button onClick={() => setModal("read")}
                  className="text-sm font-medium text-tint hover:text-tint-hot mt-2 transition-colors duration-150">
                  Read full post →
                </button>
              </div>
            ) : (
              <div className="flex gap-4">
                {src && <img src={src} alt="" className="shrink-0 w-28 h-28 sm:w-36 sm:h-36 object-contain bg-ink-500 rounded-xl border border-ink-600" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {platformsOf(item).map((p) => (
                      <span key={p} className="text-xs font-medium text-fg-2 bg-ink-500 px-2 py-0.5 rounded-md capitalize">{p}</span>
                    ))}
                  </div>
                  <p className="text-sm text-fg-2 leading-relaxed whitespace-pre-wrap">{item.body}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {!editing && (
          <div className="flex items-center gap-2 px-5 sm:px-6 py-4 border-t border-ink-600 bg-ink-900/60 flex-wrap">
            {decided ? (
              <>
                <span className="text-sm text-fg-3">Nothing left to do — we&apos;ll take it from here.</span>
                <button onClick={() => act(() => handlers.onUndo(item.id))}
                  className="ml-auto text-sm font-medium text-fg-2 hover:text-fg-1 transition-colors duration-150">
                  {scheduled ? "Undo scheduling" : "Undo approval"}
                </button>
              </>
            ) : (
              <>
                {blog ? (
                  <button onClick={() => act(() => handlers.onApprove(item.id))} className="btn-primary">
                    Looks good
                  </button>
                ) : (
                  <>
                    <button onClick={() => act(() => handlers.onApprove(item.id))} className="btn-primary">
                      Publish now
                    </button>
                    <button onClick={() => setModal("schedule")} className="btn-ghost">Schedule</button>
                  </>
                )}
                <button onClick={() => setEditing(true)} className="btn-ghost">Edit</button>
                <button onClick={() => setModal("changes")}
                  className="ml-auto text-sm font-medium text-fg-3 hover:text-signal-bad transition-colors duration-150">
                  Request changes
                </button>
              </>
            )}
          </div>
        )}
      </article>
    </>
  );
}

// ── Published card (read-only) ────────────────────────────────────────────────

function PublishedCard({ item }: { item: PublishedItem }) {
  const [reading, setReading] = useState(false);
  const src = item.image_url ? imgSrc(item.image_url) : null;
  const platforms = item.meta?.platforms ?? (item.platform ? [item.platform] : []);

  return (
    <>
      {reading && (
        <ReaderModal title={item.title || "Blog post"} body={item.body} onClose={() => setReading(false)} />
      )}
      <button
        onClick={() => isBlog(item.content_type) && setReading(true)}
        className={`w-full text-left flex gap-4 bg-white border border-ink-600 rounded-xl p-4 shadow-card ${
          isBlog(item.content_type) ? "hover:shadow-lift hover:border-tint/50 transition-all duration-150" : "cursor-default"
        }`}
      >
        {src && <img src={src} alt="" className="shrink-0 w-16 h-16 object-cover rounded-lg border border-ink-600" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs font-medium text-spark bg-spark/10 border border-spark/25 px-2 py-0.5 rounded-md">
              Published
            </span>
            {platforms.map((p) => (
              <span key={p} className="text-xs text-fg-3 capitalize">{p}</span>
            ))}
            {item.published_at && (
              <span className="ml-auto text-xs text-fg-3 numeric shrink-0">
                {new Date(item.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          {item.title && <p className="font-medium text-fg-1 text-sm mb-0.5 line-clamp-1">{item.title}</p>}
          <p className="text-xs text-fg-3 line-clamp-2">
            {isBlog(item.content_type) ? excerpt(item.body, 160) : item.body}
          </p>
        </div>
      </button>
    </>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────

export default function ClientFeed({ items, handlers, fetching, clientId }: {
  items: ContentItem[];
  handlers: FeedHandlers;
  fetching: boolean;
  clientId: number | null;
}) {
  const [type, setType] = useState<TypeKey>("blog");
  const [showPublished, setShowPublished] = useState(false);
  const [published, setPublished] = useState<PublishedItem[]>([]);
  const [loadingPublished, setLoadingPublished] = useState(false);

  // Re-render every minute so the countdowns stay honest without a page refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadPublished = useCallback(() => {
    setLoadingPublished(true);
    getPublished(clientId ?? undefined)
      .then(setPublished)
      .finally(() => setLoadingPublished(false));
  }, [clientId]);

  useEffect(() => {
    if (showPublished) loadPublished();
  }, [showPublished, loadPublished]);

  // Badges count only what still needs a decision, not what's already approved.
  const counts = useMemo(() => ({
    blog: items.filter((i) => typeOf(i.content_type) === "blog" && !isDecided(i.status)).length,
    social: items.filter((i) => typeOf(i.content_type) === "social" && !isDecided(i.status)).length,
  }), [items]);

  // Blogs surface soonest-deadline first; social has no clock so newest wins.
  // Either way, anything already decided sinks below what still needs attention.
  const review = useMemo(() => {
    const scoped = items.filter((i) => typeOf(i.content_type) === type);
    const byRecency = (a: ContentItem, b: ContentItem) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const byDeadline = (a: ContentItem, b: ContentItem) =>
      new Date(a.auto_publish_at ?? a.created_at).getTime() -
      new Date(b.auto_publish_at ?? b.created_at).getTime();
    return [...scoped].sort((a, b) =>
      Number(isDecided(a.status)) - Number(isDecided(b.status)) ||
      (type === "blog" ? byDeadline(a, b) : byRecency(a, b))
    );
  }, [items, type]);

  const publishedScoped = useMemo(
    () => published.filter((i) => typeOf(i.content_type) === type),
    [published, type]
  );

  const TABS: { key: TypeKey; label: string }[] = [
    { key: "blog", label: "Blog posts" },
    { key: "social", label: "Social posts" },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6 border-b border-ink-600">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setType(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-150 ${
                type === t.key ? "border-tint text-fg-1" : "border-transparent text-fg-3 hover:text-fg-2"
              }`}>
              {t.label}
              {counts[t.key] > 0 && (
                <span className={`ml-1.5 text-xs numeric px-1.5 py-0.5 rounded ${
                  type === t.key ? "bg-tint text-white" : "bg-ink-500 text-fg-2"
                }`}>
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowPublished((v) => !v)}
          role="switch"
          aria-checked={showPublished}
          className="flex items-center gap-2 pb-2 text-sm text-fg-2 hover:text-fg-1 transition-colors duration-150 shrink-0"
        >
          <span className={`relative w-8 h-[18px] rounded-full transition-colors duration-150 ${
            showPublished ? "bg-tint" : "bg-ink-600"
          }`}>
            <span className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all duration-150 ${
              showPublished ? "left-[16px]" : "left-[2px]"
            }`} />
          </span>
          Show published
        </button>
      </div>

      {fetching && <p className="text-sm text-fg-3">Loading…</p>}

      {!fetching && review.length === 0 && (
        <div className="bg-white rounded-2xl border border-ink-600 p-10 text-center shadow-card">
          <p className="font-display font-semibold text-fg-1 mb-1">
            Nothing to review{type === "blog" ? " — blog posts" : " — social posts"}
          </p>
          <p className="text-sm text-fg-3">
            {showPublished
              ? "Everything here has already gone live."
              : "We'll email you when new content is ready."}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {review.map((item) => (
          <FeedCard key={item.id} item={item} handlers={handlers} clientId={clientId} />
        ))}
      </div>

      {showPublished && (
        <section className="mt-8">
          <h2 className="font-display font-semibold text-fg-1 text-sm mb-3">
            Published
            {publishedScoped.length > 0 && (
              <span className="text-fg-3 font-normal numeric"> ({publishedScoped.length})</span>
            )}
          </h2>
          {loadingPublished && <p className="text-sm text-fg-3">Loading…</p>}
          {!loadingPublished && publishedScoped.length === 0 && (
            <p className="text-sm text-fg-3">
              No {type === "blog" ? "blog posts" : "social posts"} have gone live yet.
            </p>
          )}
          <div className="space-y-2.5">
            {publishedScoped.map((item) => (
              <PublishedCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
