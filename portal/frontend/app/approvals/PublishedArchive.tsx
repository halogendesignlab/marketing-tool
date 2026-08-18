"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getPublished } from "@/lib/api";
import { TYPE_LABELS, imgSrc, excerpt } from "./shared";

interface PublishedItem {
  id: number;
  content_type: string;
  platform: string | null;
  title: string | null;
  body: string;
  image_url: string | null;
  published_at: string | null;
  approved_at: string | null;
  published_via: string;
  approved_by_name: string | null;
  meta?: { platforms?: string[] } | null;
}

const TYPE_FILTERS = [
  { key: "", label: "All types" },
  { key: "social_caption", label: "Social" },
  { key: "blog_post", label: "Blog" },
  { key: "gbp_post", label: "GBP" },
];

const SOURCE_FILTERS = [
  { key: "", label: "Any source" },
  { key: "auto", label: "Auto-published" },
  { key: "client", label: "Client approved" },
  { key: "admin", label: "Team approved" },
];

/** How an item reached publication — the useful distinction is auto vs. a person. */
function SourceChip({ item }: { item: PublishedItem }) {
  if (item.published_via === "auto") {
    return (
      <span className="text-xs font-medium text-signal-warn bg-signal-warn/10 border border-signal-warn/25 px-2 py-0.5 rounded-md">
        Auto-published
      </span>
    );
  }
  const who = item.approved_by_name ?? (item.published_via === "admin" ? "your team" : "the client");
  const tone = item.published_via === "client"
    ? "text-spark bg-spark/10 border-spark/25"
    : "text-fg-2 bg-ink-500 border-ink-600";
  return (
    <span className={`text-xs font-medium border px-2 py-0.5 rounded-md ${tone}`}>
      Approved by {who}
    </span>
  );
}

function monthKey(iso: string | null): string {
  if (!iso) return "Undated";
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function ReaderModal({ item, onClose }: { item: PublishedItem; onClose: () => void }) {
  const src = item.image_url ? imgSrc(item.image_url) : null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fg-1/25 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white border border-ink-600 rounded-2xl shadow-pop w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-ink-600 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium bg-ink-500 text-fg-2 px-2 py-0.5 rounded shrink-0">
              {TYPE_LABELS[item.content_type] ?? item.content_type}
            </span>
            <SourceChip item={item} />
          </div>
          <button onClick={onClose} className="text-fg-3 hover:text-fg-1 text-lg leading-none shrink-0">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {item.title && <h2 className="font-display font-semibold text-fg-1 text-lg">{item.title}</h2>}
          {src && <img src={src} alt="" className="w-full max-h-80 object-contain bg-ink-500 rounded-xl border border-ink-600" />}
          {item.content_type === "blog_post" ? (
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: item.body }} />
          ) : (
            <p className="text-sm text-fg-2 leading-relaxed whitespace-pre-wrap">{item.body}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PublishedArchive({ clientId }: { clientId: number | null }) {
  const [items, setItems] = useState<PublishedItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [open, setOpen] = useState<PublishedItem | null>(null);

  const load = useCallback(() => {
    setFetching(true);
    getPublished(clientId ?? undefined)
      .then(setItems)
      .finally(() => setFetching(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => items.filter((i) =>
      (!typeFilter || i.content_type === typeFilter) &&
      (!sourceFilter || i.published_via === sourceFilter)),
    [items, typeFilter, sourceFilter]
  );

  const groups = useMemo(() => {
    const map = new Map<string, PublishedItem[]>();
    for (const item of filtered) {
      const key = monthKey(item.published_at);
      const bucket = map.get(key);
      if (bucket) bucket.push(item); else map.set(key, [item]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const autoCount = useMemo(() => items.filter((i) => i.published_via === "auto").length, [items]);

  return (
    <>
      {open && <ReaderModal item={open} onClose={() => setOpen(null)} />}

      {items.length > 0 && (
        <p className="text-sm text-fg-3 mb-4">
          <span className="numeric">{items.length}</span> post{items.length === 1 ? "" : "s"} live
          {autoCount > 0 && <>, <span className="numeric">{autoCount}</span> published automatically</>}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {TYPE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setTypeFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors duration-150 ${
              typeFilter === f.key ? "bg-tint text-white border-tint" : "bg-white border-ink-600 text-fg-2 hover:border-tint"
            }`}>
            {f.label}
          </button>
        ))}
        <span className="w-px h-5 bg-ink-600 mx-1" />
        {SOURCE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setSourceFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors duration-150 ${
              sourceFilter === f.key ? "bg-tint text-white border-tint" : "bg-white border-ink-600 text-fg-2 hover:border-tint"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {fetching && <p className="text-sm text-fg-3">Loading…</p>}

      {!fetching && filtered.length === 0 && (
        <div className="bg-white rounded-2xl border border-ink-600 p-12 text-center shadow-card">
          <p className="font-display font-semibold text-fg-1 mb-1">
            {items.length === 0 ? "Nothing published yet" : "No posts match these filters"}
          </p>
          <p className="text-sm text-fg-3">
            {items.length === 0
              ? "Approved content shows up here once it goes live."
              : "Try widening the filters above."}
          </p>
        </div>
      )}

      <div className="space-y-8">
        {groups.map(([month, monthItems]) => (
          <section key={month}>
            <h2 className="font-display font-semibold text-fg-1 text-sm mb-3">
              {month} <span className="text-fg-3 font-normal numeric">({monthItems.length})</span>
            </h2>
            <div className="space-y-2.5">
              {monthItems.map((item) => {
                const src = item.image_url ? imgSrc(item.image_url) : null;
                const platforms = item.meta?.platforms ?? (item.platform ? [item.platform] : []);
                return (
                  <button key={item.id} onClick={() => setOpen(item)}
                    className="w-full text-left flex gap-4 bg-white border border-ink-600 rounded-xl p-4 shadow-card hover:shadow-lift hover:border-tint/50 transition-all duration-150">
                    {src && <img src={src} alt="" className="shrink-0 w-16 h-16 object-cover rounded-lg border border-ink-600" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-xs font-medium bg-ink-500 text-fg-2 px-2 py-0.5 rounded">
                          {TYPE_LABELS[item.content_type] ?? item.content_type}
                        </span>
                        {platforms.map((p) => (
                          <span key={p} className="text-xs text-fg-3 capitalize">{p}</span>
                        ))}
                        <SourceChip item={item} />
                        {item.published_at && (
                          <span className="ml-auto text-xs text-fg-3 numeric shrink-0">
                            {new Date(item.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                      {item.title && <p className="font-medium text-fg-1 text-sm mb-0.5 line-clamp-1">{item.title}</p>}
                      <p className="text-xs text-fg-3 line-clamp-2">
                        {item.content_type === "blog_post" ? excerpt(item.body, 160) : item.body}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
